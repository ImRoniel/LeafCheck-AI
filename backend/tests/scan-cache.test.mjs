import express from "express";
import assert from "node:assert/strict";
import { after, before, beforeEach, mock, test } from "node:test";

const speciesName = "Ocimum basilicum";
const winner = {
  id: "cached-winner",
  speciesName,
  commonName: "Basil",
  idealLuxMin: 1200,
};
const conflict = (code) =>
  Object.assign(new Error(`Insertion failed: ${code}`), { code });
let server;
let baseUrl;
let lookup;
let insert;
let perenualData;
let reads;
let inserts;
let fetches;
let analyses;
let prompts;
let generationError;
let plantCreates;
let identifications;
let linkedDevice;
let deviceOwned;
let plantOwned;
let latestReading;
let telemetryReads;
let responseText;
let guidanceQueries;
let taskWrites;
let identificationWrites;
let healthWrites;
let writeOrder;
let writeFailure;
const captureWrite = (stage, data) => {
  writeOrder.push(stage);
  if (writeFailure === stage) throw new Error("private persistence detail");
  return data;
};
const originalKey = process.env.GEMINI_API_KEY;

before(async () => {
  mock.module(new URL("../src/lib/auth.js", import.meta.url).href, {
    namedExports: {
      requireAuth: (_req, res, next) => {
        res.locals.auth = { user: { id: "owner" } };
        next();
      },
    },
  });
  process.env.GEMINI_API_KEY = `AIza${"a".repeat(35)}`;
  mock.module(new URL("../src/lib/prisma-pg.js", import.meta.url).href, {
    namedExports: {
      prismaPg: {
        $transaction: async function (operation) {
          const snapshot = { plantCreates, analyses: [...analyses], taskWrites: [...taskWrites], identificationWrites: [...identificationWrites], healthWrites: [...healthWrites] };
          try { return await operation(this); }
          catch (error) {
            ({ plantCreates, analyses, taskWrites, identificationWrites, healthWrites } = snapshot);
            throw error;
          }
        },
        plant: {
          create: async ({ data }) => {
            captureWrite("plant", data);
            plantCreates++;
            return {
              id: "new-plant",
              name: "Basil",
              species: speciesName,
              deviceId: null,
            };
          },
          findFirst: async () => plantOwned ? ({
            id: "00000000-0000-4000-8000-000000000001",
            userId: "owner",
            name: "Basil",
            species: speciesName,
            deviceId: linkedDevice,
          }) : null,
          update: async ({ data }) => {
            healthWrites.push(captureWrite("health", data));
            return data;
          },
        },
        device: { findFirst: async ({ where }) => deviceOwned ? { id: where.id, userId: "owner" } : null },
        plantIdentification: { create: async ({ data }) => {
          identificationWrites.push(captureWrite("identification", data));
          return { id: "identification" };
        } },
        plantSpecCache: {
          findUnique: async (args) => {
            reads.push(args);
            return lookup(args);
          },
          create: async (args) => {
            inserts.push(args);
            return insert(args);
          },
        },
        aIAnalysis: {
          findMany: async (query) => { guidanceQueries.push(query); return analyses.map((data, index) => ({ id: `analysis-${index + 1}`, ...data })); },
          create: async ({ data }) => {
            analyses.push(captureWrite("analysis", data));
            return { id: `analysis-${analyses.length}` };
          },
        },
        careTask: {
          findMany: async (query) => { guidanceQueries.push(query); return taskWrites.map((data, index) => ({ id: `task-${index + 1}`, ...data })); },
          create: async ({ data }) => {
            taskWrites.push(captureWrite("tasks", data));
            return { id: `task-${taskWrites.length}`, ...data };
          },
        },
      },
    },
  });
  mock.module(new URL("../src/lib/prisma.js", import.meta.url).href, {
    namedExports: {
      prisma: { sensorReading: { findFirst: async () => { telemetryReads++; return latestReading; } } },
    },
  });
  mock.module(new URL("../src/lib/plantnet.js", import.meta.url).href, {
    namedExports: {
      identifyPlant: async () => { identifications++; return ({
        speciesName,
        commonName: "Basil",
        confidence: 0.99,
        rawResponse: {},
      }); },
    },
  });
  mock.module(new URL("../src/lib/perenual.js", import.meta.url).href, {
    namedExports: {
      fetchPlantSpecs: async () => {
        fetches++;
        return perenualData;
      },
    },
  });
  mock.module("@google/generative-ai", {
    namedExports: {
      GoogleGenerativeAI: class {
        getGenerativeModel() {
          return {
            generateContent: async (contents) => {
              if (generationError) throw generationError;
              prompts.push(contents[0]);
              return { response: { text: () => responseText } };
            },
          };
        }
      },
    },
  });
  const { scanRouter } = await import("../src/routes/scan.ts");
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use("/api/scan", scanRouter);
  app.use((await import("../src/lib/http.ts")).errorHandler);
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(() => {
  reads = [];
  inserts = [];
  analyses = [];
  prompts = [];
  fetches = 0;
  generationError = null;
  plantCreates = 0;
  identifications = 0;
  linkedDevice = null;
  deviceOwned = true;
  plantOwned = true;
  latestReading = null;
  telemetryReads = 0;
  responseText = "healthy";
  guidanceQueries = [];
  taskWrites = [];
  identificationWrites = [];
  healthWrites = [];
  writeOrder = [];
  writeFailure = null;
  perenualData = {
    speciesName,
    commonName: "Basil",
    idealLuxMin: 500,
    rawJson: {},
  };
  lookup = async () => null;
  insert = async ({ data }) => ({ id: "created", ...data });
});

after(async () => {
  if (server)
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = originalKey;
  mock.restoreAll();
});

async function scan(newPlant = false, extra = {}) {
  const response = await fetch(`${baseUrl}/api/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      imageBase64: "/9j/2Q==",
      ...(newPlant ? {} : { plantId: "00000000-0000-4000-8000-000000000001" }),
      ...extra,
    }),
  });
  return { status: response.status, body: await response.json() };
}

test("cache hit skips Perenual and insertion", async () => {
  lookup = async () => winner;
  assert.equal((await scan()).status, 201);
  assert.equal(fetches, 0);
  assert.equal(inserts.length, 0);
  assert.deepEqual(analyses[0].idealSpecs, winner);
});

test("saved task fields match the public response and trusted scan ownership", async () => {
  const diagnosticReport = "Inspect leaves.\nCare actions:\n- Inspect leaves on 2027-01-01 at 09:00 UTC\n- Check soil moisture; water only if dry on 2027-01-02 at 10:00 UTC";
  responseText = JSON.stringify({ healthStatus: "warning", diagnosticReport, careTasks: [{ title: "Contradictory provider task" }], notification: { notifyAt: "2027-01-02T09:00:00Z", reason: "Follow up" } });
  const result = await scan(true);
  assert.equal(result.status, 201);
  assert.equal(result.body.careTasks.length, 2);
  assert.equal(result.body.careTasks[0].title, "Inspect leaves");
  assert.match(result.body.careTasks[1].description, /only if dry/);
  assert.equal(result.body.diagnostic.rawAnalysisText, diagnosticReport);
  assert.equal(analyses[0].rawAnalysisText, diagnosticReport);
  assert.deepEqual(result.body.notification, { notifyAt: "2027-01-02T09:00:00Z", reason: "Follow up" });
  assert.deepEqual(taskWrites, result.body.careTasks.map((task) => ({ ...task, dueDate: new Date(task.dueDate), plantId: "new-plant", userId: "owner", analysisId: result.body.diagnostic.id, status: "PENDING" })));
  assert.deepEqual(writeOrder, ["plant", "identification", "analysis", "tasks", "tasks", "health"]);
  assert.equal(identificationWrites[0].plantId, "new-plant");
  assert.equal(healthWrites[0].healthStatus, "warning");
  assert.equal((await scan()).status, 201);
  assert.equal(plantCreates, 1);
  const loadedTasks = await (await fetch(`${baseUrl}/api/scan/tasks`)).json();
  assert.equal(loadedTasks.length, 4);
  assert.equal(loadedTasks[0].title, result.body.careTasks[0].title);
  const archives = await (await fetch(`${baseUrl}/api/scan/archives`)).json();
  assert.equal(archives[0].rawAnalysisText, diagnosticReport);
});

test("report without actions always writes one review task regardless of provider task array", async () => {
  responseText = JSON.stringify({ healthStatus: "healthy", diagnosticReport: "Healthy plant.", careTasks: [], notification: { notifyAt: "2027-01-02T09:00:00Z", reason: "Follow up" } });
  assert.equal((await scan()).status, 201);
  assert.equal(taskWrites.length, 1);
  assert.equal(taskWrites[0].title, "Review plant health");
  assert.equal(healthWrites.length, 1);
});

for (const stage of ["plant", "identification", "analysis", "tasks", "health"]) {
  test(`failure at ${stage} is sanitized and rolls back all scan writes`, async () => {
    writeFailure = stage;
    const result = await scan(true);
    assert.equal(result.status, 500);
    assert.equal(result.body.code, "SCAN_FAILED");
    assert.doesNotMatch(JSON.stringify(result.body), /private persistence/);
    assert.equal(plantCreates, 0);
    assert.equal(analyses.length, 0);
    assert.equal(identificationWrites.length, 0);
    assert.equal(taskWrites.length, 0);
    assert.equal(healthWrites.length, 0);
  });
}

test("plant guidance is filtered by the owned plant before limiting history", async () => {
  const plantId = "00000000-0000-4000-8000-000000000001";
  for (const endpoint of ["archives", "tasks"]) {
    const response = await fetch(`${baseUrl}/api/scan/${endpoint}?plantId=${plantId}`);
    assert.equal(response.status, 200);
    assert.deepEqual(guidanceQueries.at(-1).where, { userId: "owner", ...(endpoint === "archives" ? { isArchived: true } : {}), plantId });
    plantOwned = false;
    const count = guidanceQueries.length;
    assert.equal((await fetch(`${baseUrl}/api/scan/${endpoint}?plantId=${plantId}`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/scan/${endpoint}?plantId=invalid`)).status, 400);
    assert.equal(guidanceQueries.length, count);
    plantOwned = true;
  }
});

