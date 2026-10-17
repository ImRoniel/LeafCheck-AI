import assert from "node:assert/strict";
import { test } from "node:test";

const config = {
  AUTH_JWT_SECRET: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLM",
  AUTH_JWT_ISSUER: "config-test",
  AUTH_JWT_AUDIENCE: "config-test",
  AUTH_ALLOWED_ORIGINS: "https://admin.example.test",
};
Object.assign(process.env, config);
const { loadAuthConfig } = await import("../src/lib/auth-config.ts");

test("origin configuration trims whitespace and ignores empty entries", () => {
  const result = loadAuthConfig({ ...config, NODE_ENV: "production",
    AUTH_ALLOWED_ORIGINS: " https://admin.example.test , , https://other.example.test, " });
  assert.deepEqual(result.origins, ["https://admin.example.test", "https://other.example.test"]);
});

test("development permits the explicitly allowlisted admin localhost origin", () => {
  assert.deepEqual(loadAuthConfig({ ...config, NODE_ENV: "development",
    AUTH_ALLOWED_ORIGINS: " http://localhost:5174, https://admin.example.test " }).origins,
  ["http://localhost:5174", "https://admin.example.test"]);
  assert.deepEqual(loadAuthConfig({ ...config, NODE_ENV: "development", AUTH_ALLOWED_ORIGINS: "" }).origins, []);
});

test("production, test, and unspecified modes reject HTTP localhost origins", () => {
  for (const NODE_ENV of ["production", "test", undefined]) {
    assert.throws(() => loadAuthConfig({ ...config, NODE_ENV,
      AUTH_ALLOWED_ORIGINS: "http://localhost:5174" }), /exact HTTPS origins/);
  }
});

test("development still rejects other HTTP origins and origins containing paths", () => {
  for (const origin of ["http://localhost:5173", "http://127.0.0.1:5174",
    "http://localhost.evil.test:5174", "http://localhost:5174/", "https://admin.example.test/path"]) {
    assert.throws(() => loadAuthConfig({ ...config, NODE_ENV: "development",
      AUTH_ALLOWED_ORIGINS: origin }), /exact HTTPS origins/);
  }
});
