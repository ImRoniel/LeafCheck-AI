import { argon2Verify } from "hash-wasm";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
    PasswordPool,
    hashPassword,
    verifyPassword,
} from "../src/lib/password.ts";

const legacy =
  "$argon2id$v=19$m=65536,p=1,t=3$MDEyMzQ1Njc4OWFiY2RlZg$Rodqfi3TRnDrJEDFHDYIqSfIpHjPepGqQdijfA2O+0U";
test("native argon2 0.45.1 fixtures remain compatible, including parameter order and Unicode", async () => {
  assert.equal(await verifyPassword("  existing password 🔒  ", legacy), true);
  assert.equal(
    await verifyPassword(
      "  existing password 🔒  ",
      legacy.replace("m=65536,p=1,t=3", "m=65536,t=3,p=1"),
    ),
    true,
  );
  assert.equal(await verifyPassword("existing password 🔒", legacy), false);
  assert.equal(
    await verifyPassword(
      "café 密碼",
      "$argon2id$v=19$m=65536,p=1,t=3$MDEyMzQ1Njc4OWFiY2RlZg$sjyFMPgqz96bRofsWu5Ho47/3gX0ZSycyobEYyxkYUY",
    ),
    true,
  );
});

test("new hashes have random salts, unchanged work factors, and interoperable encoding", async () => {
  const password = "  New password 密碼 🔒  ";
  const [first, second] = await Promise.all([
    hashPassword(password),
    hashPassword(password),
  ]);
  assert.notEqual(first, second);
  assert.match(first, /^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
  assert.equal(await argon2Verify({ password, hash: first }), true);
  assert.equal(await verifyPassword(password, second), true);
  assert.equal(await verifyPassword(password.trim(), second), false);
});

test("missing, malformed, unsupported and excessive-cost hashes fail closed", async () => {
  for (const hash of [
    undefined,
    "plaintext",
    "$argon2id$broken",
    legacy.replace("v=19", "v=16"),
    legacy.replace("m=65536", "m=999999999"),
    legacy.replace("p=1", "m=1"),
    legacy.replace("argon2id", "argon2i"),
  ]) {
    assert.equal(await verifyPassword("  existing password 🔒  ", hash), false);
  }
});

test("pool bounds concurrency/queue, remains responsive, and recovers after overload", async () => {
  const pool = new PasswordPool(1, 1);
  try {
    const first = pool.run({ operation: "hash", password: "first" });
    const second = pool.run({ operation: "hash", password: "second" });
    await assert.rejects(
      pool.run({ operation: "hash", password: "overflow" }),
      { status: 503, code: "AUTH_BUSY" },
    );
    let settled = false;
    first.then(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(settled, false, "main thread runs timers while worker hashes");
    await Promise.all([first, second]);
    assert.equal(
      typeof (await pool.run({ operation: "hash", password: "recovered" })),
      "string",
    );
  } finally {
    await pool.close();
  }
  await assert.rejects(pool.run({ operation: "hash", password: "closed" }), {
    status: 503,
  });
});

test("worker failures and timeouts reject active/queued work without hanging", async () => {
  for (const pool of [
    new PasswordPool(1, 1, 1),
    new PasswordPool(
      1,
      1,
      30000,
      new URL("./nonexistent-worker.mjs", import.meta.url),
    ),
  ]) {
    try {
      await Promise.all([
        assert.rejects(pool.run({ operation: "hash", password: "active" }), {
          status: 503,
        }),
        assert.rejects(pool.run({ operation: "hash", password: "queued" }), {
          status: 503,
        }),
      ]);
    } finally {
      await pool.close();
    }
  }
});
