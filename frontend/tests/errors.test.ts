import assert from "node:assert/strict";
import test from "node:test";
import { createApiClient } from "../services/api";
import {
    ApiError,
    asApiError,
    CONNECTION_ERROR_MESSAGE,
    sanitizeErrorMessage,
} from "../services/errors";

test("connection diagnostics are replaced entirely with the standard message", () => {
  assert.equal(
    CONNECTION_ERROR_MESSAGE,
    "Unable to connect to the server. Please check your internet connection and try again.",
  );
  for (const message of [
    "Check EXPO_PUBLIC_API_URL and restart.",
    "Use the development computer's LAN IP.",
    "Cannot access localhost:3000",
    "Connect to 10.0.2.2",
    "connect ECONNREFUSED 127.0.0.1",
    "Network request failed",
    "Network Error",
    "Failed to fetch",
    "fetch failed",
    "Load failed",
    "NetworkError when attempting to fetch resource.",
    "Request timed out",
    "Unable to reach the server",
    "Connection refused",
  ])
    assert.equal(sanitizeErrorMessage(message), CONNECTION_ERROR_MESSAGE);
  assert.equal(
    sanitizeErrorMessage(CONNECTION_ERROR_MESSAGE),
    CONNECTION_ERROR_MESSAGE,
  );
});

test("API normalization preserves kinds, status and diagnostic details, not network text", () => {
  const original = new TypeError("fetch failed at an internal address");
  const normalized = asApiError(original);
  assert.equal(normalized.message, CONNECTION_ERROR_MESSAGE);
  assert.equal(normalized.kind, "network");
  assert.equal(normalized.details, original);
  assert.equal(
    new ApiError("timeout", "Timeout after 100ms").message,
    CONNECTION_ERROR_MESSAGE,
  );
  const payload = { error: "Set EXPO_PUBLIC_API_URL to the LAN IP" };
  const http = new ApiError("http", payload.error, 503, payload);
  assert.equal(http.message, CONNECTION_ERROR_MESSAGE);
  assert.equal(http.status, 503);
  assert.equal(http.details, payload);
  assert.equal(asApiError(http), http);
});

test("validation, credential, cancellation and informational messages remain useful", () => {
  for (const message of [
    "Invalid credentials",
    "Passwords do not match.",
    "Accept the terms and limitations to continue.",
    "Request cancelled",
    "Previous readings may be stale.",
  ]) {
    assert.equal(sanitizeErrorMessage(message), message);
    assert.equal(new ApiError("application", message).message, message);
  }
});

test("login, registration and collection requests sanitize rejected transports and API diagnostics", async () => {
  for (const fetch of [
    async () => {
      throw new TypeError("Failed to fetch http://localhost:3000");
    },
    async () =>
      new Response(
        JSON.stringify({ error: "Check EXPO_PUBLIC_API_URL and LAN IP" }),
        { status: 503 },
      ),
    async () =>
      new Response(
        JSON.stringify({
          success: false,
          error: "connect ECONNREFUSED 10.0.2.2",
        }),
      ),
  ]) {
    const api = createApiClient({ fetch });
    for (const request of [
      () => api.login({ email: "a@example.test", password: "password" }),
      () => api.register({ email: "a@example.test", password: "password" }),
      () => api.fetchUserPlants(),
    ])
      await assert.rejects(
        request(),
        (error: unknown) =>
          error instanceof ApiError &&
          error.message === CONNECTION_ERROR_MESSAGE,
      );
  }
});

test("request timeouts use the same connection message", async () => {
  const api = createApiClient({
    timeoutMs: 5,
    fetch: () => new Promise<Response>(() => {}),
  });
  await assert.rejects(
    api.login({ email: "a@example.test", password: "password" }),
    (error: unknown) =>
      error instanceof ApiError &&
      error.kind === "timeout" &&
      error.message === CONNECTION_ERROR_MESSAGE,
  );
});
