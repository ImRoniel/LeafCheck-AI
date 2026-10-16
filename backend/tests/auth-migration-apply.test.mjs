import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyMigration, migrationAdmin, normalizeArgon2Hash, parseApplyArgs, preservationManifest } from "../scripts/auth-migration-apply.mjs";
import { target } from "../scripts/auth-migration-dry-run.mjs";

const encodedSalt = Buffer.from("migration-salt16").toString("base64").replace(/=+$/, "");
const encodedHash = Buffer.alloc(32, 71).toString("base64").replace(/=+$/, "");
const hash = `$argon2id$v=19$m=65536,p=1,t=3$${encodedSalt}$${encodedHash}`;
const normalized = hash.replace("m=65536,p=1,t=3", "m=65536,t=3,p=1");
const date = new Date("2026-01-01T00:00:00Z");
const existingUid = "74a9347c-b30e-4827-bfa8-9c7182061e68";

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "leafcheck-auth-apply-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let state = {
    user: { id: target.id, email: target.email, name: "Demo Owner", password: hash, role: "ADMIN", isActive: true,
      createdAt: date, updatedAt: date, supabaseUserId: null, emailVerifiedAt: null },
    plants: Array.from({ length: 2 }, (_, i) => ({ id: `plant-${i}`, userId: target.id, deviceId: `device-${i}`, name: `Fern ${i}`, updatedAt: date })),
    devices: Array.from({ length: 2 }, (_, i) => ({ id: `device-${i}`, userId: target.id, macAddress: `device-address-${i}`, updatedAt: date })),
    scans: Array.from({ length: 5 }, (_, i) => ({ id: `scan-${i}`, userId: target.id, plantId: `plant-${i % 2}`, diagnoses: [{ label: "healthy" }], createdAt: date })),
    totals: { users: 5, sessions: 44, refreshTokens: 128 },
  };
  const original = structuredClone(state);
  const accounts = [];
  const events = [], creates = [], updates = [], transactions = [];
  let fullReads = 0, providerReads = 0, forbiddenWrites = 0;
  const forbidden = () => { forbiddenWrites++; throw new Error("Forbidden write"); };
  const client = (get, transactional = false) => ({
    user: {
      async findUnique({ where, select }) {
        assert.deepEqual(where, { id: target.id });
        if (select.supabaseUserId && options.schemaMissing) throw { code: "P2022" };
        if (!select.supabaseUserId) {
          fullReads++;
          if (fullReads === options.changeAtRead) get().user.name = "Concurrent change";
        }
        return Object.fromEntries(Object.keys(select).map(key => [key, get().user[key]]));
      },
      async count() { return get().totals.users; },
      async updateMany(query) {
        if (!transactional) return forbidden();
        updates.push(structuredClone(query));
        if (options.failLink) throw new Error(`private database diagnostic ${hash}`);
        const current = get().user;
        const matches = Object.entries(query.where).every(([key, value]) =>
          current[key] instanceof Date ? current[key].getTime() === value.getTime() : current[key] === value);
        if (!matches || options.linkCountZero) return { count: 0 };
        Object.assign(current, query.data, { updatedAt: new Date(date.getTime() + 1000) });
        if (options.discardMapping) current.supabaseUserId = null;
        if (options.changeDuringLink) get().plants[0].name = "Unexpected mutation";
        return { count: 1 };
      },
      create: forbidden, update: forbidden, delete: forbidden, deleteMany: forbidden,
    },
    plant: { async findMany() { return structuredClone(get().plants); }, create: forbidden, update: forbidden, updateMany: forbidden, delete: forbidden },
    device: { async findMany() { return structuredClone(get().devices); }, create: forbidden, update: forbidden, updateMany: forbidden, delete: forbidden },
    aIAnalysis: { async findMany() { return structuredClone(get().scans); }, create: forbidden, update: forbidden, updateMany: forbidden, delete: forbidden },
    authSession: { async count() { return get().totals.sessions; }, update: forbidden, deleteMany: forbidden },
    refreshToken: { async count() { return get().totals.refreshTokens; }, update: forbidden, deleteMany: forbidden },
  });
  const db = { ...client(() => state), async $transaction(work, settings) {
    transactions.push(settings);
    const draft = structuredClone(state);
    const result = await work(client(() => draft, true));
    state = draft;
    return result;
  } };
  const provider = {
    async usersByEmail(email) {
      providerReads++; assert.equal(email, target.email);
      if (options.providerUnavailable) throw new Error("private provider connection string");
      if (options.lateIdentity && providerReads === 2) accounts.push({ id: existingUid, email: target.email, emailConfirmedAt: date });
      return structuredClone(accounts);
    },
    async user(id) { return options.identityMissing ? null : structuredClone(accounts.find(account => account.id === id)); },
  };
  const admin = { project: "https://migration-project.supabase.co", async createUser(body) {
    creates.push(structuredClone(body));
    if (options.createFails) throw new Error(`private provider error ${hash}`);
    accounts.push({ id: body.id, email: body.email, emailConfirmedAt: date });
    if (options.changeAfterCreate) state.user.password = hash.replace("t=3", "t=4");
    return { id: body.id, email: body.email, email_confirmed_at: date.toISOString() };
  } };
  const checkpointPath = join(directory, "checkpoint.json");
  const run = overrides => applyMigration({ db, providerReads: provider, admin, confirm: target.id, checkpointPath,
    log: (event, value) => events.push({ event, value: structuredClone(value) }), ...overrides });
  return { db, provider, admin, state: () => state, original, accounts, creates, updates, transactions, events,
    checkpointPath, run, fullReads: () => fullReads, forbiddenWrites: () => forbiddenWrites };
}

