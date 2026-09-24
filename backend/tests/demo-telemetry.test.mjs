import express from "express";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, mock, test } from "node:test";

process.env.AUTH_JWT_SECRET = randomBytes(48).toString("base64url");
process.env.AUTH_JWT_ISSUER = "demo-tests";
process.env.AUTH_JWT_AUDIENCE = "demo-tests";
const plant = {
  id: randomUUID(),
  userId: "owner",
  deviceId: null,
  name: "Fern",
  species: "Fern",
  healthStatus: "unknown",
  createdAt: new Date(),
  updatedAt: new Date(),
};
const devices = new Map();
let rows = [],
  writes = 0,
  failMongo = false,
  server,
  base,
  tokens,
  generator;
let queue = Promise.resolve();
const pg = {
  $queryRaw: async () => [],
  authSession: {
    findUnique: async ({ where }) => ({
      id: where.id,
      userId: where.id,
      user: { id: where.id, isActive: true },
      expiresAt: new Date(Date.now() + 60000),
    }),
  },
  plant: {
    findFirst: async ({ where }) =>
      where.id === plant.id && where.userId === plant.userId
        ? { ...plant }
        : null,
    update: async ({ where, data }) => {
      assert.equal(where.userId, "owner");
      writes++;
      Object.assign(plant, data);
      return { ...plant };
    },
  },
  device: {
    upsert: async ({ create }) => {
      writes++;
      if (!devices.has(create.id)) devices.set(create.id, create);
      return devices.get(create.id);
    },
    findFirst: async ({ where }) => {
      const d = devices.get(where.id);
      return d?.userId === where.userId ? d : null;
    },
    findUnique: async ({ where }) => devices.get(where.id),
  },
  $transaction: async (callback) => {
    const pending = queue.then(() => callback(pg));
    queue = pending.catch(() => {});
    return pending;
  },
};
before(async () => {
  mock.module(new URL("../src/lib/prisma-pg.js", import.meta.url).href, {
    namedExports: { prismaPg: pg },
  });
  mock.module(new URL("../src/lib/prisma.js", import.meta.url).href, {
    namedExports: {
      prisma: {
        $transaction: async (operations) => {
          if (failMongo) throw new Error("simulated storage failure");
          for (const operation of operations) operation();
        },
        sensorReading: {
          deleteMany:
            ({ where }) =>
            () => {
              rows = rows.filter((r) => r.deviceId !== where.deviceId);
            },
          createMany:
            ({ data }) =>
            () => {
              rows.push(...data);
            },
          findMany: async ({ where, take, skip }) =>
            rows
              .filter((r) => r.deviceId === where.deviceId)
              .sort((a, b) => b.timestamp - a.timestamp)
              .slice(skip, skip + take),
          count: async ({ where }) =>
            rows.filter((r) => r.deviceId === where.deviceId).length,
          findFirst: async ({ where }) =>
            rows
              .filter((r) => r.deviceId === where.deviceId)
              .sort((a, b) => b.timestamp - a.timestamp)[0],
        },
      },
    },
  });
  const { accessToken } = await import("../src/lib/auth.ts");
  tokens = {
    owner: await accessToken("owner", "owner"),
    other: await accessToken("other", "other"),
  };
  generator = (await import("../src/lib/demo-telemetry.ts"))
    .generateDemoReadings;
  const app = express();
  app.use(express.json());
  app.use(
    "/api/plants",
    (await import("../src/routes/plants.ts")).plantsRouter,
  );
  app.use(
    "/api/telemetry",
    (await import("../src/routes/telemetry.ts")).telemetryRouter,
  );
  app.use((await import("../src/lib/http.ts")).errorHandler);
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  mock.restoreAll();
});
const request = (path, token = tokens.owner, method = "GET", body) =>
  fetch(base + path, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
const seed = (token = tokens.owner, id = plant.id) =>
  request(`/api/plants/${id}/seed-telemetry`, token, "POST");

test("real JWT middleware and ownership stop unauthorized seeding before writes", async () => {
  for (const token of [null, "invalid.jwt.token"])
    assert.equal((await seed(token)).status, 401);
  assert.equal((await seed(tokens.other)).status, 404);
  assert.equal((await seed(tokens.owner, randomUUID())).status, 404);
  assert.equal((await seed(tokens.owner, "invalid")).status, 400);
  assert.equal(writes, 0);
  assert.equal(rows.length, 0);
});
test("deterministic curves have 193 samples, prescribed bounds and one watering jump", () => {
  const end = new Date("2026-09-21T16:00:00Z");
  const batch = generator("device", end);
  assert.deepEqual(batch, generator("device", end));
  assert.equal(batch.length, 193);
  assert.equal(+batch[192].timestamp, +end);
  assert.equal(+end - batch[0].timestamp, 48 * 3600000);
  let jumps = 0;
  for (const [i, r] of batch.entries()) {
    assert.ok(r.temperature >= 24 && r.temperature <= 31);
    assert.ok(r.humidity >= 55 && r.humidity <= 80);
    assert.ok(
      Math.abs(r.humidity - (80 - ((r.temperature - 24) * 25) / 7)) < 0.03,
    );
    const hour = (r.timestamp.getUTCHours() + 8) % 24;
    if (hour < 6 || hour >= 18) assert.equal(r.lightLevel, 0);
    if (hour === 12) assert.ok(r.lightLevel >= 6000 && r.lightLevel <= 15000);
    if (i) {
      assert.equal(r.timestamp - batch[i - 1].timestamp, 900000);
      const delta = r.soilMoisture - batch[i - 1].soilMoisture;
      if (delta > 0) {
        jumps++;
        assert.ok(delta >= 15 && delta <= 20);
      }
    }
  }
  assert.equal(jumps, 1);
});
test("seeding links one virtual device; repeats and concurrent requests retain only 193 readings", async () => {
  const start = Date.now();
  const response = await seed();
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.simulated, true);
  assert.equal(result.deviceId, plant.deviceId);
  assert.ok(devices.get(plant.deviceId).macAddress.startsWith("DEMO:"));
  assert.ok(
    +rows[192].timestamp >= start && +rows[192].timestamp <= Date.now(),
  );
  const ids = rows.map((r) => r.id);
  for (const response of await Promise.all([seed(), seed(), seed()]))
    assert.equal(response.status, 200);
  assert.equal(rows.length, 193);
  assert.deepEqual(
    rows.map((r) => r.id),
    ids,
  );
  assert.equal(devices.size, 1);
  assert.equal(
    (await (await request(`/api/plants/${plant.id}`)).json()).simulated,
    true,
  );
});
test("history and latest are owner-scoped and retrieve the complete demo batch", async () => {
  for (const suffix of ["history?limit=200", "latest"]) {
    const path = `/api/telemetry/${plant.deviceId}/${suffix}`;
    assert.equal((await request(path, null)).status, 401);
    assert.equal((await request(path, tokens.other)).status, 404);
  }
  const history = await (
    await request(`/api/telemetry/${plant.deviceId}/history?limit=200`)
  ).json();
  assert.equal(history.data.length, 193);
  assert.deepEqual(history.pagination, {
    total: 193,
    limit: 200,
    offset: 0,
    hasMore: false,
  });
  assert.ok(
    history.data.every((r, i, all) => !i || r.timestamp < all[i - 1].timestamp),
  );
  const latest = await (
    await request(`/api/telemetry/${plant.deviceId}/latest`)
  ).json();
  assert.equal(latest.timestamp, history.data[0].timestamp);
  const page = await (
    await request(
      `/api/telemetry/${plant.deviceId}/history?limit=10&offset=190`,
    )
  ).json();
  assert.equal(page.data.length, 3);
});
test("hardware ingestion cannot contaminate demo data; hardware links are preserved", async () => {
  assert.equal(
    (
      await request("/api/telemetry", null, "POST", {
        deviceId: plant.deviceId,
        temperature: 25,
        humidity: 60,
        soilMoisture: 50,
      })
    ).status,
    403,
  );
  const demo = plant.deviceId;
  plant.deviceId = randomUUID();
  assert.equal((await seed()).status, 409);
  assert.notEqual(plant.deviceId, demo);
  plant.deviceId = demo;
  failMongo = true;
  assert.equal((await seed()).status, 500);
  assert.equal(rows.length, 193);
  failMongo = false;
  assert.equal((await seed()).status, 200);
});
