import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { ProviderConfigurationError, supabaseProviderConfig, validateProviderConfig } from "../src/lib/provider-config.ts";

const config = {
  AUTH_PROVIDER: "supabase",
  GEMINI_API_KEY: `AIza${"a".repeat(35)}`,
  SUPABASE_URL: "https://provider.example.test",
  SUPABASE_PUBLISHABLE_KEY: "private-publishable-key",
  SUPABASE_SECRET_KEY: "private-secret-key",
};
const required = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY"];

test("Supabase startup requires each configured value and treats whitespace as missing", () => {
  assert.doesNotThrow(() => validateProviderConfig(config));
  for (const name of required) for (const value of [undefined, "", " \t "]) {
    assert.throws(() => validateProviderConfig({ ...config, [name]: value }), error =>
      error instanceof ProviderConfigurationError && error.message.includes(name) &&
      !error.message.includes("private-"));
  }
  assert.doesNotThrow(() => validateProviderConfig({ AUTH_PROVIDER: "legacy", GEMINI_API_KEY: config.GEMINI_API_KEY }));
});

test("Supabase startup and runtime share strict URL validation without exposing secrets", () => {
  assert.deepEqual(supabaseProviderConfig({ ...config,
    SUPABASE_PUBLISHABLE_KEY: ` ${config.SUPABASE_PUBLISHABLE_KEY} `,
    SUPABASE_SECRET_KEY: ` ${config.SUPABASE_SECRET_KEY} `,
  }), { url: config.SUPABASE_URL, issuer: `${config.SUPABASE_URL}/auth/v1`,
    publishableKey: config.SUPABASE_PUBLISHABLE_KEY, secretKey: config.SUPABASE_SECRET_KEY });
  for (const url of ["private-invalid-url", "http://provider.example.test", "https://provider.example.test/auth/v1",
    "https://private-user:private-password@provider.example.test", "https://provider.example.test?private-query=1"]) {
    assert.throws(() => validateProviderConfig({ ...config, SUPABASE_URL: url }), error =>
      error instanceof ProviderConfigurationError && error.message === "SUPABASE_URL must be an HTTPS project origin.");
  }
});

test("missing or malformed Supabase configuration exits the real server before listening", () => {
  const cases = required.map(name => [name, ""]);
  cases.push(["SUPABASE_URL", "https://private-user:private-password@provider.example.test"]);
  for (const [name, value] of cases) {
    const result = spawnSync(process.execPath, ["--import", "tsx/esm", "src/server.ts"], {
      cwd: fileURLToPath(new URL("../", import.meta.url)), encoding: "utf8", timeout: 15000,
      env: { ...process.env, ...config, NODE_ENV: "production", PORT: "0",
        AUTH_JWT_SECRET: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLM",
        AUTH_JWT_ISSUER: "startup-test", AUTH_JWT_AUDIENCE: "startup-test",
        AUTH_ALLOWED_ORIGINS: "https://admin.example.test", [name]: value },
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, new RegExp(`\\[Startup\\] Provider configuration error: ${name}`));
    assert.doesNotMatch(result.stderr + result.stdout, /private-|Listening on|at file:/);
  }
});
