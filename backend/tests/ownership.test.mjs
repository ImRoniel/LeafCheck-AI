import express from "express";
import assert from "node:assert/strict";
import { after, before, mock, test } from "node:test";

const plantId = "00000000-0000-4000-8000-000000000001";
const deviceId = "00000000-0000-4000-8000-000000000002";
let server,
  base,
  mongoReads = 0,
  writes = 0,
  external = 0;
const plant = {
  id: plantId,
  userId: "owner",
  deviceId,
  name: "Basil",
  species: "Basil",
  createdAt: new Date(),
  updatedAt: new Date(),
};
before(async () => {
  mock.module(new URL("../src/lib/auth.js", import.meta.url).href, {
    namedExports: {
      requireAuth: (req, res, next) => {
        if (!req.get("authorization"))
          return res.status(401).json({ error: "Unauthorized" });
        res.locals.auth = { user: { id: req.get("authorization") } };
        next();
      },
    },
  });
  mock.module(new URL("../src/lib/prisma-pg.js", import.meta.url).href, {
    namedExports: {
      prismaPg: {
        plant: {
          findFirst: async ({ where }) =>
            where.id === plantId && where.userId === "owner" ? plant : null,
          findMany: async ({ where }) =>
            where.userId === "owner" ? [plant] : [],
          update: async () => {
            writes++;
            return plant;
          },
        },
        device: {
          findFirst: async ({ where }) =>
            where.id === deviceId && where.userId === "owner"
              ? { id: deviceId }
              : null,
          findUnique: async () => ({ id: deviceId }),
        },
      },
    },
  });
  mock.module(new URL("../src/lib/prisma.js", import.meta.url).href, {
    namedExports: {
      prisma: {
        sensorReading: {
          findFirst: async () => {
            mongoReads++;
            return null;
          },
          findMany: async () => {
            mongoReads++;
            return [];
          },
          count: async () => 0,
          create: async ({ data }) => {
            writes++;
            return data;
          },
        },
      },
    },
  });
  mock.module(new URL("../src/lib/plantnet.js", import.meta.url).href, {
    namedExports: {
      identifyPlant: async () => {
        external++;
        throw new Error("must not run");
      },
    },
  });
  const app = express();
  app.use(express.json());
  for (const name of ["plants", "scan", "ai", "telemetry"]) {
    const module = await import(`../src/routes/${name}.ts`);
    app.use(`/${name}`, module[`${name}Router`]);
  }
  const { errorHandler } = await import("../src/lib/http.ts");
  app.use(errorHandler);
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise((r) => server.close(r));
  mock.restoreAll();
});
async function request(path, user, body, method = body ? "POST" : "GET") {
  return fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(user ? { Authorization: user } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
test("protected routers reject anonymous callers", async () => {
  for (const path of [
    "/plants",
    `/telemetry/${deviceId}/latest`,
    `/telemetry/${deviceId}/history`,
  ])
    assert.equal((await request(path)).status, 401);
  for (const path of ["/scan", "/ai/analyze"])
    assert.equal((await request(path, null, {})).status, 401);
});
test("cross-owner reads, updates and analysis stop before costs or writes", async () => {
  assert.deepEqual(await (await request("/plants", "other")).json(), []);
  assert.equal((await request(`/plants/${plantId}`, "other")).status, 404);
  assert.equal(
    (
      await request(
        `/plants/${plantId}/health`,
        "other",
        { healthStatus: "healthy" },
        "PATCH",
      )
    ).status,
    404,
  );
  for (const path of ["/scan", "/ai/analyze"])
    assert.equal(
      (await request(path, "other", { plantId, imageBase64: "image" })).status,
      404,
    );
  for (const suffix of ["latest", "history"])
    assert.equal(
      (await request(`/telemetry/${deviceId}/${suffix}`, "other")).status,
      404,
    );
  assert.equal(mongoReads, 0);
  assert.equal(writes, 0);
  assert.equal(external, 0);
});
test("scan requires device association and rejects extra fields", async () => {
  plant.deviceId = null;
  assert.equal(
    (
      await request("/scan", "owner", {
        plantId,
        deviceId,
        imageBase64: "image",
      })
    ).status,
    404,
  );
  plant.deviceId = deviceId;
  assert.equal(
    (
      await request("/scan", "owner", {
        plantId,
        userId: "other",
        imageBase64: "image",
      })
    ).status,
    400,
  );
  assert.equal(external, 0);
});
test("owner reads succeed and firmware ingestion still accepts no user JWT", async () => {
  assert.equal((await request(`/plants/${plantId}`, "owner")).status, 200);
  assert.equal(
    (await request(`/telemetry/${deviceId}/history`, "owner")).status,
    200,
  );
  assert.equal(mongoReads, 1);
  assert.equal(
    (
      await request("/telemetry", null, {
        deviceId,
        temperature: 25,
        humidity: 50,
        soilMoisture: 40,
      })
    ).status,
    201,
  );
});