test("missing, malformed and oversized images are rejected before provider calls or writes", async () => {
  for (const imageBase64 of [undefined, null, 42, "", "mock-image", "YWJj", "data:image/jpeg;base64,/9j/2Q==", "/9j/2Q==\n"]) {
    const result = await scan(true, { imageBase64 });
    assert.equal(result.status, 400);
    assert.equal(result.body.code, "INVALID_IMAGE");
  }
  const oversized = "A".repeat(Math.ceil(7 * 1024 * 1024 / 3) * 4 + 4);
  const result = await scan(true, { imageBase64: oversized });
  assert.equal(result.status, 413);
  assert.equal(result.body.code, "IMAGE_TOO_LARGE");
  for (const location of [42, {}, "x".repeat(101)]) assert.equal((await scan(true, { location })).status, 400);
  assert.equal(identifications, 0);
  assert.equal(fetches, 0);
  assert.equal(plantCreates, 0);
  assert.equal(analyses.length, 0);
});

test("foreign plants and linked devices are blocked before providers and telemetry reads", async () => {
  const deviceId = "00000000-0000-4000-8000-000000000002";
  plantOwned = false;
  assert.equal((await scan()).status, 404);
  plantOwned = true;
  linkedDevice = deviceId;
  deviceOwned = false;
  assert.equal((await scan()).status, 404);
  assert.equal((await scan(false, { deviceId })).status, 404);
  assert.equal((await scan(true, { deviceId })).status, 404);
  deviceOwned = true;
  assert.equal((await scan(false, { deviceId: "00000000-0000-4000-8000-000000000003" })).status, 404);
  assert.equal(identifications, 0);
  assert.equal(telemetryReads, 0);
  assert.equal(analyses.length, 0);
});

