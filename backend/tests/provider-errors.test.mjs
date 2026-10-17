import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";

Object.assign(process.env, { SUPABASE_URL: "https://provider.example.test", SUPABASE_PUBLISHABLE_KEY: "public-test", SUPABASE_SECRET_KEY: "private-test" });
const { supabaseAdmin, supabasePublic } = await import("../src/lib/supabase-client.ts");
afterEach(() => mock.restoreAll());

test("admin provisioning maps allowlisted provider codes to safe field errors", async () => {
  const cases = [
    ["weak_password", 422, 400, "WEAK_PASSWORD", "password"],
    ["email_exists", 422, 409, "EMAIL_CONFLICT", "email"],
    ["user_already_exists", 422, 409, "EMAIL_CONFLICT", "email"],
    ["email_address_invalid", 400, 400, "INVALID_EMAIL", "email"],
  ];
  let current;
  mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ code: current[0], msg: "PRIVATE_PROVIDER_DIAGNOSTIC" }), { status: current[1] }));
  for (const item of cases) {
    current = item;
    await assert.rejects(supabaseAdmin.createUser("new@example.test", "password", null), error => {
      assert.equal(error.status, item[2]); assert.equal(error.code, item[3]);
      assert.equal(typeof error.fieldErrors[item[4]], "string");
      assert.ok(!JSON.stringify(error).includes("PRIVATE_PROVIDER_DIAGNOSTIC"));
      return true;
    });
  }
});

test("unknown, rate limited and server provider failures stay generic without leaking diagnostics", async () => {
  let status;
  mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ code: "weak_password", message: "PRIVATE_PROVIDER_DIAGNOSTIC" }), { status }));
  for (status of [429, 500, 503]) {
    await assert.rejects(supabaseAdmin.createUser("new@example.test", "password", null), error => {
      assert.equal(error.code, status === 429 ? "RATE_LIMITED" : "PROVIDER_REJECTED");
      assert.equal(error.fieldErrors, undefined);
      assert.ok(!error.message.includes("PRIVATE_"));
      return true;
    });
  }
  mock.restoreAll();
  mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ code: "unknown", message: "PRIVATE_PROVIDER_DIAGNOSTIC" }), { status: 422 }));
  await assert.rejects(supabaseAdmin.createUser("new@example.test", "password", null), error => error.code === "PROVIDER_REJECTED" && !error.message.includes("PRIVATE_"));
});

test("public password login retains generic credential errors rather than exposing provisioning details", async () => {
  mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ code: "weak_password", message: "PRIVATE_PROVIDER_DIAGNOSTIC" }), { status: 400 }));
  await assert.rejects(supabasePublic.passwordLogin("new@example.test", "password"), error => error.code === "PROVIDER_REJECTED" && error.fieldErrors === undefined);
});
