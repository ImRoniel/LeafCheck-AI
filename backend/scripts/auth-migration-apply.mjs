import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { migrationDigest, migrationReport, migrationSnapshot, target } from "./auth-migration-dry-run.mjs";

class MigrationError extends Error {}
const fail = code => { throw new MigrationError(code); };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const mappingSelect = { supabaseUserId: true, emailVerifiedAt: true };
const emit = (event, value) => console.log(event, JSON.stringify(value));

export function parseApplyArgs(args) {
  const options = { confirm: null, checkpointPath: resolve(".auth-migration", `${target.id}.json`) };
  const seen = new Set();
  for (const arg of args) {
    const match = /^--(confirm|checkpoint)=(.+)$/.exec(arg);
    if (!match || seen.has(match[1])) fail("Use --confirm=<User.id> and optional --checkpoint=<path.json> exactly once.");
    seen.add(match[1]);
    if (match[1] === "confirm") options.confirm = match[2];
    else options.checkpointPath = resolve(match[2]);
  }
  if (options.confirm !== target.id) fail(`Confirmation required: --confirm=${target.id}`);
  return options;
}

export function normalizeArgon2Hash(value) {
  const match = typeof value === "string" && value.length <= 1024 && /^\$argon2id\$v=19\$([^$]+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/.exec(value);
  if (!match) fail("UNSUPPORTED_PASSWORD_HASH");
  const parameters = new Map();
  for (const part of match[1].split(",")) {
    const parameter = /^([mtp])=([1-9]\d*)$/.exec(part);
    if (!parameter || parameters.has(parameter[1])) fail("UNSUPPORTED_PASSWORD_PARAMETERS");
    const number = Number(parameter[2]);
    if (!Number.isSafeInteger(number) || number > 0xffffffff) fail("UNSUPPORTED_PASSWORD_PARAMETERS");
    parameters.set(parameter[1], number);
  }
  if (parameters.size !== 3 || parameters.get("m") < 8 * parameters.get("p")) fail("UNSUPPORTED_PASSWORD_PARAMETERS");
  for (const [encoded, minimum] of [[match[2], 8], [match[3], 4]]) {
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.length < minimum || bytes.toString("base64").replace(/=+$/, "") !== encoded) fail("UNSUPPORTED_PASSWORD_HASH");
  }
  return `$argon2id$v=19$m=${parameters.get("m")},t=${parameters.get("t")},p=${parameters.get("p")}$${match[2]}$${match[3]}`;
}

/** No salt, password hash, tokens, or API keys enter the preservation log/checkpoint. */
export function preservationManifest(snapshot) {
  const { updatedAt: _updatedAt, ...identity } = snapshot.user ?? {};
  const relation = rows => ({ count: rows.length, ids: rows.map(row => row.id), sha256: migrationDigest(rows) });
  return {
    userId: identity.id, email: identity.email, legacyUserSha256: migrationDigest(identity),
    plants: relation(snapshot.plants), devices: relation(snapshot.devices), scans: relation(snapshot.scans),
    totals: snapshot.totals,
  };
}

export function migrationAdmin({ url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY, fetch: fetcher = globalThis.fetch } = {}) {
  let origin;
  try { origin = new URL(url); } catch { fail("SUPABASE_URL must be an HTTPS project origin."); }
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/")
    fail("SUPABASE_URL must be an HTTPS project origin.");
  const legacyKey = typeof key === "string" && /^[\w-]+\.[\w-]+\.[\w-]+$/.test(key);
  if (typeof key !== "string" || (!key.startsWith("sb_secret_") && !legacyKey)) fail("SUPABASE_SECRET_KEY must be a server secret key.");
  return {
    project: origin.origin,
    async createUser(body) {
      let response;
      try {
        response = await fetcher(`${origin.origin}/auth/v1/admin/users`, {
          method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
          headers: { apikey: key, "Content-Type": "application/json", ...(legacyKey ? { Authorization: `Bearer ${key}` } : {}) },
          body: JSON.stringify(body),
        });
      } catch { fail("SUPABASE_CREATE_OUTCOME_UNKNOWN"); }
      // Never print provider response bodies: they can echo imported password material.
      if (!response.ok) fail(`SUPABASE_CREATE_REJECTED_HTTP_${response.status}`);
      try { return await response.json(); } catch { fail("SUPABASE_CREATE_OUTCOME_UNKNOWN"); }
    },
  };
}

async function checkpointFile(path, checkpoint, initial = false) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = initial ? path : `${path}.${randomUUID()}.tmp`;
  const file = await open(temporary, "wx", 0o600);
  try { await file.writeFile(JSON.stringify(checkpoint, null, 2) + "\n"); await file.sync(); }
  finally { await file.close(); }
  if (!initial) await rename(temporary, path);
  const folder = await open(dirname(path), "r");
  try { await folder.sync(); } finally { await folder.close(); }
}

