import express from "express";
import assert from "node:assert/strict";
import { after, before, beforeEach, mock, test } from "node:test";
import { HttpError } from "../src/lib/http.ts";

const speciesName = "Ocimum basilicum";
const newPlantId = "00000000-0000-4000-8000-000000000099";
const existingPlantId = "00000000-0000-4000-8000-000000000001";
const sessionId = "00000000-0000-4000-8000-000000000003";
const readingId = "000000000000000000000001";
let createdPlant, pairingRows;
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
let telemetryQueries, sensorMac;
let scanSession, extraReadings, previousIdentifications, identificationQueries, diagnosisGate, extraPlants;
const currentSession = () => scanSession === null || !linkedDevice ? null : scanSession ?? {
  id: sessionId, plantId: existingPlantId, deviceId: linkedDevice, pairedAt: new Date(0), unpairedAt: null,
};
const currentReadingWhere = () => ({ plantId: existingPlantId, pairingId: currentSession().id, contextVersion: 1 });
let savedImageUrl, sentImages;
let responseText;
let guidanceQueries;
let taskWrites;
let identificationWrites;
let healthWrites;
let writeOrder;
let writeFailure;
let imageFailure, imageWrites, discardedImages, noPlantIdentification;
let identificationError, detectionText, subjectPrompts, subjectImages, stageCalls, speciesRequests, diagnosisError;
let existingHealthStatus;
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
        platformSettings: { findUnique: async () => null },
        $transaction: async function (operation,options) {
          assert.equal(options.isolationLevel,"Serializable");
          const snapshot = structuredClone({ plantCreates, createdPlant, pairingRows, analyses, taskWrites, identificationWrites, healthWrites, previousIdentifications });
          try { return await operation(this); }
          catch (error) {
            ({ plantCreates, createdPlant, pairingRows, analyses, taskWrites, identificationWrites, healthWrites, previousIdentifications } = snapshot);
            throw error;
          }
        },
        plant: {
          create: async ({ data }) => {
            captureWrite("plant", data);
            plantCreates++;
            createdPlant = {
              id: newPlantId,
              userId:"owner",
              name: data.name,
              species: data.species,
              deviceId: data.deviceId ?? null,
              healthStatus: data.healthStatus,
            };
            return createdPlant;
          },
          findFirst: async ({where}) => where.id === newPlantId ? createdPlant : plantOwned ? extraPlants.get(where.id) ?? ({
            id: "00000000-0000-4000-8000-000000000001",
            userId: "owner",
            name: "Basil",
            species: speciesName,
            deviceId: linkedDevice,
            imageUrl: savedImageUrl,
            healthStatus: existingHealthStatus,
          }) : null,
          updateMany: async () => ({count:0}),
          update: async ({ data }) => {
            if (Object.hasOwn(data,"deviceId")) { Object.assign(createdPlant,data); return {...createdPlant}; }
            healthWrites.push(captureWrite("health", data));
            return data;
          },
        },
        device: { findFirst: async ({ where }) => deviceOwned ? { id: where.id, userId: "owner", macAddress: sensorMac } : null },
        devicePairingHistory: {
          findMany: async () => pairingRows.filter(row => row.unpairedAt === null),
          findFirst: async ({where}) => {
            const session = currentSession();
            return where.unpairedAt === null && session?.plantId === where.plantId && session?.deviceId === where.deviceId ? session : null;
          },
          updateMany: async ({data}) => { for(const row of pairingRows) if(row.unpairedAt === null) Object.assign(row,data); return {count:0}; },
          create: async ({data}) => { const row = {id:`pairing-${pairingRows.length}`,unpairedAt:null,...data}; pairingRows.push(row); return row; },
        },
        plantIdentification: { findMany: async query => {
          identificationQueries.push(query);
          assert.deepEqual(query.where, {plantId: existingPlantId, plant: {userId: "owner"}});
          return previousIdentifications;
        }, create: async ({ data }) => {
          identificationWrites.push(captureWrite("identification", data));
          const row = { id: `identification-${identificationWrites.length}`, ...data };
          previousIdentifications.unshift(row);
          return row;
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
          findMany: async (query) => {
            guidanceQueries.push(query);
            return analyses.map((data, index) => ({ id: `analysis-${index + 1}`, createdAt: new Date(), ...data }))
              .filter(row => row.userId === query.where.userId && row.isArchived === query.where.isArchived &&
                (!query.where.plantId || row.plantId === query.where.plantId) &&
                (!query.where.createdAt || row.createdAt >= query.where.createdAt.gte));
          },
          create: async ({ data }) => {
            analyses.push(captureWrite("analysis", data));
            return { id: `analysis-${analyses.length}`, createdAt: new Date() };
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
      prisma: { sensorReading: { findFirst: async (query) => {
        telemetryReads++; telemetryQueries.push(query);
        return [...extraReadings, latestReading].filter(Boolean).map(row => ({
          id: readingId, plantId: existingPlantId, pairingId: currentSession()?.id, contextVersion: 1, ...row,
        })).filter(row => Object.entries(query.where).every(([key, value]) => row[key] === value))
          .sort((a,b) => b.timestamp - a.timestamp || b.id.localeCompare(a.id))[0] ?? null;
      } } },
    },
  });
  mock.module(new URL("../src/lib/plantnet.js", import.meta.url).href, {
    namedExports: {
      identifyPlant: async () => { stageCalls.push("plantnet"); identifications++; if (identificationError) throw identificationError; if (noPlantIdentification) { throw new HttpError(422, "NO_PLANT_DETECTED", "No plant"); } return ({
        speciesName,
        commonName: "Basil",
        confidence: 0.99,
        rawResponse: {},
      }); },
    },
  });
  mock.module(new URL("../src/lib/perenual.js", import.meta.url).href, {
    namedExports: {
      fetchPlantSpecs: async (...args) => {
        stageCalls.push("perenual"); speciesRequests.push(args);
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
              const subjectCheck = contents[0].includes("subject check for a plant-care scan");
              stageCalls.push(subjectCheck ? "subject" : "diagnosis");
              if (generationError) throw generationError;
              if (subjectCheck) {
                subjectPrompts.push(contents[0]); subjectImages.push(contents[1].inlineData.data);
                let subjectKind = "living_plant";
                try { subjectKind = JSON.parse(responseText).subjectKind ?? "living_plant"; } catch { /* The diagnosis response is tested separately. */ }
                const text = detectionText ?? JSON.stringify({ subjectKind, speciesName, commonName: "Basil", confidence: 0.95 });
                return { response: { text: () => text } };
              }
              if (diagnosisError) throw diagnosisError;
              prompts.push(contents[0]);
              sentImages.push(contents[1].inlineData.data);
              if (diagnosisGate) { diagnosisGate.arrive(); await diagnosisGate.ready; }
              return { response: { text: () => responseText } };
            },
          };
        }
      },
    },
  });
  mock.module(new URL("../src/lib/scan-image-storage.js", import.meta.url).href, {
    namedExports: {
      storeScanImage: async () => { imageWrites++; if (imageFailure) return {imageUrl: "data:image/jpeg;base64,/9j/2Q==", uploadFailed: true}; return {imageUrl: "https://example.com/plant.jpg", cloudinaryPublicId: "plant-photos/owner/test"}; },
      discardScanImage: async () => { discardedImages++; },
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
  createdPlant = null; pairingRows = [];
  identifications = 0;
  linkedDevice = null;
  deviceOwned = true;
  plantOwned = true;
  latestReading = null;
  telemetryReads = 0;
  telemetryQueries = []; sensorMac = "LC-A50528";
  scanSession = undefined; extraReadings = []; diagnosisGate = null;
  extraPlants = new Map();
  previousIdentifications = [{id: "original-identification", confidence: 0.989, rawResponse: {results: []}}]; identificationQueries = [];
  savedImageUrl = "data:image/jpeg;base64,/9j/2Q=="; sentImages = [];
  responseText = JSON.stringify({subjectKind: "living_plant", healthStatus: "healthy", diagnosticReport: "healthy", notification: {notifyAt: "2027-01-02T09:00:00Z", reason: "Follow up"}});
  imageFailure = false; imageWrites = 0; discardedImages = 0; noPlantIdentification = false;
  identificationError = null; detectionText = undefined; subjectPrompts = []; subjectImages = []; stageCalls = []; speciesRequests = []; diagnosisError = null;
  existingHealthStatus = "healthy";
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

test("re-evaluation reuses the owned saved photo, session telemetry and confidence without uploading", async () => {
  linkedDevice = "00000000-0000-4000-8000-000000000002";
  latestReading = { deviceId: sensorMac, timestamp: new Date(), temperature: 32.19, humidity: 76.34,
    soilMoistureRaw: 2625, lightLux: 0.83 };
  const result = await scan(false, { imageBase64: undefined, reusePreviousImage: true });
  assert.equal(result.status, 201);
  assert.equal(identifications, 0); assert.equal(subjectImages.length, 0);
  assert.deepEqual(sentImages, ["/9j/2Q=="]);
  assert.match(prompts[0], /Raw ADC: 2625/);
  assert.deepEqual(telemetryQueries[0].where, currentReadingWhere());
  assert.equal(result.body.identification.confidence, 0.989);
  assert.equal(result.body.identificationReused, true);
  assert.equal(imageWrites, 0);
  assert.equal(discardedImages, 0);
  assert.equal(healthWrites[0].imageUrl, undefined);
  assert.equal(analyses.length, 1);
  assert.equal(taskWrites.length, 1);
  assert.ok(Number.isFinite(Date.parse(result.body.diagnostic.createdAt)));
});

test("reusing photos requires an owned plant, a saved image and a boolean flag before providers", async () => {
  assert.equal((await scan(true, { reusePreviousImage: true })).status, 400);
  assert.equal((await scan(false, { reusePreviousImage: "true" })).status, 400);
  savedImageUrl = null;
  assert.equal((await scan(false, { imageBase64: undefined, reusePreviousImage: true })).body.code, "NO_SAVED_IMAGE");
  plantOwned = false;
  assert.equal((await scan(false, { reusePreviousImage: true })).status, 404);
  assert.equal(identifications, 0);
  assert.equal(telemetryReads, 0);
  assert.equal(imageWrites, 0);
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
  responseText = JSON.stringify({ subjectKind: "living_plant", healthStatus: "warning", diagnosticReport, careTasks: [{ title: "Contradictory provider task" }], notification: { notifyAt: "2027-01-02T09:00:00Z", reason: "Follow up" } });
  const result = await scan(true);
  assert.equal(result.status, 201);
  assert.equal(result.body.careTasks.length, 2);
  assert.equal(result.body.careTasks[0].title, "Inspect leaves");
  assert.match(result.body.careTasks[1].description, /only if dry/);
  assert.equal(result.body.diagnostic.rawAnalysisText, diagnosticReport);
  assert.equal(analyses[0].rawAnalysisText, diagnosticReport);
  assert.deepEqual(result.body.notification, { notifyAt: "2027-01-02T09:00:00Z", reason: "Follow up" });
  assert.deepEqual(taskWrites, result.body.careTasks.map((task) => ({ ...task, dueDate: new Date(task.dueDate), plantId: newPlantId, userId: "owner", analysisId: result.body.diagnostic.id, status: "PENDING" })));
  assert.deepEqual(writeOrder, ["plant", "identification", "analysis", "tasks", "tasks", "health"]);
  assert.equal(identificationWrites[0].plantId, newPlantId);
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
  responseText = JSON.stringify({ subjectKind: "living_plant", healthStatus: "healthy", diagnosticReport: "Healthy plant.", careTasks: [], notification: { notifyAt: "2027-01-02T09:00:00Z", reason: "Follow up" } });
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

test("archives return only the owned plant and apply rolling date filters before limiting", async () => {
  const plantId = "00000000-0000-4000-8000-000000000001";
  const now = Date.now();
  analyses = [1, 20, 40].map(days => ({ plantId, userId: "owner", isArchived: true, createdAt: new Date(now - days * 86400000) }));
  analyses.push({ ...analyses[0], plantId: "other-plant" }, { ...analyses[0], userId: "other-user" }, { ...analyses[0], isArchived: false });
  for (const [days, expected] of [[undefined, 3], [7, 1], [30, 2]]) {
    const response = await fetch(`${baseUrl}/api/scan/archives?plantId=${plantId}${days ? `&days=${days}` : ""}`);
    assert.equal(response.status, 200);
    const rows = await response.json();
    assert.equal(rows.length, expected);
    assert.ok(rows.every(row => row.plantId === plantId && row.userId === "owner"));
    const query = guidanceQueries.at(-1);
    assert.equal(query.where.plantId, plantId);
    assert.equal(query.take, 50);
    if (days) assert.ok(Math.abs(query.where.createdAt.gte.getTime() - (now - days * 86400000)) < 3000);
    else assert.equal(query.where.createdAt, undefined);
  }
  const count = guidanceQueries.length;
  assert.equal((await fetch(`${baseUrl}/api/scan/archives?days=invalid`)).status, 400);
  assert.equal(guidanceQueries.length, count);
});

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
    deviceId: sensorMac, timestamp: new Date(Date.now() - 60 * 60_000),
    temperature: 25, humidity: 60, soilMoisture: 2652, lightLux: 1000,
  };
  const result = await scan();
  assert.equal(result.status, 201);
  assert.equal(result.body.identification.speciesName, speciesName);
  assert.equal(result.body.diagnostic.rawAnalysisText, "healthy");
  assert.match(result.body.diagnostic.telemetryFreshness, /STALE/);
  assert.equal(result.body.telemetry.timestamp, latestReading.timestamp.toISOString());
  assert.equal(analyses[0].telemetrySnapshot.deviceId, sensorMac);
  assert.match(prompts[0], /STALE/);
  assert.equal(analyses[0].userId, "owner");
});

test("paired hardware scan combines the image prompt with session telemetry and specific care actions", async () => {
  linkedDevice = "00000000-0000-4000-8000-000000000002";
  latestReading = {
    deviceId: sensorMac, timestamp: new Date(), temperature: 32.19, humidity: 76.34,
    soilMoisture: 2625, soilMoistureRaw: null, lightLux: 0.83,
  };
  const diagnosticReport = "Light is low.\nCare actions:\n- Move the plant to brighter indirect light on 2027-01-01 at 09:00 UTC";
  responseText = JSON.stringify({ subjectKind: "living_plant", healthStatus: "warning", diagnosticReport,
    notification: { notifyAt: "2027-01-02T09:00:00Z", reason: "Review light exposure" } });
  const result = await scan();
  assert.equal(result.status, 201);
  assert.deepEqual(telemetryQueries, [{ where: currentReadingWhere(), orderBy: [{timestamp: "desc"}, {id: "desc"}] }]);
  for (const pattern of [/Temperature: 32\.19°C/, /Humidity: 76\.34%/, /Raw ADC: 2625/, /Ambient Light: 0\.83 lux/,
    /Use this environmental data together with the image/, /Do not infer dry or wet soil/, /FRESH/]) assert.match(prompts[0], pattern);
  assert.doesNotMatch(prompts[0], /2625%/);
  assert.deepEqual(result.body.telemetry, { temperature: 32.19, humidity: 76.34,
    soilMoisture: null, soilMoistureRaw: 2625, lightLevel: 0.83, timestamp: latestReading.timestamp.toISOString() });
  assert.match(result.body.careTasks[0].title, /brighter indirect light/);
  assert.equal(taskWrites[0].analysisId, result.body.diagnostic.id);
  assert.equal(result.body.telemetrySnapshot.plantId, existingPlantId);
  assert.equal(result.body.telemetrySnapshot.pairingId, sessionId);
  assert.equal(result.body.telemetrySnapshot.readingId, readingId);
  assert.equal(result.body.telemetrySnapshot.contextVersion, 1);
  assert.equal(result.body.telemetrySnapshot.source, "current_session");
  assert.deepEqual(analyses[0].telemetrySnapshot, result.body.telemetrySnapshot);
  assert.equal(result.body.identificationReused, false);
});

test("a new plant's first scan stays image-only even when its requested sensor has readings", async () => {
  const deviceId = "00000000-0000-4000-8000-000000000002";
  latestReading = { deviceId: sensorMac, timestamp: new Date(), temperature: 25, humidity: 50,
    soilMoisture: 2500, soilMoistureRaw: 0, lightLux: 0 };
  const result = await scan(true, { deviceId });
  assert.equal(result.status, 201);
  assert.equal(telemetryReads, 0);
  assert.equal(result.body.telemetry, null);
  assert.deepEqual(result.body.telemetrySnapshot, {source: "none"});
  assert.deepEqual(analyses[0].telemetrySnapshot, {source: "none"});
  assert.equal(result.body.plant.deviceId, deviceId);
  assert.equal(pairingRows.length, 1);
  assert.doesNotMatch(prompts[0], /Actual Sensor Readings|Ambient Light: 0 lux/);
});

test("demo scans retain calibrated percentages, session attribution and simulated context", async () => {
  linkedDevice = "00000000-0000-4000-8000-000000000002"; sensorMac = "DEMO:plant";
  latestReading = { deviceId: linkedDevice, timestamp: new Date(), temperature: 25, humidity: 50,
    soilMoisture: 50, lightLevel: 1000 };
  const result = await scan();
  assert.equal(result.status, 201);
  assert.deepEqual(telemetryQueries[0].where, currentReadingWhere());
  assert.match(prompts[0], /Simulated Sensor Readings/);
  assert.match(prompts[0], /Calibrated Soil Moisture: 50%/);
  assert.equal(result.body.telemetry.soilMoisture, 50);
  assert.equal(result.body.telemetry.lightLevel, 1000);
});

test("unpaired scans stay image-only and paired sensors without readings disclose missing data", async () => {
  let result = await scan();
  assert.equal(result.status, 201);
  assert.equal(telemetryReads, 0);
  assert.equal(result.body.telemetry, null);
  assert.match(prompts[0], /Environmental analysis is based on image only/);
  linkedDevice = "00000000-0000-4000-8000-000000000002";
  result = await scan();
  assert.equal(result.status, 201);
  assert.equal(result.body.telemetry, null);
  assert.match(prompts[1], /No telemetry data found for this plant's active pairing session/);
  assert.doesNotMatch(prompts[1], /Actual Sensor Readings/);
});

test("malformed diagnosis reports save confirmed plants without inventing advice", async () => {
  detectionText = JSON.stringify({ subjectKind: "living_plant", speciesName, commonName: "Basil", confidence: 0.9 });
  const valid = {
    subjectKind: "living_plant", healthStatus: "warning", diagnosticReport: "Inspect the leaves.", careTasks: [],
    notification: { notifyAt: new Date().toISOString(), reason: "Follow up" },
  };
  for (const output of [null, [], {}, { ...valid, healthStatus: ["healthy"] },
    { ...valid, diagnosticReport: {} }, { ...valid, diagnosticReport: "x".repeat(50001) },
    { ...valid, notification: { notifyAt: "invalid", reason: "x" } },
  ]) {
    responseText = JSON.stringify(output);
    const result = await scan(true);
    assert.equal(result.status, 201);
    assert.equal(result.body.diagnosisError, true);
    assert.equal(result.body.diagnosisCode, "SCAN_AI_UNAVAILABLE");
    assert.equal(result.body.diagnostic.rawAnalysisText, null);
    assert.equal(result.body.diagnostic.healthStatus, "unknown");
    assert.equal(taskWrites.length, 0);
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

for (const subjectKind of ["artificial_plant", "non_plant"]) {
  for (const newPlant of [false, true]) {
    test(`${subjectKind} returns a short message without plant or image persistence (${newPlant ? "new" : "existing"})`, async () => {
      responseText = JSON.stringify({subjectKind, healthStatus: "critical", diagnosticReport: "A very long incorrect essay", notification: {reason: "Treat this plant"}});
      const result = await scan(newPlant);
      assert.equal(result.status, 200);
      assert.equal(result.body.plant, null);
      assert.equal(result.body.identification, null);
      assert.equal(result.body.notification, null);
      assert.deepEqual(result.body.careTasks, []);
      assert.equal(result.body.diagnostic.healthStatus, "unknown");
      assert.ok(result.body.diagnostic.rawAnalysisText.length < 160);
      assert.equal(plantCreates, 0); assert.equal(healthWrites.length, 0);
      assert.equal(analyses.length, 0); assert.equal(taskWrites.length, 0);
      assert.equal(identificationWrites.length, 0); assert.equal(imageWrites, 0);
    });
  }
}
test("Pl@ntNet no-match still allows Gemini to identify a nonliving object", async () => {
  noPlantIdentification = true;
  responseText = JSON.stringify({subjectKind: "non_plant"});
  const result = await scan(true);
  assert.equal(result.status, 200); assert.equal(result.body.subjectKind, "non_plant");
  assert.equal(fetches, 0); assert.equal(plantCreates, 0);
});

for (const [cause, error] of [
  ["timeout", new HttpError(504, "PLANT_IDENTIFICATION_TIMEOUT", "private timeout URL")],
  ["quota", new HttpError(429, "PLANT_IDENTIFICATION_FAILED", "private quota URL")],
  ["server failure", new HttpError(500, "PLANT_IDENTIFICATION_FAILED", "private provider credential")],
  ["network failure", new Error("https://provider.test?api-key=private-key")],
  ["missing key", new HttpError(503, "PLANT_IDENTIFICATION_FAILED", "Plant identification is temporarily unavailable.")],
]) {
  test(`Pl@ntNet ${cause} falls back to Gemini species identification, enrichment, diagnosis and save`, async t => {
    const errors = [];
    t.mock.method(console, "error", (...args) => errors.push(args));
    identificationError = error;
    detectionText = JSON.stringify({ subjectKind: "living_plant", speciesName: "Monstera deliciosa", commonName: "Monstera", confidence: 0.88 });
    perenualData = { ...perenualData, speciesName: "Monstera deliciosa", commonName: "Monstera" };
    const result = await scan(true);
    assert.equal(result.status, 201);
    assert.match(subjectPrompts[0], /"speciesName":"Unknown"/);
    assert.deepEqual(stageCalls, ["plantnet", "subject", "perenual", "diagnosis"]);
    assert.deepEqual(speciesRequests, [["Monstera deliciosa", "Monstera"]]);
    assert.deepEqual(subjectImages, ["/9j/2Q=="]); assert.deepEqual(sentImages, ["/9j/2Q=="]);
    assert.equal(result.body.identification.speciesName, "Monstera deliciosa");
    assert.equal(result.body.identification.confidence, 0.88);
    assert.equal(identificationWrites[0].rawResponse.source, "gemini");
    assert.equal(healthWrites[0].species, "Monstera deliciosa");
    assert.equal(plantCreates, 1); assert.equal(analyses.length, 1); assert.equal(taskWrites.length, 1);
    assert.match(JSON.stringify(errors), /continuing with Gemini/);
    assert.doesNotMatch(JSON.stringify(errors), /private|api-key=/);
  });
}

test("Pl@ntNet no-match does not veto a living plant identified by Gemini", async () => {
  noPlantIdentification = true;
  const result = await scan(true);
  assert.equal(result.status, 201); assert.equal(result.body.identification.speciesName, speciesName);
  assert.equal(plantCreates, 1); assert.equal(fetches, 1);
});

test("Gemini can correct a successful Pl@ntNet suggestion before the species reference lookup", async () => {
  detectionText = JSON.stringify({ subjectKind: "living_plant", speciesName: "Monstera deliciosa", commonName: "Monstera", confidence: 0.85 });
  perenualData = null;
  const result = await scan(true);
  assert.equal(result.status, 201);
  assert.deepEqual(speciesRequests, [["Monstera deliciosa", "Monstera"]]);
  assert.equal(result.body.plant.species, "Monstera deliciosa");
  assert.equal(identificationWrites[0].rawResponse.source, "gemini");
});

test("Gemini checks the subject before enrichment even when Pl@ntNet identifies a species", async () => {
  responseText = JSON.stringify({ subjectKind: "artificial_plant" });
  const result = await scan(true);
  assert.equal(result.status, 200); assert.equal(result.body.subjectKind, "artificial_plant");
  assert.deepEqual(stageCalls, ["plantnet", "subject"]);
  assert.equal(fetches, 0); assert.equal(reads.length, 0); assert.equal(imageWrites, 0); assert.equal(plantCreates, 0);
});

test("unclear living species can receive general diagnosis without querying or caching Unknown", async () => {
  identificationError = new Error("offline");
  detectionText = JSON.stringify({ subjectKind: "living_plant", speciesName: "Unknown", commonName: null, confidence: 0 });
  const result = await scan(true);
  assert.equal(result.status, 201); assert.equal(result.body.identification.speciesName, "Unknown");
  assert.equal(fetches, 0); assert.equal(reads.length, 0); assert.equal(inserts.length, 0);
  assert.match(prompts[0], /No ideal species specs available/);
  assert.equal(analyses.length, 1);
});

test("failed Pl@ntNet plus failed Gemini returns only a sanitized Gemini error and saves nothing", async () => {
  identificationError = new Error("private plantnet key");
  generationError = Object.assign(new Error("private Gemini key"), { status: 429 });
  const result = await scan(true);
  assert.equal(result.status, 503); assert.equal(result.body.code, "SCAN_AI_BUSY");
  assert.doesNotMatch(JSON.stringify(result.body), /identification service|private/);
  assert.equal(plantCreates, 0); assert.equal(analyses.length, 0); assert.equal(fetches, 0);
});

test("fallback Gemini diagnosis failure preserves the confirmed plant and photo", async () => {
  identificationError = new Error("offline");
  diagnosisError = new Error("private generation detail");
  const result = await scan(true);
  assert.equal(result.status, 201); assert.equal(result.body.diagnosisError, true);
  assert.equal(result.body.diagnosisCode, "SCAN_AI_UNAVAILABLE");
  assert.equal(plantCreates, 1); assert.equal(identificationWrites.length, 1); assert.equal(imageWrites, 1);
  assert.equal(result.body.diagnostic.rawAnalysisText, null); assert.equal(taskWrites.length, 0);
  assert.equal(healthWrites[0].imageUrl, "https://example.com/plant.jpg");
});

test("invalid Gemini subject identities stop before enrichment or persistence", async () => {
  for (const value of ["not JSON", { subjectKind: "invalid" }, { subjectKind: "living_plant", speciesName: "Fern" },
    { subjectKind: "living_plant", speciesName: "Fern", commonName: null, confidence: 2 }]) {
    detectionText = typeof value === "string" ? value : JSON.stringify(value);
    const result = await scan(true);
    assert.equal(result.status, 502); assert.equal(result.body.code, "SCAN_AI_UNAVAILABLE");
    assert.equal(fetches, 0); assert.equal(reads.length, 0); assert.equal(plantCreates, 0);
  }
});
test("living scan saves its profile photo and returns the paired device ID", async () => {
  linkedDevice = "00000000-0000-4000-8000-000000000002";
  const result = await scan();
  assert.equal(result.status, 201);
  assert.equal(healthWrites[0].imageUrl, "https://example.com/plant.jpg");
  assert.equal(result.body.plant.deviceId, linkedDevice);
  assert.equal(result.body.photoSaveFailed, false);
});
test("photo upload failure preserves diagnosis and signals a frontend toast", async () => {
  imageFailure = true;
  const result = await scan(true);
  assert.equal(result.status, 201); assert.equal(result.body.photoSaveFailed, true);
  assert.equal(healthWrites[0].imageUrl, "data:image/jpeg;base64,/9j/2Q=="); assert.equal(analyses.length, 1);
});
test("failed scan persistence cleans up its newly uploaded photo", async () => {
  writeFailure = "analysis";
  const result = await scan(true);
  assert.equal(result.status, 500); assert.equal(discardedImages, 1);
});
test("unclassified diagnosis text preserves identity after a valid living-plant check", async () => {
  detectionText = JSON.stringify({ subjectKind: "living_plant", speciesName, commonName: "Basil", confidence: 0.9 });
  for (const response of ["healthy", JSON.stringify({subjectKind: "invalid"}), JSON.stringify({healthStatus: "healthy"})]) {
    responseText = response;
    const result = await scan(true);
    assert.equal(result.status, 201); assert.equal(result.body.diagnosisError, true);
    assert.equal(result.body.diagnostic.rawAnalysisText, null); assert.equal(taskWrites.length, 0);
  }
});

for (const [name, error] of [["quota", Object.assign(new Error("Too many requests"), { status: 429 })],
  ["timeout", Object.assign(new Error("Request timed out"), { name: "TimeoutError" })]]) {
  test(`diagnosis ${name} returns a successful save with a durable failure flag and no invented health/tasks`, async t => {
    const logs = [];
    t.mock.method(console, "error", (...args) => logs.push(args));
    diagnosisError = error;
    const result = await scan(true);
    assert.equal(result.status, 201); assert.equal(result.body.success, true);
    assert.equal(result.body.diagnosisError, true);
    assert.equal(result.body.diagnosisCode, name === "quota" ? "SCAN_AI_BUSY" : "SCAN_AI_UNAVAILABLE");
    assert.match(result.body.diagnosisMessage, name === "quota" ? /AI service is busy/ : /Scan saved/);
    assert.equal(result.body.diagnostic.healthStatus, "unknown"); assert.equal(result.body.diagnostic.rawAnalysisText, null);
    assert.equal(result.body.notification, null); assert.deepEqual(result.body.careTasks, []);
    assert.equal(plantCreates, 1); assert.equal(analyses.length, 1); assert.equal(imageWrites, 1);
    assert.equal(healthWrites[0].imageUrl, "https://example.com/plant.jpg");
    assert.equal(healthWrites[0].healthStatus, undefined);
    const [, logged, stack] = logs.find(([label]) => label === "[Scan] Gemini diagnosis failed");
    assert.equal(logged.stage, "generate-content"); assert.equal(logged.status, error.status);
    assert.match(stack, /at /); assert.match(stack, new RegExp(error.message));
    const archives = await (await fetch(`${baseUrl}/api/scan/archives`)).json();
    assert.equal(archives[0].diagnosisError, true); assert.equal(archives[0].rawAnalysisText, null);
  });
}

test("diagnosis retry reuses the saved image and current session readings, preserving prior health on failure", async () => {
  linkedDevice = "00000000-0000-4000-8000-000000000002";
  existingHealthStatus = "warning";
  latestReading = { deviceId: sensorMac, timestamp: new Date(), temperature: 29, humidity: 60, soilMoistureRaw: 2500, lightLux: 100 };
  diagnosisError = Object.assign(new Error("busy"), { status: 429 });
  const failed = await scan();
  assert.equal(failed.status, 201); assert.equal(failed.body.diagnostic.healthStatus, "warning");
  assert.equal(healthWrites[0].healthStatus, undefined); assert.equal(taskWrites.length, 0);
  latestReading = { deviceId: sensorMac, timestamp: new Date(), temperature: 31, humidity: 72, soilMoistureRaw: 2625, lightLux: 0.83 };
  diagnosisError = null;
  const retried = await scan(false, { imageBase64: undefined, reusePreviousImage: true });
  assert.equal(retried.status, 201); assert.equal(retried.body.diagnosisError, false);
  assert.equal(plantCreates, 0); assert.equal(identifications, 1); assert.equal(subjectImages.length, 1);
  assert.equal(imageWrites, 1); assert.deepEqual(sentImages, ["/9j/2Q=="]);
  for (const value of [/Actual Sensor Readings/, /Temperature: 31/, /Humidity: 72/, /Raw ADC: 2625/, /Ambient Light: 0.83 lux/, /FRESH/]) assert.match(prompts[0], value);
  assert.equal(retried.body.telemetry.soilMoistureRaw, 2625);
  assert.ok(telemetryQueries.every(query => query.where.plantId === existingPlantId && query.where.pairingId === sessionId && query.where.contextVersion === 1));
  assert.equal(analyses.length, 2); assert.equal(taskWrites.length, 1);
});

test("an owned device on a new incomplete scan stays paired for later sensor-enhanced retries", async () => {
  const deviceId = "00000000-0000-4000-8000-000000000002";
  diagnosisError = new Error("offline");
  const result = await scan(true, { deviceId });
  assert.equal(result.status, 201); assert.equal(result.body.plant.deviceId, deviceId);
  assert.equal(result.body.diagnosisError, true);
});

test("failed diagnosis does not turn a failed database transaction into a successful plant-save response", async () => {
  diagnosisError = new Error("offline"); writeFailure = "analysis";
  const result = await scan(true);
  assert.equal(result.status, 500); assert.equal(result.body.success, false);
  assert.equal(plantCreates, 0); assert.equal(analyses.length, 0); assert.equal(discardedImages, 1);
});

test("Phase D: moving one sensor between plants and returning selects each new active session", async () => {
  linkedDevice = "00000000-0000-4000-8000-000000000002";
  const plant2Id = "00000000-0000-4000-8000-000000000004";
  latestReading = { id: readingId, deviceId: sensorMac, plantId: existingPlantId, pairingId: sessionId, contextVersion: 1,
    timestamp: new Date(), temperature: 21, humidity: 50 };
  const first = await scan();
  assert.equal(first.status, 201); assert.equal(first.body.telemetrySnapshot.pairingId, sessionId);
  extraReadings.push(latestReading);
  extraPlants.set(existingPlantId, { id: existingPlantId, userId: "owner", name: "Basil", species: speciesName, deviceId: null });
  extraPlants.set(plant2Id, { id: plant2Id, userId: "owner", name: "Plant2", species: speciesName, deviceId: linkedDevice });
  scanSession = { id: "00000000-0000-4000-8000-000000000005", plantId: plant2Id, deviceId: linkedDevice, unpairedAt: null };
  latestReading = { ...latestReading, id: "000000000000000000000002", plantId: plant2Id, pairingId: scanSession.id, temperature: 32 };
  const second = await scan(false, { plantId: plant2Id });
  assert.equal(second.status, 201); assert.equal(second.body.telemetrySnapshot.plantId, plant2Id);
  assert.equal(second.body.telemetrySnapshot.pairingId, scanSession.id);
  assert.match(prompts[1], /Temperature: 32°C/); assert.doesNotMatch(prompts[1], /Temperature: 21°C/);
  extraReadings.push(latestReading);
  extraPlants.set(existingPlantId, { ...extraPlants.get(existingPlantId), deviceId: linkedDevice });
  scanSession = { ...scanSession, id: "00000000-0000-4000-8000-000000000006", plantId: existingPlantId };
  latestReading = { ...latestReading, id: "000000000000000000000003", plantId: existingPlantId, pairingId: scanSession.id, temperature: 23 };
  const returned = await scan();
  assert.equal(returned.status, 201); assert.equal(returned.body.telemetrySnapshot.pairingId, scanSession.id);
  assert.equal(returned.body.telemetry.temperature, 23);
  assert.match(prompts[2], /Temperature: 23°C/); assert.doesNotMatch(prompts[2], /Temperature: 21°C|Temperature: 32°C/);
  assert.deepEqual(analyses.map(row => row.telemetrySnapshot.pairingId), [sessionId, second.body.telemetrySnapshot.pairingId, scanSession.id]);
});

test("Phase D: a legacy pointer without an active session stays image-only despite same-MAC readings", async () => {
  linkedDevice = "00000000-0000-4000-8000-000000000002";
  scanSession = null;
  latestReading = { deviceId: sensorMac, temperature: 39, humidity: 80, timestamp: new Date() };
  const result = await scan();
  assert.equal(result.status, 201); assert.equal(telemetryReads, 0);
  assert.deepEqual(result.body.telemetrySnapshot, {source: "none"});
  assert.deepEqual(analyses[0].telemetrySnapshot, {source: "none"});
  assert.equal(result.body.telemetry, null);
  assert.match(prompts[0], /No active pairing session/); assert.doesNotMatch(prompts[0], /Actual Sensor Readings|Temperature: 39/);
});

test("Phase D: an empty active session never falls back to closed, legacy, or unpaired readings", async () => {
  linkedDevice = "00000000-0000-4000-8000-000000000002";
  extraReadings = [
    {deviceId: sensorMac, plantId: existingPlantId, pairingId: "closed-session", contextVersion: 1, temperature: 35, humidity: 80, timestamp: new Date()},
    {deviceId: sensorMac, plantId: undefined, pairingId: undefined, contextVersion: undefined, temperature: 36, humidity: 80, timestamp: new Date()},
    {deviceId: sensorMac, plantId: null, pairingId: null, contextVersion: 1, temperature: 37, humidity: 80, timestamp: new Date()},
  ];
  const result = await scan();
  assert.equal(result.status, 201); assert.equal(telemetryReads, 1);
  assert.deepEqual(result.body.telemetrySnapshot, {source: "none"}); assert.equal(result.body.telemetry, null);
  assert.deepEqual(analyses[0].telemetrySnapshot, {source: "none"});
  assert.match(prompts[0], /active pairing session/); assert.doesNotMatch(prompts[0], /Actual Sensor Readings|Temperature: 3[567]/);
});

test("Phase D: a newer Plant2-tagged reading cannot enter Plant1's scan", async () => {
  linkedDevice = "00000000-0000-4000-8000-000000000002";
  latestReading = { deviceId: sensorMac, timestamp: new Date(Date.now()-1000), temperature: 21, humidity: 50 };
  extraReadings = [{ id: "000000000000000000000002", deviceId: sensorMac,
    plantId: "00000000-0000-4000-8000-000000000004", pairingId: sessionId, contextVersion: 1,
    timestamp: new Date(), temperature: 39, humidity: 80 }];
  let result = await scan();
  assert.equal(result.status, 201); assert.equal(result.body.telemetry.temperature, 21);
  assert.equal(result.body.telemetrySnapshot.plantId, existingPlantId);
  assert.match(prompts[0], /Temperature: 21°C/); assert.doesNotMatch(prompts[0], /Temperature: 39°C/);
  latestReading = null;
  result = await scan();
  assert.deepEqual(result.body.telemetrySnapshot, {source: "none"});
  assert.doesNotMatch(prompts[1], /Temperature: 39°C/);
});

test("Phase D: a move during Gemini diagnosis preserves the resolved reading and session", {timeout: 10000}, async () => {
  linkedDevice = "00000000-0000-4000-8000-000000000002";
  latestReading = { deviceId: sensorMac, timestamp: new Date(), temperature: 24, humidity: 60 };
  let arrive, release;
  const reached = new Promise(resolve => { arrive = resolve; });
  diagnosisGate = { arrive, ready: new Promise(resolve => { release = resolve; }) };
  const pending = scan();
  await reached;
  extraPlants.set(existingPlantId, { id: existingPlantId, userId: "owner", name: "Basil", species: speciesName, deviceId: null });
  scanSession = { id: "00000000-0000-4000-8000-000000000005", plantId: "00000000-0000-4000-8000-000000000004", deviceId: linkedDevice, unpairedAt: null };
  latestReading = { deviceId: sensorMac, plantId: scanSession.plantId, pairingId: scanSession.id,
    timestamp: new Date(), temperature: 38, humidity: 80 };
  release();
  const result = await pending;
  assert.equal(result.status, 201); assert.equal(result.body.plant.deviceId, null);
  assert.equal(result.body.telemetrySnapshot.plantId, existingPlantId);
  assert.equal(result.body.telemetrySnapshot.pairingId, sessionId);
  assert.equal(result.body.telemetrySnapshot.readingId, readingId);
  assert.equal(result.body.telemetrySnapshot.source, "current_session");
  assert.equal(result.body.telemetry.temperature, 24);
  assert.deepEqual(analyses[0].telemetrySnapshot, result.body.telemetrySnapshot);
  assert.equal(telemetryReads, 1);
  assert.match(prompts[0], /Temperature: 24°C/); assert.doesNotMatch(prompts[0], /Temperature: 38°C/);
});

test("Phase D: reuse recovers the fourth-latest real confidence after three synthetic zeros", async () => {
  previousIdentifications = [1,2,3].map(index => ({id: `synthetic-${index}`, confidence: 0, rawResponse: {source: "saved-plant"}}))
    .concat([{id: "real-identification", confidence: 0.989, rawResponse: {results: []}}]);
  const result = await scan(false, {reusePreviousImage: true});
  assert.equal(result.status, 201); assert.equal(result.body.identification.confidence, 0.989);
  assert.equal(result.body.identificationReused, true); assert.equal(identifications, 0);
  assert.equal(identificationWrites[0].confidence, 0.989);
  assert.equal(identificationWrites[0].rawResponse.previousIdentificationId, "real-identification");
  assert.match(prompts[0], /Identification Confidence: 98\.9%/);
  assert.deepEqual(identificationQueries[0].orderBy, [{createdAt: "desc"}, {id: "desc"}]);
});

for (const confidence of [0, 0.00001]) test(`Phase D: real Pl@ntNet confidence ${confidence} is preserved on reuse`, async () => {
  previousIdentifications = [{id: "real-low-confidence", confidence, rawResponse: {results: [{score: confidence}]}},
    {id: "older-high-confidence", confidence: 0.989, rawResponse: {results: []}}];
  const result = await scan(false, {reusePreviousImage: true});
  assert.equal(result.status, 201); assert.equal(result.body.identification.confidence, confidence);
  assert.equal(result.body.identificationReused, true); assert.equal(identificationWrites[0].confidence, confidence);
});

for (const synthetic of [false, true]) test(`Phase D: ${synthetic ? "all synthetic" : "missing"} prior identifications return explicit unavailable confidence`, async () => {
  previousIdentifications = synthetic ? [1,2,3].map(index => ({id: `synthetic-${index}`, confidence: 0, rawResponse: {source: "saved-plant"}})) : [];
  const result = await scan(false, {reusePreviousImage: true});
  assert.equal(result.status, 201); assert.equal(result.body.identification.confidence, 0);
  assert.equal(result.body.identificationReused, false);
  assert.match(result.body.identificationMessage, /Previous identification confidence is unavailable/);
  assert.equal(identifications, 0);
});

test("Phase D: a fresh identification's confidence carries into a later saved-image scan", async () => {
  previousIdentifications = [];
  const fresh = await scan();
  const reused = await scan(false, {reusePreviousImage: true});
  assert.equal(fresh.status, 201); assert.equal(reused.status, 201);
  assert.equal(reused.body.identification.confidence, fresh.body.identification.confidence);
  assert.equal(reused.body.identificationReused, true);
  assert.equal(identifications, 1); assert.equal(identificationWrites.length, 2);
});

test("Phase D: old unscoped archive snapshots load as legacy without inferred plant attribution", async () => {
  const snapshot = {deviceId: sensorMac, timestamp: new Date().toISOString(), temperature: 26, humidity: 60,
    soilMoisture: 2500, lightLux: 50};
  for (const telemetrySnapshot of [snapshot, {source: "none"}, null]) analyses.push({plantId: existingPlantId, userId: "owner",
    isArchived: true, healthStatus: "healthy", rawAnalysisText: "Saved diagnosis.", telemetrySnapshot});
  const response = await fetch(`${baseUrl}/api/scan/archives`);
  assert.equal(response.status, 200);
  const [legacy, none, empty] = await response.json();
  assert.equal(legacy.telemetrySnapshot.source, "legacy");
  assert.equal(legacy.telemetrySnapshot.plantId, undefined); assert.equal(legacy.telemetrySnapshot.pairingId, undefined);
  assert.equal(legacy.telemetrySnapshot.soilMoistureRaw, 2500);
  assert.deepEqual(none.telemetrySnapshot, {source: "none"}); assert.equal(empty.telemetrySnapshot, null);
  assert.equal(analyses[0].telemetrySnapshot.source, undefined);
});