test("owned device telemetry and stale context are preserved with diagnostic text", async () => {
  linkedDevice = "00000000-0000-4000-8000-000000000002";
  latestReading = {
    deviceId: linkedDevice, timestamp: new Date(Date.now() - 60 * 60_000),
    temperature: 25, humidity: 60, soilMoisture: 50, lightLevel: 1000,
  };
  const result = await scan();
  assert.equal(result.status, 201);
  assert.equal(result.body.identification.speciesName, speciesName);
  assert.equal(result.body.diagnostic.rawAnalysisText, "healthy");
  assert.match(result.body.diagnostic.telemetryFreshness, /STALE/);
  assert.equal(result.body.telemetry.timestamp, latestReading.timestamp.toISOString());
  assert.equal(analyses[0].telemetrySnapshot.deviceId, linkedDevice);
  assert.equal(analyses[0].userId, "owner");
});

test("malformed AI structures fail safely before creating plants or analyses", async () => {
  const valid = {
    healthStatus: "warning", diagnosticReport: "Inspect the leaves.", careTasks: [],
    notification: { notifyAt: new Date().toISOString(), reason: "Follow up" },
  };
  for (const output of [null, [], {}, { ...valid, healthStatus: ["healthy"] },
    { ...valid, diagnosticReport: {} }, { ...valid, diagnosticReport: "x".repeat(50001) },
    { ...valid, notification: { notifyAt: "invalid", reason: "x" } },
  ]) {
    responseText = JSON.stringify(output);
    const result = await scan(true);
    assert.equal(result.status, 502);
    assert.equal(result.body.code, "SCAN_AI_UNAVAILABLE");
    assert.equal(plantCreates, 0);
    assert.equal(analyses.length, 0);
  }
  responseText = JSON.stringify({
    ...valid,
    careTasks: [{ title: "Inspect leaves", taskType: "OTHER", description: "Check for spots", urgency: "routine", dueDate: new Date().toISOString(), providerDebug: "internal" }],
    notification: { ...valid.notification, providerDebug: "internal" },
  });
  const success = await scan();
  assert.equal(success.status, 201);
  assert.equal(success.body.diagnostic.healthStatus, "warning");
  assert.equal(success.body.diagnostic.rawAnalysisText, valid.diagnosticReport);
  assert.equal(success.body.careTasks[0].providerDebug, undefined);
  assert.equal(success.body.notification.providerDebug, undefined);
});

