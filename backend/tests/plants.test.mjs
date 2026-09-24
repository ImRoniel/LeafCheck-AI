import express from "express";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, mock, test } from "node:test";

const rows = new Map();
let server,
  base,
  writes = 0,
  failWrite = false,
  disappear = false;
before(async () => {
  mock.module(new URL("../src/lib/auth.js", import.meta.url).href, {
    namedExports: {
      requireAuth(req, res, next) {
        const id = req.get("authorization");
        if (!id) return res.status(401).json({ error: "Unauthorized" });
        res.locals.auth = { user: { id } };
        next();
      },
    },
  });
  mock.module(new URL("../src/lib/prisma-pg.js", import.meta.url).href, {
    namedExports: {
      prismaPg: {
        plant: {
          async create({ data }) {
            if (failWrite) throw new Error("private database details");
            writes++;
            const row = {
              minMoisture: 30,
              maxMoisture: 80,
              ...data,
              id: randomUUID(),
              createdAt: new Date(),
              updatedAt: new Date(),
            };
            rows.set(row.id, row);
            return row;
          },
          async findMany({ where }) {
            return [...rows.values()].filter((p) => p.userId === where.userId);
          },
          async findFirst({ where }) {
            const row = rows.get(where.id);
            return row?.userId === where.userId ? row : null;
          },
          async deleteMany({ where }) {
            if (failWrite) throw new Error("private database details");
            assert.equal(typeof where.userId, "string");
            if (disappear) return { count: 0 };
            const row = rows.get(where.id);
            if (row?.userId !== where.userId) return { count: 0 };
            writes++;
            rows.delete(row.id);
            return { count: 1 };
          },
          async update({ where, data }) {
            if (failWrite) throw new Error("private database details");
            assert.equal(typeof where.userId, "string");
            const row = rows.get(where.id);
            if (disappear || row?.userId !== where.userId)
              throw Object.assign(new Error("missing"), { code: "P2025" });
            writes++;
            Object.assign(
              row,
              Object.fromEntries(
                Object.entries(data).filter(([, value]) => value !== undefined),
              ),
            );
            row.updatedAt = new Date();
            return row;
          },
        },
      },
    },
  });
  const { plantsRouter } = await import("../src/routes/plants.ts");
  const { errorHandler } = await import("../src/lib/http.ts");
  const app = express();
  app.use(express.json());
  app.use("/api/plants", plantsRouter);
  app.use(errorHandler);
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api/plants`;
});
after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  mock.restoreAll();
});
const request = (method, path = "", body, user = "new-account") =>
  fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(user ? { Authorization: user } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

test("new account can create, list, view and delete its first plant", async () => {
  assert.deepEqual(await (await request("GET")).json(), []);
  const response = await request("POST", "", {
    name: "  Basil  ",
    species: " Ocimum basilicum ",
    location: " Kitchen ",
    imageUrl: "https://example.test/basil.jpg",
  });
  assert.equal(response.status, 201);
  const plant = await response.json();
  assert.equal(plant.name, "Basil");
  assert.equal(plant.species, "Ocimum basilicum");
  assert.equal(plant.location, "Kitchen");
  assert.equal(plant.healthStatus, "unknown");
  assert.ok(Number.isFinite(Date.parse(plant.createdAt)));
  assert.equal(plant.userId, undefined);
  assert.equal(rows.get(plant.id).userId, "new-account");
  assert.deepEqual(await (await request("GET")).json(), [plant]);
  assert.deepEqual(await (await request("GET", `/${plant.id}`)).json(), plant);
  assert.equal(
    (await request("DELETE", `/${plant.id}`, undefined, "other")).status,
    404,
  );
  assert.ok(rows.has(plant.id));
  assert.equal(
    (await request("GET", `/${plant.id}`, undefined, "other")).status,
    404,
  );
  const deleted = await request("DELETE", `/${plant.id}`);
  assert.equal(deleted.status, 204);
  assert.equal(await deleted.text(), "");
  assert.deepEqual(await (await request("GET")).json(), []);
  assert.equal((await request("GET", `/${plant.id}`)).status, 404);
  assert.equal((await request("DELETE", `/${plant.id}`)).status, 404);
});
test("creation rejects invalid input and caller-controlled ownership without writes", async () => {
  const count = writes;
  for (const body of [
    null,
    [],
    {},
    { name: "x" },
    { name: 1, species: "x" },
    { name: " ", species: "x" },
    { name: "x", species: " " },
    { name: "x".repeat(101), species: "x" },
    { name: "x", species: "x".repeat(201) },
    ...[
      { userId: "other" },
      { id: randomUUID() },
      { deviceId: randomUUID() },
      { healthStatus: "healthy" },
      { location: null },
      { location: 42 },
      { location: "x".repeat(101) },
      { imageUrl: "javascript:alert(1)" },
      { imageUrl: "not-url" },
      { imageUrl: "https://u:p@example.test" },
      { imageUrl: "https://example.test/" + "x".repeat(2048) },
    ].map((extra) => ({ name: "x", species: "x", ...extra })),
  ]) {
    const response = await request("POST", "", body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(
      (await response.json()).code,
      body === null ? "INVALID_JSON" : "INVALID_INPUT",
    );
  }
  assert.equal(writes, count);
});

test("owner can patch details and boundary moisture values; other accounts see identical 404s", async () => {
  const plant = await (
    await request("POST", "", { name: "Fern", species: "Fern" })
  ).json();
  const response = await request("PATCH", `/${plant.id}`, {
    name: "  Office fern  ",
    species: "  Boston fern ",
    location: "",
    imageUrl: "",
    minMoisture: 0,
    maxMoisture: 100,
  });
  assert.equal(response.status, 200);
  const updated = await response.json();
  assert.equal(updated.name, "Office fern");
  assert.equal(updated.species, "Boston fern");
  assert.equal(updated.location, "");
  assert.equal(updated.minMoisture, 0);
  assert.equal(updated.maxMoisture, 100);
  assert.equal(rows.get(plant.id).userId, "new-account");
  assert.deepEqual(
    await (await request("GET", `/${plant.id}`)).json(),
    updated,
  );
  const count = writes;
  for (const method of ["GET", "PATCH", "DELETE"]) {
    const body = method === "PATCH" ? { name: "stolen" } : undefined;
    const foreign = await request(method, `/${plant.id}`, body, "other");
    const missing = await request(method, `/${randomUUID()}`, body, "other");
    assert.equal(foreign.status, 404);
    assert.equal(missing.status, 404);
    assert.deepEqual(await foreign.json(), await missing.json());
    assert.equal(
      (await request(method, `/${plant.id}`, body, null)).status,
      401,
    );
  }
  assert.equal((await request("GET", "", undefined, null)).status, 401);
  assert.deepEqual(
    await (await request("GET", "", undefined, "other")).json(),
    [],
  );
  assert.equal(writes, count);
});

test("patch validation rejects invalid fields without writes and handles concurrent disappearance", async () => {
  const plant = await (
    await request("POST", "", { name: "Fern", species: "Fern" })
  ).json();
  const count = writes;
  for (const body of [
    {},
    [],
    { name: " " },
    { species: " " },
    { name: 3 },
    { species: null },
    { name: "x".repeat(101) },
    { species: "x".repeat(201) },
    { userId: "other" },
    { healthStatus: "healthy" },
    { deviceId: randomUUID() },
    { imageUrl: "javascript:alert(1)" },
    { imageUrl: "https://u:p@example.test" },
    { location: null },
    { minMoisture: -1 },
    { maxMoisture: 101 },
    { minMoisture: "30" },
    { maxMoisture: null },
  ])
    assert.equal(
      (await request("PATCH", `/${plant.id}`, body)).status,
      400,
      JSON.stringify(body),
    );
  for (const extra of [
    { minMoisture: -1 },
    { maxMoisture: 101 },
    { minMoisture: "30" },
  ])
    assert.equal(
      (await request("POST", "", { name: "x", species: "x", ...extra })).status,
      400,
    );
  assert.equal(writes, count);
  disappear = true;
  assert.equal(
    (await request("PATCH", `/${plant.id}`, { name: "new" })).status,
    404,
  );
  assert.equal(
    (await request("PATCH", `/${plant.id}/health`, { healthStatus: "healthy" }))
      .status,
    404,
  );
  disappear = false;
  failWrite = true;
  const response = await request("PATCH", `/${plant.id}`, { name: "new" });
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: "Internal server error.",
    code: "INTERNAL_ERROR",
  });
  failWrite = false;
});
test("anonymous writes, invalid IDs, optional blanks, and write failures", async () => {
  assert.equal(
    (await request("POST", "", { name: "x", species: "x" }, null)).status,
    401,
  );
  assert.equal(
    (await request("DELETE", `/${randomUUID()}`, undefined, null)).status,
    401,
  );
  assert.equal((await request("DELETE", "/invalid")).status, 400);
  const plant = await (
    await request("POST", "", {
      name: "Fern",
      species: "Fern",
      location: " ",
      imageUrl: "",
    })
  ).json();
  assert.equal(plant.location, undefined);
  assert.equal(plant.imageUrl, undefined);
  disappear = true;
  assert.equal((await request("DELETE", `/${plant.id}`)).status, 404);
  disappear = false;
  failWrite = true;
  for (const response of [
    await request("POST", "", { name: "x", species: "x" }),
    await request("DELETE", `/${plant.id}`),
  ]) {
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: "Internal server error.",
      code: "INTERNAL_ERROR",
    });
  }
  failWrite = false;
});