test("confirmation is mandatory, exact, duplicate-safe and checked before database reads", async t => {
  for (const args of [[], ["--confirm=wrong"], [`--confirm=${target.id}`, `--confirm=${target.id}`], [`--confirm=${target.id}`, "--force"], ["--confirm"]])
    assert.throws(() => parseApplyArgs(args), /Confirmation required|Use --confirm/);
  assert.equal(parseApplyArgs([`--confirm=${target.id}`]).confirm, target.id);
  assert.equal(parseApplyArgs([`--confirm=${target.id}`, "--checkpoint=/tmp/review.json"]).checkpointPath, "/tmp/review.json");
  const f = await fixture(t);
  await assert.rejects(f.run({ confirm: null }), /Confirmation required/);
  assert.equal(f.fullReads(), 0); assert.equal(f.creates.length, 0);
});

test("Argon2 normalization reorders parameters without changing salt, digest or cost", () => {
  assert.equal(normalizeArgon2Hash(hash), normalized);
  assert.equal(normalizeArgon2Hash(normalized), normalized);
  assert.equal(normalizeArgon2Hash(hash.replace("m=65536,p=1,t=3", "p=1,t=3,m=65536")), normalized);
  for (const invalid of [null, hash.replace("argon2id", "argon2i"), hash.replace("v=19", "v=16"),
    hash.replace("p=1", "p=0"), hash.replace("t=3", "t=3,t=4"), hash.replace("t=3", "t=4294967296"),
    hash.replace("m=65536", "m=1"), hash.replace(encodedSalt, "bad"), hash.replace("p=1", "extra=1")])
    assert.throws(() => normalizeArgon2Hash(invalid), /UNSUPPORTED_PASSWORD/);
});

test("apply imports the normalized hash and links the same User while preserving every domain row", async t => {
  const f = await fixture(t);
  const result = await f.run();
  assert.equal(result.status, "migrated");
  assert.equal(f.creates.length, 1);
  assert.equal(f.creates[0].password_hash, normalized);
  assert.equal(f.creates[0].email_confirm, true);
  assert.equal(f.creates[0].email, target.email);
  assert.equal(f.creates[0].role, undefined);
  assert.equal(f.creates[0].password, undefined);
  assert.equal(f.creates[0].app_metadata.leafcheck_migration_user_id, target.id);
  assert.equal(f.state().user.id, target.id);
  assert.equal(f.state().user.supabaseUserId, result.supabaseUserId);
  assert.ok(f.state().user.emailVerifiedAt instanceof Date);
  for (const field of ["password", "role", "name", "email", "isActive", "createdAt"])
    assert.deepEqual(f.state().user[field], f.original.user[field]);
  for (const model of ["plants", "devices", "scans", "totals"]) assert.deepEqual(f.state()[model], f.original[model]);
  assert.deepEqual(Object.keys(f.updates[0].data).sort(), ["emailVerifiedAt", "supabaseUserId"]);
  assert.equal(f.updates[0].where.id, target.id);
  assert.equal(f.updates[0].where.password, hash);
  assert.equal(f.forbiddenWrites(), 0);
  assert.deepEqual(f.transactions, [{ isolationLevel: "Serializable", maxWait: 5000, timeout: 15000 }]);
  const before = f.events.find(event => event.event === "PRESERVATION_BEFORE").value;
  const { unchanged, ...after } = f.events.find(event => event.event === "PRESERVATION_AFTER").value;
  assert.deepEqual(before, after); assert.equal(unchanged, true);
  assert.deepEqual([before.plants.count, before.devices.count, before.scans.count], [2, 2, 5]);
  assert.deepEqual(before.plants.ids, ["plant-0", "plant-1"]);
  const checkpoint = JSON.parse(await readFile(f.checkpointPath, "utf8"));
  assert.equal(checkpoint.phase, "linked"); assert.equal(checkpoint.supabaseUserId, result.supabaseUserId);
  assert.equal((await stat(f.checkpointPath)).mode & 0o777, 0o600);
  const output = JSON.stringify({ events: f.events, checkpoint });
  for (const secret of [hash, normalized, encodedSalt, encodedHash]) assert.ok(!output.includes(secret));
});