export function recoverySteps(checkpointPath, checkpoint) {
  return [
    `Preserve Supabase user ${checkpoint.supabaseUserId} if it exists. DO NOT delete it or repeat the import.`,
    `Save checkpoint ${checkpointPath} outside an ephemeral Render shell before closing it.`,
    "Run npm run auth:migration:dry-run --workspace=backend and inspect its existing-identity blocker.",
    `In Supabase Authentication > Users, verify project ${checkpoint.project}, UID ${checkpoint.supabaseUserId}, email ${target.email}, confirmed email, and app_metadata.leafcheck_migration_user_id=${target.id}. If the create outcome was unknown, first establish whether this UID exists; do not assume creation failed.`,
    "Compare the current preservation manifest with checkpoint.before. Stop if row IDs or SHA256 fingerprints differ.",
    `After that review, follow backend/scripts/auth-migration-recovery.md. In a Prisma Serializable transaction update only the existing User row: await tx.user.updateMany({ where: { id: "${target.id}", email: "${target.email}", supabaseUserId: null }, data: { supabaseUserId: "${checkpoint.supabaseUserId}", emailVerifiedAt: new Date() } }); Require count === 1; compare preservation manifests again before commit. Do not create a new User or alter its password/role/relations.`,
    `Re-run npm run auth:migration:apply --workspace=backend -- --confirm=${target.id}; expect ALREADY_MIGRATED with zero writes.`,
  ];
}

