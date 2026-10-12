import assert from "node:assert/strict";
import { test } from "node:test";
import { logDiagnosisError } from "../src/lib/diagnosis-error.ts";

test("diagnosis logging retains full stack frames/status and redacts provider credentials", t => {
  const secret = process.env.GEMINI_API_KEY || "test-secret";
  const error = Object.assign(new Error(`Quota exceeded at https://provider.test?api-key=${secret}`), { status: 429 });
  error.stack = `Error: ${error.message}\n    at diagnose (scan.ts:42:7)\n    at handler (scan.ts:80:3)`;
  const log = t.mock.method(console, "error", () => {});
  logDiagnosisError(error, "generate-content");
  const [label, details, stack] = log.mock.calls[0].arguments;
  assert.equal(label, "[Scan] Gemini diagnosis failed"); assert.equal(details.status, 429);
  assert.match(stack, /at diagnose \(scan.ts:42:7\)/); assert.match(stack, /at handler \(scan.ts:80:3\)/);
  assert.ok(!stack.includes(secret)); assert.match(stack, /redacted/);
});