test("cache miss inserts specifications normally", async () => {
  assert.equal((await scan()).status, 201);
  assert.equal(fetches, 1);
  assert.equal(inserts.length, 1);
  assert.equal(reads.length, 1);
  assert.equal(analyses[0].idealSpecs.id, "created");
});

test(
  "two simultaneous misses reuse the winner without failing either scan",
  { timeout: 5000 },
  async () => {
    let release;
    const bothMissed = new Promise((resolve) => {
      release = resolve;
    });
    let misses = 0;
    let persisted = null;
    lookup = async () => {
      if (persisted) return persisted;
      if (++misses === 2) release();
      await bothMissed;
      return null;
    };
    insert = async () => {
      if (persisted) throw conflict("P2002");
      persisted = winner;
      return persisted;
    };
    const results = await Promise.all([scan(), scan()]);
    assert.deepEqual(
      results.map((result) => result.status),
      [201, 201],
    );
    assert.equal(misses, 2);
    assert.equal(inserts.length, 2);
    assert.equal(reads.length, 3);
    assert.equal(analyses.length, 2);
    for (const analysis of analyses)
      assert.deepEqual(analysis.idealSpecs, winner);
    for (const prompt of prompts) assert.ok(prompt.includes("1200"));
  },
);

test("recovery reads the Perenual insertion key rather than the identification name", async () => {
  perenualData.speciesName = "Ocimum basilicum L.";
  const canonical = { ...winner, speciesName: perenualData.speciesName };
  lookup = async () => (reads.length === 1 ? null : canonical);
  insert = async () => {
    throw conflict("P2002");
  };
  assert.equal((await scan()).status, 201);
  assert.equal(reads[0].where.speciesName, speciesName);
  assert.equal(reads[1].where.speciesName, perenualData.speciesName);
  assert.deepEqual(analyses[0].idealSpecs, canonical);
});