test("a completed migration is an idempotent no-op with the same arguments and checkpoint", async t => {
  const f = await fixture(t);
  await f.run();
  const previous = structuredClone(f.state());
  const checkpoint = await readFile(f.checkpointPath, "utf8");
  const result = await f.run();
  assert.equal(result.status, "already_migrated");
  assert.equal(result.databaseWrites, 0); assert.equal(result.providerWrites, 0);
  assert.equal(f.creates.length, 1); assert.equal(f.updates.length, 1); assert.equal(f.transactions.length, 1);
  assert.deepEqual(f.state(), previous);
  assert.equal(await readFile(f.checkpointPath, "utf8"), checkpoint);
});

test("the intended provider UUID and preservation manifest are durable before the admin POST", async t => {
  const f = await fixture(t);
  const create = f.admin.createUser;
  f.admin.createUser = async body => {
    const checkpoint = JSON.parse(await readFile(f.checkpointPath, "utf8"));
    assert.equal(checkpoint.phase, "prepared");
    assert.equal(checkpoint.supabaseUserId, body.id);
    assert.deepEqual([checkpoint.before.plants.count, checkpoint.before.devices.count, checkpoint.before.scans.count], [2, 2, 5]);
    return create(body);
  };
  await f.run();
});

test("failure to save the provider-created checkpoint keeps the user and prints recovery without linking", async t => {
  const f = await fixture(t);
  const create = f.admin.createUser;
  f.admin.createUser = async body => {
    const result = await create(body);
    await rm(f.checkpointPath); await mkdir(f.checkpointPath);
    return result;
  };
  await assert.rejects(f.run());
  assert.equal(f.accounts.length, 1); assert.equal(f.updates.length, 0);
  const recovery = f.events.find(event => event.event === "RECOVERY_REQUIRED").value;
  assert.equal(recovery.checkpoint.supabaseUserId, f.accounts[0].id);
  assert.equal(recovery.checkpoint.linkCommitted, false);
  assert.equal(f.events.find(event => event.event === "PRESERVATION_AFTER").value.unchanged, true);
});

for (const blocker of ["email", "relations", "schema", "provider", "existing", "concurrent", "inactive", "hash"]) {
  test(`apply aborts before writes for ${blocker} preflight/eligibility failure`, async t => {
    const f = await fixture(t, { schemaMissing: blocker === "schema", providerUnavailable: blocker === "provider", changeAtRead: blocker === "concurrent" ? 3 : undefined });
    if (blocker === "email") f.state().user.email = "wrong@example.test";
    if (blocker === "relations") f.state().scans.pop();
    if (blocker === "existing") f.accounts.push({ id: existingUid, email: target.email, emailConfirmedAt: date });
    if (blocker === "inactive") f.state().user.isActive = false;
    if (blocker === "hash") f.state().user.password = "unsupported";
    await assert.rejects(f.run());
    assert.equal(f.creates.length, 0); assert.equal(f.updates.length, 0); assert.equal(f.forbiddenWrites(), 0);
    await assert.rejects(readFile(f.checkpointPath), { code: "ENOENT" });
  });
}

test("an existing checkpoint cannot be overwritten or trigger a second import", async t => {
  const f = await fixture(t);
  await writeFile(f.checkpointPath, "previous checkpoint", { mode: 0o600 });
  await assert.rejects(f.run(), /CHECKPOINT_UNAVAILABLE_OR_EXISTS/);
  assert.equal(f.creates.length, 0);
  assert.equal(await readFile(f.checkpointPath, "utf8"), "previous checkpoint");
});

for (const failure of ["failLink", "linkCountZero", "discardMapping", "changeDuringLink", "changeAfterCreate", "identityMissing"]) {
  test(`${failure} retains the created Supabase user, rolls back linking and prints recovery instructions`, async t => {
    const f = await fixture(t, { [failure]: true });
    await assert.rejects(f.run());
    assert.equal(f.accounts.length, 1); assert.equal(f.creates.length, 1);
    assert.equal(f.state().user.supabaseUserId, null);
    assert.equal(f.state().user.emailVerifiedAt, null);
    assert.deepEqual(f.state().plants, f.original.plants);
    assert.equal(f.forbiddenWrites(), 0);
    const checkpoint = JSON.parse(await readFile(f.checkpointPath, "utf8"));
    assert.equal(checkpoint.phase, "provider-created");
    assert.equal(checkpoint.supabaseUserId, f.accounts[0].id);
    const recovery = f.events.find(event => event.event === "RECOVERY_REQUIRED").value;
    assert.ok(recovery.steps.join("\n").includes("DO NOT delete"));
    assert.ok(recovery.steps.join("\n").includes(checkpoint.supabaseUserId));
    assert.ok(recovery.steps.join("\n").includes("tx.user.updateMany"));
    assert.ok(!JSON.stringify(f.events).includes(encodedHash));
    await assert.rejects(f.run(), /PREFLIGHT_BLOCKED/);
    assert.equal(f.creates.length, 1);
  });
}

