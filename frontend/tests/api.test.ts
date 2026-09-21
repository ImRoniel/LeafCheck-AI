import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, createApiClient, resolveApiBaseUrl } from "../services/api";
const timestamp = "2026-09-19T10:00:00.000Z";
const plant = {
  id: "p",
  name: "Fern",
  species: "Fern",
  healthStatus: "healthy",
  createdAt: timestamp,
  updatedAt: timestamp,
};
const telemetry = {
  deviceId: "d",
  timestamp,
  soilMoisture: { percentage: 50, rawAnalogValue: 100, status: "optimal" },
  lightLevel: { lux: 500, status: "optimal" },
  environment: { temperatureCelsius: 25, humidityPercentage: 50 },
};
const report = {
  success: true,
  identification: { speciesName: "Fern", commonName: null, confidence: 0.8 },
  diagnostic: {
    id: "a",
    healthStatus: "healthy",
    rawAnalysisText: "Report",
    telemetryFreshness: "Fresh",
  },
  telemetry: null,
};
const client = (body: unknown, status = 200) =>
  createApiClient({
    fetch: async () => new Response(JSON.stringify(body), { status }),
  });
const kind = (expected: string) => (error: unknown) =>
  error instanceof ApiError && error.kind === expected;
test("plant creation and deletion use normalized payloads, parsed responses and empty 204", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const api = createApiClient({
    baseUrl: "http://test",
    fetch: async (url, init) => {
      calls.push({ url: String(url), init });
      return init?.method === "DELETE"
        ? new Response(null, { status: 204 })
        : new Response(JSON.stringify(plant), { status: 201 });
    },
  });
  assert.deepEqual(
    await api.createPlant({
      name: " Fern ",
      species: " Fern ",
      location: " ",
      imageUrl: " https://example.test/fern.jpg ",
    }),
    plant,
  );
  assert.equal(calls[0].url, "http://test/api/plants");
  assert.equal(calls[0].init?.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
    name: "Fern",
    species: "Fern",
    imageUrl: "https://example.test/fern.jpg",
  });
  assert.equal(await api.deletePlant("a/b ?"), undefined);
  assert.equal(calls[1].url, "http://test/api/plants/a%2Fb%20%3F");
  assert.equal(calls[1].init?.method, "DELETE");
  assert.equal(calls[1].init?.body, undefined);
});
test("plant mutations validate inputs and preserve API errors", async () => {
  let calls = 0;
  const api = createApiClient({
    fetch: async () => {
      calls++;
      return new Response("{}");
    },
  });
  for (const input of [
    { name: " ", species: "Fern" },
    { name: "Fern", species: "" },
    { name: "x".repeat(101), species: "Fern" },
    { name: "Fern", species: "x".repeat(201) },
    { name: "Fern", species: "Fern", location: "x".repeat(101) },
    { name: "Fern", species: "Fern", imageUrl: "javascript:alert(1)" },
    { name: "Fern", species: "Fern", imageUrl: "not a URL" },
  ]) {
    assert.throws(() => api.createPlant(input), kind("validation"));
  }
  assert.throws(() => api.deletePlant(" "), kind("validation"));
  assert.equal(calls, 0);
  await assert.rejects(
    client({}, 400).createPlant({ name: "Fern", species: "Fern" }),
    kind("http"),
  );
  await assert.rejects(
    client({ ...plant, healthStatus: "invalid" }).createPlant({
      name: "Fern",
      species: "Fern",
    }),
    kind("validation"),
  );
  await assert.rejects(
    client({}, 404).deletePlant("p"),
    (e: unknown) => e instanceof ApiError && e.status === 404,
  );
  await assert.rejects(client({}, 500).deletePlant("p"), kind("http"));
});
test("URL environment precedence and platform defaults", () => {
  assert.equal(resolveApiBaseUrl(undefined, "android"), "http://10.0.2.2:3000");
  assert.equal(resolveApiBaseUrl(undefined, "ios"), "http://localhost:3000");
  assert.equal(
    resolveApiBaseUrl(" https://example.test/// ", "android"),
    "https://example.test",
  );
});
test("all seven operations use correct routes and bodies", async () => {
  const responses = [
    [plant],
    plant,
    { id: "p", healthStatus: "healthy" },
    telemetry,
    {
      data: [],
      pagination: { total: 0, limit: 10, offset: 0, hasMore: false },
    },
    report,
    {
      success: true,
      healthStatus: "healthy",
      diagnoses: [],
      recommendations: [],
      timestamp,
    },
  ];
  const calls: { url: string; init?: RequestInit }[] = [];
  const api = createApiClient({
    baseUrl: "http://test",
    fetch: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify(responses.shift()));
    },
  });
  await api.fetchUserPlants();
  await api.fetchPlant("a/b ?");
  await api.updatePlantHealth("p", "healthy");
  await api.fetchLatestTelemetry("a/b");
  await api.fetchTelemetryHistory("d", { limit: 10 });
  await api.scanPlant({ plantId: "p", imageBase64: "abc" });
  await api.analyzePlant({ notes: "check" });
  assert.equal(calls[1].url, "http://test/api/plants/a%2Fb%20%3F");
  assert.equal(calls[2].init?.method, "PATCH");
  assert.equal(
    calls[2].init?.body,
    JSON.stringify({ healthStatus: "healthy" }),
  );
  assert.match(calls[3].url, /a%2Fb\/latest$/);
  assert.match(calls[4].url, /limit=10&offset=0$/);
  assert.match(calls[5].url, /\/api\/scan$/);
  assert.match(calls[6].url, /\/api\/ai\/analyze$/);
});
test("only latest 404 becomes null", async () => {
  assert.equal(await client({}, 404).fetchLatestTelemetry("d"), null);
  await assert.rejects(client({}, 500).fetchLatestTelemetry("d"), kind("http"));
  await assert.rejects(client({}, 404).fetchPlant("p"), kind("http"));
  await assert.rejects(
    client(null).fetchLatestTelemetry("d"),
    kind("validation"),
  );
});
test("nested validation rejects invalid data instead of manufacturing defaults", async () => {
  for (const body of [
    { ...telemetry, environment: null },
    {
      ...telemetry,
      soilMoisture: { ...telemetry.soilMoisture, percentage: 101 },
    },
    { ...telemetry, lightLevel: { lux: 10, status: "fake" } },
    { ...telemetry, timestamp: "yesterday" },
  ])
    await assert.rejects(
      client(body).fetchLatestTelemetry("d"),
      kind("validation"),
    );
  await assert.rejects(
    client([{ ...plant, healthStatus: "excellent" }]).fetchUserPlants(),
    kind("validation"),
  );
  await assert.rejects(
    client({
      ...report,
      identification: { speciesName: "Fern", commonName: null, confidence: 2 },
    }).scanPlant({ plantId: "p", imageBase64: "abc" }),
    kind("validation"),
  );
  await assert.rejects(
    client({ success: false, error: "Provider unavailable" }).analyzePlant({}),
    kind("application"),
  );
  await assert.rejects(
    client({
      data: [],
      pagination: { total: 2, limit: 1, offset: 0, hasMore: false },
    }).fetchTelemetryHistory("d"),
    kind("validation"),
  );
});
test("network, invalid JSON, timeout and external cancellation are typed", async () => {
  await assert.rejects(
    createApiClient({
      fetch: async () => {
        throw new TypeError("offline");
      },
    }).fetchUserPlants(),
    kind("network"),
  );
  await assert.rejects(
    createApiClient({
      fetch: async () => new Response("not json"),
    }).fetchUserPlants(),
    kind("validation"),
  );
  const hanging = createApiClient({
    timeoutMs: 10,
    fetch: () => new Promise(() => {}),
  });
  await assert.rejects(hanging.fetchUserPlants(), kind("timeout"));
  const abort = new AbortController();
  const pending = hanging.fetchUserPlants({
    signal: abort.signal,
    timeoutMs: 1000,
  });
  abort.abort();
  await assert.rejects(pending, kind("cancelled"));
  let calls = 0;
  const pre = new AbortController();
  pre.abort();
  await assert.rejects(
    createApiClient({
      fetch: async () => {
        calls++;
        return new Response("[]");
      },
    }).fetchUserPlants({ signal: pre.signal }),
    kind("cancelled"),
  );
  assert.equal(calls, 0);
});