test("write conflict recovers when a persisted record exists", async () => {
  lookup = async () => (reads.length === 1 ? null : winner);
  insert = async () => {
    throw conflict("P2034");
  };
  assert.equal((await scan()).status, 201);
  assert.deepEqual(analyses[0].idealSpecs, winner);
});

for (const code of ["P2002", "P2034"]) {
  test(`${code} with no winning record preserves the insertion error`, async () => {
    const error = conflict(code);
    insert = async () => {
      throw error;
    };
    const result = await scan();
    assert.equal(result.status, 500);
    assert.equal(result.body.code, "SCAN_FAILED");
    assert.equal(reads.length, 2);
    assert.equal(analyses.length, 0);
  });
}

test("unrelated insertion failure does not trigger a recovery read", async () => {
  const error = conflict("P1001");
  insert = async () => {
    throw error;
  };
  const result = await scan();
  assert.equal(result.status, 500);
  assert.equal(result.body.code, "SCAN_FAILED");
  assert.equal(reads.length, 1);
});

test("recovery read failure reaches the existing error handler", async () => {
  insert = async () => {
    throw conflict("P2002");
  };
  lookup = async () => {
    if (reads.length > 1) throw new Error("Recovery database unavailable");
    return null;
  };
  const result = await scan();
  assert.equal(result.status, 500);
  assert.equal(result.body.code, "SCAN_FAILED");
  assert.equal(analyses.length, 0);
});

test("missing Perenual specifications retain general-advice behavior", async () => {
  perenualData = null;
  assert.equal((await scan()).status, 201);
  assert.equal(inserts.length, 0);
  assert.equal(analyses[0].idealSpecs, undefined);
  assert.ok(prompts[0].includes("No ideal species specs available"));
});

test("Gemini authentication failure is sanitized and subsequent scans still work", async () => {
  generationError = Object.assign(
    new Error("ACCESS_TOKEN_TYPE_UNSUPPORTED private-key"),
    { status: 401 },
  );
  const failed = await scan();
  assert.equal(failed.status, 503);
  assert.equal(failed.body.code, "SCAN_AI_CONFIGURATION");
  assert.doesNotMatch(JSON.stringify(failed.body), /private-key|ACCESS_TOKEN/);
  assert.equal(analyses.length, 0);
  generationError = null;
  assert.equal((await scan()).status, 201);
});

test("provider failure does not create a new plant; a successful scan creates it once", async () => {
  generationError = Object.assign(new Error("unauthorized"), { status: 401 });
  assert.equal((await scan(true)).status, 503);
  assert.equal(plantCreates, 0);
  generationError = null;
  assert.equal((await scan(true)).status, 201);
  assert.equal(plantCreates, 1);
});

test("invalid runtime credential fails before cache work and recovers after replacement", async () => {
  const key = process.env.GEMINI_API_KEY;
  try {
    process.env.GEMINI_API_KEY = "invalid-provider-credential";
    const failed = await scan(true);
    assert.equal(failed.status, 503);
    assert.equal(failed.body.code, "SCAN_AI_CONFIGURATION");
    assert.equal(reads.length, 0);
    assert.equal(plantCreates, 0);
    process.env.GEMINI_API_KEY = key;
    assert.equal((await scan(true)).status, 201);
  } finally {
    process.env.GEMINI_API_KEY = key;
  }
});
