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
const originalKey = process.env.GEMINI_API_KEY;

before(async () => {
  process.env.GEMINI_API_KEY = "mock-key";
  mock.module(new URL("../src/lib/prisma-pg.js", import.meta.url).href, {
    namedExports: {
      prismaPg: {
        plantIdentification: { create: async () => ({ id: "identification" }) },
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
          create: async ({ data }) => {
            analyses.push(data);
            return { id: `analysis-${analyses.length}` };
          },
        },
      },
    },
  });
  mock.module(new URL("../src/lib/prisma.js", import.meta.url).href, {
    namedExports: {
      prisma: { sensorReading: { findFirst: async () => null } },
    },
  });
  mock.module(new URL("../src/lib/plantnet.js", import.meta.url).href, {
    namedExports: {
      identifyPlant: async () => ({
        speciesName,
        commonName: "Basil",
        confidence: 0.99,
        rawResponse: {},
      }),
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
              prompts.push(contents[0]);
              return { response: { text: () => "healthy" } };
            },
          };
        }
      },
    },
  });
  const { scanRouter } = await import("../src/routes/scan.ts");
  const app = express();
  app.use(express.json());
  app.use("/api/scan", scanRouter);
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

async function scan() {
  const response = await fetch(`${baseUrl}/api/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageBase64: "mock-image", plantId: "plant-1" }),
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
    assert.equal(result.body.error, error.message);
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
  assert.equal(result.body.error, error.message);
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
  assert.equal(result.body.error, "Recovery database unavailable");
  assert.equal(analyses.length, 0);
});

test("missing Perenual specifications retain general-advice behavior", async () => {
  perenualData = null;
  assert.equal((await scan()).status, 201);
  assert.equal(inserts.length, 0);
  assert.equal(analyses[0].idealSpecs, undefined);
  assert.ok(prompts[0].includes("No ideal species specs available"));
});
