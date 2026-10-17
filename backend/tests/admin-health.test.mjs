import assert from "node:assert/strict";
import { before, beforeEach, mock, test } from "node:test";

let postgres, mongo, readAdminHealth;
before(async () => {
  mock.module(new URL("../src/lib/prisma-pg.js", import.meta.url).href, { namedExports: { prismaPg: { $queryRaw: (...args) => postgres(...args) } } });
  mock.module(new URL("../src/lib/prisma.js", import.meta.url).href, { namedExports: { prisma: { $runCommandRaw: (...args) => mongo(...args) } } });
  ({ readAdminHealth } = await import("../src/lib/admin-health.ts"));
});
beforeEach(() => { postgres = async () => [{ ready: 1 }]; mongo = async () => ({ ok: 1 }); });

test("readiness uses PostgreSQL SELECT 1 and Mongo ping through separate Prisma clients", async () => {
  postgres = async strings => { assert.equal(strings.join(""), "SELECT 1 AS ready"); return [{ ready: 1 }]; };
  mongo = async command => { assert.deepEqual(command, { ping: 1 }); return { ok: 1 }; };
  assert.deepEqual(await readAdminHealth(), { postgres: "ok", mongo: "ok", api: "ok" });
});

test("failed or malformed probes report down and do not expose the thrown error", async () => {
  postgres = async () => { throw new Error("PRIVATE_CONNECTION_STRING"); };
  mongo = async () => ({ ok: 0 });
  assert.deepEqual(await readAdminHealth(), { postgres: "down", mongo: "down", api: "ok" });
});

test("stalled probes are bounded to 2.5 seconds", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  postgres = () => new Promise(() => {});
  mongo = () => new Promise(() => {});
  const pending = readAdminHealth();
  t.mock.timers.tick(2500);
  assert.deepEqual(await pending, { postgres: "down", mongo: "down", api: "ok" });
});