test("uncertain provider creation keeps the prepared checkpoint and never retries POST automatically", async t => {
  const f = await fixture(t, { createFails: true });
  await assert.rejects(f.run());
  const checkpoint = JSON.parse(await readFile(f.checkpointPath, "utf8"));
  assert.equal(checkpoint.phase, "prepared");
  assert.equal(checkpoint.supabaseUserId, f.creates[0].id);
  assert.equal(f.updates.length, 0);
  assert.ok(f.events.some(event => event.event === "RECOVERY_REQUIRED"));
  await assert.rejects(f.run(), /CHECKPOINT_UNAVAILABLE_OR_EXISTS/);
  assert.equal(f.creates.length, 1);
});

test("a provider identity appearing after preflight aborts without importing or linking", async t => {
  const f = await fixture(t, { lateIdentity: true });
  await assert.rejects(f.run(), /EXISTING_SUPABASE_IDENTITY/);
  assert.equal(f.creates.length, 0); assert.equal(f.updates.length, 0);
});

test("inconsistent existing mappings and duplicate provider matches never count as completed", async t => {
  for (const duplicate of [false, true]) {
    const f = await fixture(t);
    f.state().user.supabaseUserId = existingUid;
    f.state().user.emailVerifiedAt = duplicate ? date : null;
    f.accounts.push({ id: existingUid, email: target.email, emailConfirmedAt: date });
    if (duplicate) f.accounts.push({ id: "d285808c-d870-43a0-a3cf-af248e78fc05", email: target.email, emailConfirmedAt: date });
    await assert.rejects(f.run(), /EXISTING_MAPPING_REQUIRES_REVIEW/);
    assert.equal(f.creates.length, 0); assert.equal(f.updates.length, 0);
  }
});

test("admin import uses a server-only API key and works while AUTH_PROVIDER remains legacy", async t => {
  const previous = process.env.AUTH_PROVIDER;
  process.env.AUTH_PROVIDER = "legacy";
  t.after(() => { if (previous === undefined) delete process.env.AUTH_PROVIDER; else process.env.AUTH_PROVIDER = previous; });
  const calls = [];
  const admin = migrationAdmin({ url: "https://migration-project.supabase.co", key: "sb_secret_test-only",
    fetch: async (url, options) => { calls.push({ url, options }); return new Response(JSON.stringify({ id: existingUid })); } });
  await admin.createUser({ email: target.email, password_hash: normalized, email_confirm: true });
  assert.equal(calls[0].url, "https://migration-project.supabase.co/auth/v1/admin/users");
  assert.equal(calls[0].options.headers.apikey, "sb_secret_test-only");
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(process.env.AUTH_PROVIDER, "legacy");
  assert.equal(JSON.parse(calls[0].options.body).password_hash, normalized);
  assert.throws(() => migrationAdmin({ url: "http://unsafe.test", key: "sb_secret_test-only" }), /HTTPS/);
  assert.throws(() => migrationAdmin({ url: "https://safe.test", key: "sb_publishable_not-admin" }), /server secret/);
});

test("admin errors never expose provider response bodies, hashes or network credentials", async () => {
  for (const fetch of [async () => new Response(JSON.stringify({ message: normalized }), { status: 422 }),
    async () => { throw new Error(`https://private:secret@test.invalid ${normalized}`); },
    async () => new Response("not-json")]) {
    const admin = migrationAdmin({ url: "https://migration-project.supabase.co", key: "sb_secret_test-only", fetch });
    await assert.rejects(admin.createUser({ password_hash: normalized }), error =>
      /^SUPABASE_CREATE_/.test(error.message) && !error.message.includes(encodedHash) && !error.message.includes("secret@test"));
  }
});

test("preservation fingerprints detect content changes even when relation counts stay the same", async t => {
  const f = await fixture(t);
  const before = preservationManifest(f.original);
  f.state().plants[0].name = "Different plant";
  const after = preservationManifest(f.state());
  assert.equal(before.plants.count, after.plants.count);
  assert.notEqual(before.plants.sha256, after.plants.sha256);
  assert.equal(before.devices.sha256, after.devices.sha256);
});
