import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import "../src/lib/env.ts";
import { PrismaClient } from "../src/generated/postgres-client/index.js";
import { authRead } from "../src/lib/prisma-auth-read.ts";

export const target = {
  email: "cuaresmaroniel27@gmail.com",
  id: "2da2cd1a-e594-43cc-a165-552342882246",
  expectedRelations: { plants: 2, devices: 2, scans: 5 },
};
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const userSelect = {
  id: true, email: true, name: true, password: true, role: true, isActive: true,
  createdAt: true, updatedAt: true,
};
const reads = new Set(["findUnique", "findFirst", "findMany", "count", "aggregate", "groupBy"]);

export async function migrationReport(db, providerReads) {
  const snapshot = async () => {
    const [user, plants, devices, scans, users, sessions, refreshTokens] = await Promise.all([
      db.user.findUnique({ where: { id: target.id }, select: userSelect }),
      db.plant.findMany({ where: { userId: target.id }, orderBy: { id: "asc" } }),
      db.device.findMany({ where: { userId: target.id }, orderBy: { id: "asc" } }),
      db.aIAnalysis.findMany({ where: { userId: target.id }, orderBy: { id: "asc" } }),
      db.user.count(), db.authSession.count(), db.refreshToken.count(),
    ]);
    return { user, plants, devices, scans, totals: { users, sessions, refreshTokens } };
  };
  const before = await snapshot();
  const blockers = [];
  if (before.user?.email !== target.email) blockers.push("TARGET_ID_EMAIL_MISMATCH");
  const relations = { plants: before.plants.length, devices: before.devices.length, scans: before.scans.length };
  if (JSON.stringify(relations) !== JSON.stringify(target.expectedRelations)) blockers.push("RELATION_COUNTS_CHANGED");
  let mapping = null;
  let additiveMigration = "applied";
  try {
    mapping = await db.user.findUnique({ where: { id: target.id }, select: { supabaseUserId: true, emailVerifiedAt: true } });
  } catch (error) {
    if (error?.code !== "P2022") throw error;
    additiveMigration = "pending";
    blockers.push("ADDITIVE_MIGRATION_PENDING");
  }
  let providerAccounts = [];
  let providerRead = "available";
  try { providerAccounts = await providerReads.usersByEmail(target.email); }
  catch {
    providerRead = "unavailable";
    blockers.push("SUPABASE_AUTH_READ_UNAVAILABLE");
  }
  if (providerAccounts.length && !providerAccounts.some(account => account.id === mapping?.supabaseUserId))
    blockers.push("EXISTING_SUPABASE_IDENTITY_REQUIRES_REVIEW");
  const hash = before.user?.password ?? "";
  const argon = /^\$argon2id\$v=19\$([^$]+)\$[^$]+\$[^$]+$/.exec(hash);
  const after = await snapshot();
  const unchanged = digest(before) === digest(after);
  if (!unchanged) blockers.push("CONCURRENT_DATABASE_CHANGE_DETECTED");
  return {
    mode: "dry-run", databaseWrites: 0, generatedAt: new Date().toISOString(),
    authProvider: process.env.AUTH_PROVIDER ?? "legacy",
    target: { id: target.id, email: target.email, identityMatches: before.user?.email === target.email },
    relations: { expected: target.expectedRelations, observed: relations },
    totals: before.totals,
    additiveMigration, mapping,
    supabase: { readAccess: providerRead, matchingAccounts: providerAccounts.map(account => ({ id: account.id, emailConfirmed: Boolean(account.emailConfirmedAt) })) },
    password: { format: argon ? "argon2id" : "unknown", parameters: argon?.[1] ?? null,
      requiresParameterReordering: Boolean(argon && !/^m=\d+,t=\d+,p=\d+$/.test(argon[1])), importAttempted: false },
    preservation: { unchanged, snapshotSha256: digest(before) },
    blockers,
    nextStep: "Rehearse import and explicit ID linking on a temporary database copy; this command never imports or links accounts.",
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--output"))
    throw new Error("Only --output <report.json> is supported. No apply/import mode exists.");
  const client = new PrismaClient({ log: [] });
  const db = client.$extends({ query: { $allModels: { async $allOperations({ operation, args: queryArgs, query }) {
    if (!reads.has(operation)) throw new Error("Dry-run refused a database mutation.");
    return query(queryArgs);
  } } } });
  try {
    const report = await migrationReport(db, authRead);
    const output = JSON.stringify(report, null, 2) + "\n";
    if (args[1]) {
      const path = resolve(args[1]);
      await mkdir(resolve(path, ".."), { recursive: true });
      await writeFile(path, output, { mode: 0o600 });
    }
    process.stdout.write(output);
    if (!report.preservation.unchanged || !report.target.identityMatches) process.exitCode = 2;
  } finally {
    await Promise.all([client.$disconnect(), authRead.disconnect()]);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    // Prisma connection errors can contain connection details; never print them.
    console.error("Dry-run failed without applying changes.", typeof error?.code === "string" ? error.code : "Check arguments and database connectivity.");
    process.exitCode = 1;
  });
}
