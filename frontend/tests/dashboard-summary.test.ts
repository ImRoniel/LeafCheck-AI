import assert from "node:assert/strict";
import test from "node:test";
import {
  getDashboardAlert,
  getDashboardCollectionStatus,
} from "../services/dashboard-summary";
import type { Plant } from "../types/plant";

const plant: Plant = {
  id: "plant-1",
  name: "Fern",
  species: "Fern",
  healthStatus: "unknown",
  createdAt: "2026-09-27T00:00:00Z",
  updatedAt: "2026-09-27T00:00:00Z",
};
const collection = {
  plants: [] as Plant[],
  loaded: true,
  loading: false,
  error: null as string | null,
  guest: false,
};

test("dashboard retains initial loading and retry without fabricating AI content", () => {
  const loading = getDashboardCollectionStatus({
    ...collection,
    loaded: false,
  })!;
  assert.match(loading.message, /Loading Plant Overview/);
  assert.equal(loading.canRetry, false);
  const failed = getDashboardCollectionStatus({
    ...collection,
    loaded: false,
    error: "private diagnostic",
  })!;
  assert.match(failed.message, /could not be loaded/);
  assert.doesNotMatch(failed.message, /private diagnostic/);
  assert.equal(failed.canRetry, true);
});

test("loaded collections do not recreate the removed garden summary", () => {
  assert.equal(getDashboardCollectionStatus(collection), null);
  const populated = { ...collection, plants: [plant] };
  assert.equal(getDashboardCollectionStatus(populated), null);
});

test("overview status distinguishes refresh and failed refresh", () => {
  const cached = { ...collection, plants: [plant] };
  const updating = getDashboardCollectionStatus({ ...cached, loading: true })!;
  assert.match(updating.message, /Updating/);
  assert.equal(updating.canRetry, false);
  const failed = getDashboardCollectionStatus({ ...cached, error: "offline" })!;
  assert.match(failed.message, /last loaded collection/);
  assert.equal(failed.canRetry, true);
  assert.equal(
    getDashboardCollectionStatus({
      ...cached,
      loading: true,
      error: "offline",
    })!.canRetry,
    false,
  );
});

test("guest messaging stays local and does not promise guest AI scans", () => {
  const guest = { ...collection, guest: true, plants: [plant] };
  assert.equal(getDashboardCollectionStatus(guest), null);
  assert.match(
    getDashboardAlert(guest)!,
    /Sign in for AI camera scans and telemetry/,
  );
});

test("sensor alerts do not infer missing hardware from incomplete collections", () => {
  assert.equal(getDashboardAlert({ ...collection, loaded: false }), null);
  assert.equal(getDashboardAlert({ ...collection, loading: true }), null);
  assert.equal(getDashboardAlert({ ...collection, error: "offline" }), null);
});

test("missing sensor links keep hardware optional and pairing unavailable", () => {
  const alert = getDashboardAlert({
    ...collection,
    plants: [{ ...plant, deviceId: " " }],
  })!;
  assert.match(alert, /No sensor links are recorded/);
  assert.match(alert, /Local device mappings do not verify/);
  assert.match(alert, /without hardware/);
  assert.match(alert, /pairing is not available/);
  assert.doesNotMatch(alert, /No sensors detected/);
});

test("a saved sensor link is not presented as a live observation", () => {
  const alert = getDashboardAlert({
    ...collection,
    plants: [{ ...plant, deviceId: "sensor-1" }],
  })!;
  assert.match(alert, /a link does not confirm live readings/);
  assert.match(alert, /sample times and telemetry status/);
  assert.doesNotMatch(alert, /No sensor links/);
});

test("demo-only and mixed collections explicitly distinguish simulated telemetry", () => {
  const demo = { ...plant, simulated: true, deviceId: "demo-1" };
  const demoAlert = getDashboardAlert({ ...collection, plants: [demo] })!;
  assert.match(demoAlert, /simulated telemetry, not live/);
  assert.match(demoAlert, /No physical sensor links/);
  const mixed = getDashboardAlert({
    ...collection,
    plants: [demo, { ...plant, id: "real", deviceId: "sensor-1" }],
  })!;
  assert.match(mixed, /simulated telemetry/);
  assert.match(mixed, /a link does not confirm live readings/);
  assert.doesNotMatch(mixed, /No physical sensor links/);
});