export async function applyMigration({ db, providerReads, admin, confirm, checkpointPath, log = emit }) {
  if (confirm !== target.id) fail(`Confirmation required: --confirm=${target.id}`);
  checkpointPath = resolve(checkpointPath);
  const report = await migrationReport(db, providerReads);
  log("PREFLIGHT", report);
  if (report.blockers.length) {
    // Existing identities are never adopted by this command, even after a partial import.
    try {
      const previous = JSON.parse(await readFile(checkpointPath, "utf8"));
      if (previous.userId === target.id && previous.email === target.email && previous.project === admin.project && uuid.test(previous.supabaseUserId))
        log("RECOVERY_REQUIRED", { checkpointPath, supabaseUserId: previous.supabaseUserId,
          steps: recoverySteps(checkpointPath, { project: admin.project, supabaseUserId: previous.supabaseUserId }) });
    } catch { /* A missing checkpoint cannot relax preflight blockers. */ }
    fail(`PREFLIGHT_BLOCKED: ${report.blockers.join(", ")}`);
  }
  const before = await migrationSnapshot(db);
  if (migrationDigest(before) !== report.preservation.snapshotSha256) fail("CONCURRENT_DATABASE_CHANGE_DETECTED");
  if (!before.user?.isActive) fail("TARGET_USER_INACTIVE");
  const manifest = preservationManifest(before);
  log("PRESERVATION_BEFORE", manifest);
  const accounts = report.supabase.matchingAccounts;
  if (report.mapping?.supabaseUserId) {
    if (accounts.length !== 1 || accounts[0].id !== report.mapping.supabaseUserId || !accounts[0].emailConfirmed || !report.mapping.emailVerifiedAt)
      fail("EXISTING_MAPPING_REQUIRES_REVIEW");
    const after = preservationManifest(await migrationSnapshot(db));
    if (migrationDigest(manifest) !== migrationDigest(after)) fail("CONCURRENT_DATABASE_CHANGE_DETECTED");
    log("PRESERVATION_AFTER", { ...after, unchanged: true });
    const result = { status: "already_migrated", userId: target.id, supabaseUserId: accounts[0].id, databaseWrites: 0, providerWrites: 0 };
    log("ALREADY_MIGRATED", result);
    return result;
  }
  if (accounts.length) fail("EXISTING_SUPABASE_IDENTITY_REQUIRES_REVIEW");
  const hash = normalizeArgon2Hash(before.user.password);
  log("PASSWORD_IMPORT", { algorithm: "argon2id", parameters: hash.split("$")[3], legacyHashUnchanged: true });
  const checkpoint = {
    version: 1, phase: "prepared", createdAt: new Date().toISOString(), project: admin.project,
    userId: target.id, email: target.email, supabaseUserId: randomUUID(), before: manifest,
  };
  // Reserve an intended provider UUID durably before POST so even a lost response is recoverable.
  try { await checkpointFile(checkpointPath, checkpoint, true); }
  catch { fail("CHECKPOINT_UNAVAILABLE_OR_EXISTS: Review the existing checkpoint; no import was attempted."); }
  log("CHECKPOINT_PREPARED", { path: checkpointPath, ...checkpoint });
  let linkCommitted = false;
  try {
    // Recheck identity and the full source snapshot after reserving the checkpoint, before POST.
    if ((await providerReads.usersByEmail(target.email)).length) fail("EXISTING_SUPABASE_IDENTITY_REQUIRES_REVIEW");
    if (migrationDigest(await migrationSnapshot(db)) !== report.preservation.snapshotSha256) fail("CONCURRENT_DATABASE_CHANGE_DETECTED");
    const response = await admin.createUser({
      id: checkpoint.supabaseUserId, email: target.email, password_hash: hash, email_confirm: true,
      user_metadata: { name: before.user.name }, app_metadata: { leafcheck_migration_user_id: target.id },
    });
    const created = response?.user ?? response;
    if (!uuid.test(created?.id) || created.id !== checkpoint.supabaseUserId || created.email?.toLowerCase() !== target.email ||
        typeof created.email_confirmed_at !== "string" || !Number.isFinite(Date.parse(created.email_confirmed_at)))
      fail("SUPABASE_CREATE_RESPONSE_REQUIRES_REVIEW");
    checkpoint.supabaseUserId = created.id;
    checkpoint.phase = "provider-created";
    await checkpointFile(checkpointPath, checkpoint);
    log("SUPABASE_CREATED", { supabaseUserId: created.id, checkpoint: checkpointPath });
    const live = await providerReads.user(created.id);
    if (live?.id !== created.id || live.email?.toLowerCase() !== target.email || !live.emailConfirmedAt)
      fail("SUPABASE_DATABASE_IDENTITY_MISMATCH");
    const verifiedAt = new Date();
    await db.$transaction(async tx => {
      if (migrationDigest(await migrationSnapshot(tx)) !== report.preservation.snapshotSha256) fail("CONCURRENT_DATABASE_CHANGE_DETECTED");
      const mapping = await tx.user.findUnique({ where: { id: target.id }, select: mappingSelect });
      if (!mapping || mapping.supabaseUserId !== null || String(mapping.emailVerifiedAt) !== String(report.mapping.emailVerifiedAt))
        fail("CONCURRENT_MAPPING_CHANGE_DETECTED");
      const update = await tx.user.updateMany({
        where: { id: target.id, email: target.email, password: before.user.password, isActive: true,
          updatedAt: before.user.updatedAt, supabaseUserId: null, emailVerifiedAt: report.mapping.emailVerifiedAt },
        data: { supabaseUserId: created.id, emailVerifiedAt: verifiedAt },
      });
      if (update.count !== 1) fail("GUARDED_USER_LINK_FAILED");
      const linked = await tx.user.findUnique({ where: { id: target.id }, select: mappingSelect });
      if (linked?.supabaseUserId !== created.id || linked.emailVerifiedAt?.getTime() !== verifiedAt.getTime())
        fail("USER_LINK_POSTCHECK_FAILED");
      if (migrationDigest(preservationManifest(await migrationSnapshot(tx))) !== migrationDigest(manifest)) fail("PRESERVATION_CHECK_FAILED");
    }, { isolationLevel: "Serializable", maxWait: 5000, timeout: 15000 });
    linkCommitted = true;
    checkpoint.phase = "linked";
    checkpoint.emailVerifiedAt = verifiedAt.toISOString();
    const after = preservationManifest(await migrationSnapshot(db));
    log("PRESERVATION_AFTER", { ...after, unchanged: migrationDigest(after) === migrationDigest(manifest) });
    if (migrationDigest(after) !== migrationDigest(manifest)) fail("POST_COMMIT_PRESERVATION_REQUIRES_REVIEW");
    await checkpointFile(checkpointPath, checkpoint);
    const result = { status: "migrated", userId: target.id, supabaseUserId: created.id, emailVerifiedAt: checkpoint.emailVerifiedAt,
      databaseWrites: 1, providerWrites: 1, preservationUnchanged: true };
    log("MIGRATION_COMPLETE", result);
    return result;
  } catch (error) {
    // Neither a timeout nor a database failure authorizes deleting the provider identity.
    try {
      const after = preservationManifest(await migrationSnapshot(db));
      log("PRESERVATION_AFTER", { ...after, unchanged: migrationDigest(after) === migrationDigest(manifest) });
    } catch { log("PRESERVATION_AFTER_UNAVAILABLE", { userId: target.id, manualVerificationRequired: true }); }
    log("RECOVERY_REQUIRED", { checkpoint: { ...checkpoint, linkCommitted }, checkpointPath, steps: recoverySteps(checkpointPath, checkpoint) });
    throw error;
  }
}

async function main() {
  const options = parseApplyArgs(process.argv.slice(2));
  const { PrismaClient } = await import("../src/generated/postgres-client/index.js");
  const { authRead } = await import("../src/lib/prisma-auth-read.ts");
  const admin = migrationAdmin(); // Deliberately independent of AUTH_PROVIDER; no cutover occurs here.
  const db = new PrismaClient({ log: [] });
  try { await applyMigration({ ...options, db, providerReads: authRead, admin }); }
  finally { await Promise.all([db.$disconnect(), authRead.disconnect()]); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    // Only our fixed messages are safe; Prisma/network errors may include credentials.
    const message = error instanceof MigrationError
      ? error.message : "Migration stopped. Review the checkpoint and database connectivity; no provider user was deleted.";
    console.error(message);
    process.exitCode = 1;
  });
}
