import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../services/errors";
import {
  scanErrorMessage,
  scanNeedsServiceRecovery,
} from "../services/scan-errors";

test("current no-plant codes and legacy provider JSON become helpful guidance", () => {
  for (const error of [
    new ApiError("http", "HTTP 422", 422, { code: "NO_PLANT_DETECTED" }),
    new ApiError(
      "http",
      'Pl@ntNet API error (404): {"statusCode":404,"error":"Not Found","message":"Species not found"}',
      500,
    ),
    new Error("We couldn't detect a plant in this photo."),
  ]) {
    const message = scanErrorMessage(error);
    assert.match(message, /closer to the leaves.*well-lit/);
    assert.doesNotMatch(message, /404|422|500|JSON|HTTP|Pl@ntNet|statusCode/);
  }
});

test("scan failures have actionable messages without diagnostic passthrough", () => {
  const cases: [unknown, RegExp][] = [
    [new ApiError("network", "fetch failed"), /internet connection/],
    [new ApiError("timeout", "timeout"), /longer than usual/],
    [new ApiError("cancelled", "AbortError"), /paused/],
    [new ApiError("http", "HTTP 401", 401), /sign in again/],
    [new ApiError("http", "HTTP 403", 403), /sign in again/],
    [new ApiError("http", "HTTP 429", 429), /little busy/],
    [new ApiError("http", "HTTP 413", 413), /too large/],
    [new ApiError("http", "HTTP 503", 503), /isn't available/],
    [new ApiError("http", "Plant not found", 404), /couldn't finish/],
    [new Error('SECRET_KEY is missing {"stack":"private"}'), /couldn't finish/],
    [null, /couldn't finish/],
  ];
  for (const [error, expected] of cases) {
    const message = scanErrorMessage(error);
    assert.match(message, expected);
    assert.doesNotMatch(
      message,
      /HTTP|SECRET_KEY|stack|AbortError|\{|\b[45]\d\d\b/,
    );
  }
});

test("provider configuration failures are not mistaken for user authentication or bad photos", () => {
  const error = new ApiError("http", "HTTP 401", 401, {
    code: "SCAN_AI_CONFIGURATION",
  });
  assert.match(scanErrorMessage(error), /fix on our side/);
  assert.equal(scanNeedsServiceRecovery(error), true);
  assert.equal(
    scanNeedsServiceRecovery(
      new ApiError("http", "no plant", 422, { code: "NO_PLANT_DETECTED" }),
    ),
    false,
  );
  assert.doesNotMatch(scanErrorMessage(error), /sign in|closer|401|API/);
  assert.match(
    scanErrorMessage(
      new ApiError("http", "busy", 503, { code: "SCAN_AI_BUSY" }),
    ),
    /lot of requests/,
  );
  assert.match(
    scanErrorMessage(
      new ApiError("http", "unavailable", 502, { code: "SCAN_AI_UNAVAILABLE" }),
    ),
    /health check/,
  );
});
