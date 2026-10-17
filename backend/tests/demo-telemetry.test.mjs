import express from "express";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, mock, test } from "node:test";

process.env.AUTH_PROVIDER = "legacy";
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
let histories = [], inTransaction = false, pairer;
let rows = [],
  writes = 0,
  failMongo = false,
  server,
  base,
  tokens,
  generator;
let queue = Promise.resolve();
const pg = {
  authSession: {
    findUnique: async ({ where }) => ({
      id: where.id,
      userId: where.id,
      user: { id: where.id, role: "USER", isActive: true },
      expiresAt: new Date(Date.now() + 60000),
    }),
  },
  plant: {
    findFirst: async ({ where }) =>
      where.id === plant.id && where.userId === plant.userId
        ? { ...plant }
        : null,
    updateMany: async () => ({count:0}),
    update: async ({ where, data }) => {
      assert.equal(where.userId, "owner");
      writes++;
      Object.assign(plant, data);
      return { ...plant };
    },
  },
  devicePairingHistory: {
    findMany: async ({where}) => histories.filter(row => historyMatches(row,where)),
    findFirst: async ({where}) => histories.filter(row => historyMatches(row,where))
      .sort((a,b) => (b.unpairedAt ?? 0)-(a.unpairedAt ?? 0))[0] ?? null,
    updateMany: async ({where,data}) => {
      const matches = histories.filter(row => historyMatches(row,where));
      for (const row of matches) Object.assign(row,data);
      return {count:matches.length};
    },
    create: async ({data}) => {
      const row = {id:randomUUID(),unpairedAt:null,...data}; histories.push(row); return row;
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
    findUnique: async ({ where }) => {
      if (where.macAddress !== undefined) {
        return [...devices.values()].find(device => device.macAddress === where.macAddress) ?? null;
      }
      return devices.get(where.id);
    },
  },
  $transaction: async (callback,options) => {
    assert.equal(options.isolationLevel,"Serializable");
    const pending = queue.then(async () => {
      const snapshot = structuredClone({plant, devices:[...devices], histories});
      inTransaction = true;
      try { return await callback(pg); }
      catch (error) {
        Object.assign(plant,snapshot.plant); histories = snapshot.histories;
        devices.clear(); for (const [id,device] of snapshot.devices) devices.set(id,device);
        throw error;
      } finally { inTransaction = false; }
    });
    queue = pending.catch(() => {});
    return pending;
  },
};
function historyMatches(row,where) {
  const identity = where.OR ? where.OR.some(filter => Object.entries(filter).every(([key,value]) => row[key] === value)) : row.deviceId === where.deviceId;
  return identity && (where.unpairedAt === null ? row.unpairedAt === null : row.unpairedAt !== null);
}
before(async () => {
  mock.module(new URL("../src/lib/prisma-pg.js", import.meta.url).href, {
    namedExports: { prismaPg: pg },
  });
  mock.module(new URL("../src/lib/prisma.js", import.meta.url).href, {
    namedExports: {
      prisma: {
        $transaction: async (operations) => {
          assert.equal(inTransaction,false,"demo MongoDB replacement must follow PostgreSQL commit");
          if (failMongo) throw new Error("simulated storage failure");
          for (const operation of operations) operation();
        },
        sensorReading: {
          create: async ({ data }) => {
            assert.equal(inTransaction,false);
            if (failMongo) throw new Error("private storage failure");
            writes++;
            rows.push(data);
            return data;
          },
          deleteMany:
            ({ where }) =>
            () => {
              rows = rows.filter(r => !Object.entries(where).every(([key,value]) => r[key] === value));
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
  pairer = (await import("../src/lib/plant-pairing.ts")).pairPlantDevice;
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
  const context = {plantId:plant.id,pairingId:randomUUID()};
  const batch = generator("device", end, context);
  assert.deepEqual(batch, generator("device", end, context));
  assert.equal(batch.length, 193);
  assert.equal(+batch[192].timestamp, +end);
  assert.equal(+end - batch[0].timestamp, 48 * 3600000);
  let jumps = 0;
  for (const [i, r] of batch.entries()) {
    assert.equal(r.plantId,context.plantId); assert.equal(r.pairingId,context.pairingId); assert.equal(r.contextVersion,1);
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
  assert.equal(histories.length,1);
  assert.ok(rows.every(row => row.plantId === plant.id && row.pairingId === histories[0].id && row.contextVersion === 1));
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
    400,
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

test("demo seeding cannot reuse a device belonging to another owner or plant", async () => {
  const originalDevice = devices.get(plant.deviceId);
  const originalRows = structuredClone(rows);
  const association = plant.deviceId;
  try {
    for (const replacement of [
      { ...originalDevice, userId: "other" },
      { ...originalDevice, macAddress: `DEMO:${randomUUID()}` },
    ]) {
      devices.set(association, replacement);
      const response = await seed();
      assert.equal(response.status, 409);
      assert.equal((await response.json()).code, "DEVICE_CONFLICT");
      assert.equal(plant.deviceId, association);
      assert.deepEqual(rows, originalRows);
      assert.deepEqual(devices.get(association), replacement);
    }
  } finally {
    devices.set(association, originalDevice);
  }
});

test("hardware readings retain the registered MAC and raw ADC is never classified as a percentage", async () => {
  const hardwareId = randomUUID();
  devices.set(hardwareId, { id: hardwareId, userId: "owner", macAddress: "LC-A50528" });
  const response = await request("/api/telemetry", null, "POST", {
    deviceId: "lc-a50528", temperature: 25, humidity: 60, soilMoisture: 2024,
    soilMoistureRaw: 2024, lightLux: 1200,
  });
  assert.equal(response.status, 201);
  const reading = await response.json();
  assert.equal(reading.deviceId, "LC-A50528");
  assert.equal(reading.soilMoisture, null);
  assert.equal(reading.soilMoistureRaw, 2024);
  assert.equal(reading.lightLux, 1200);
  assert.equal(rows.at(-1).deviceId, "LC-A50528");
  const latest = await (await request(`/api/telemetry/${hardwareId}/latest`)).json();
  assert.deepEqual(latest.soilMoisture, { percentage: null, rawAnalogValue: 2024, status: "unavailable" });
  assert.equal(latest.lightLevel.lux, 1200);
});

test("hardware ingestion accepts sensor boundaries and rejects invalid input before writes", async () => {
  const hardwareId = randomUUID();
  devices.set(hardwareId, { id: hardwareId, userId: "owner", macAddress: "LC-000001" });
  const valid = { deviceId: "LC-000001", temperature: 25, humidity: 60, soilMoisture: 2024, lightLux: 1200 };
  for (const extra of [
    { temperature: -40, humidity: 0, soilMoisture: 0, soilMoistureRaw: 0, lightLux: 0 },
    { temperature: 125, humidity: 100, soilMoisture: 4095, soilMoistureRaw: 4095 },
    { soilMoistureRaw: null },
  ]) {
    const response = await request("/api/telemetry", null, "POST", { ...valid, ...extra });
    assert.equal(response.status, 201);
    const reading = await response.json();
    assert.equal(reading.deviceId, "LC-000001");
    assert.equal(reading.soilMoisture, null);
    assert.equal(reading.soilMoistureRaw, extra.soilMoistureRaw ?? extra.soilMoisture ?? valid.soilMoisture);
    assert.equal(reading.lightLux, extra.lightLux ?? valid.lightLux);
    assert.ok(Number.isFinite(Date.parse(reading.timestamp)));
  }
  const count = writes;
  const samples = rows.length;
  for (const body of [
    [], {},
    ...[
      { deviceId: "not-a-mac" }, { deviceId: hardwareId }, { deviceId: "" }, { deviceId: null },
      { temperature: "25" }, { temperature: null }, { temperature: -41 }, { temperature: 126 },
      { humidity: -1 }, { humidity: 101 }, { soilMoisture: -1 }, { soilMoisture: 4096 }, { soilMoisture: 1.5 }, { soilMoisture: null }, { soilMoisture: undefined },
      { soilMoistureRaw: -1 }, { soilMoistureRaw: 4096 }, { soilMoistureRaw: 1.5 },
      { lightLux: -1 }, { lightLux: "10" }, { lightLux: null }, { lightLux: undefined }, { lightLevel: 10 }, { userId: "other" },
      { timestamp: new Date().toISOString() },
    ].map((extra) => ({ ...valid, ...extra })),
  ]) {
    assert.equal((await request("/api/telemetry", null, "POST", body)).status, 400);
  }
  // JSON numeric overflow reaches the validator as Infinity; literal NaN is invalid JSON.
  for (const field of ["temperature", "humidity", "soilMoisture", "soilMoistureRaw", "lightLux"]) {
    const body = JSON.stringify({ ...valid, [field]: "overflow" }).replace('"overflow"', "1e400");
    const response = await fetch(base + "/api/telemetry", {
      method: "POST", headers: { "Content-Type": "application/json" }, body,
    });
    assert.equal(response.status, 400);
  }
  const unknown = await request("/api/telemetry", null, "POST", { ...valid, deviceId: "LC-FFFFFF" });
  assert.equal(unknown.status, 404);
  assert.deepEqual(await unknown.json(), { error: "Device not found. Claim this Device ID in the app before sending telemetry." });
  assert.equal(writes, count);
  assert.equal(rows.length, samples);
  failMongo = true;
  try {
    const failure = await request("/api/telemetry", null, "POST", valid);
    assert.equal(failure.status, 500);
    assert.deepEqual(await failure.json(), { error: "Failed to store telemetry reading." });
    assert.equal(writes, count);
  } finally {
    failMongo = false;
  }
});

test("demo reseeding replaces only the current session and preserves earlier/legacy samples", async () => {
  const previous = histories.find(row => row.plantId === plant.id && row.unpairedAt === null);
  const previousRows = structuredClone(rows.filter(row => row.pairingId === previous.id));
  await pairer(plant.id,"owner",null);
  const legacy = {...previousRows[0],id:randomUUID()};
  delete legacy.plantId; delete legacy.pairingId; delete legacy.contextVersion;
  rows.push(legacy);
  assert.equal((await seed()).status,200);
  const current = histories.find(row => row.plantId === plant.id && row.unpairedAt === null);
  assert.notEqual(current.id,previous.id);
  const currentIds = rows.filter(row => row.pairingId === current.id).map(row => row.id);
  assert.equal(currentIds.length,193);
  assert.ok(currentIds.every(id => !previousRows.some(row => row.id === id)));
  for (const response of await Promise.all([seed(),seed()])) assert.equal(response.status,200);
  assert.deepEqual(rows.filter(row => row.pairingId === previous.id),previousRows);
  assert.deepEqual(rows.filter(row => row.pairingId === current.id).map(row => row.id),currentIds);
  assert.ok(rows.includes(legacy));
  assert.equal(histories.length,2);
});

test("a failed first MongoDB batch leaves a committed demo session that reseeding repairs", async () => {
  await pairer(plant.id,"owner",null);
  failMongo = true;
  try { assert.equal((await seed()).status,500); } finally { failMongo = false; }
  const current = histories.find(row => row.plantId === plant.id && row.unpairedAt === null);
  assert.ok(current); assert.equal(plant.deviceId,current.deviceId);
  assert.equal(rows.filter(row => row.pairingId === current.id).length,0);
  assert.equal((await seed()).status,200);
  assert.equal(rows.filter(row => row.pairingId === current.id).length,193);
});
