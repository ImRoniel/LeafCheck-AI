import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const prismaDirectory = fileURLToPath(new URL("../prisma/", import.meta.url));

/** Install the actual Phase A migration, including its non-Prisma constraints. */
export async function deployIntegrationPostgres(runPrisma) {
  const temporary = await mkdtemp(join(tmpdir(), "leafcheck-pairing-migrations-"));
  try {
    const current = await readFile(join(prismaDirectory, "schema.postgres.prisma"), "utf8");
    // Earlier committed migrations predate the current scan/task models. Generate
    // a test-only baseline for those models, then apply Phase A unchanged. This
    // neither edits application migrations nor lets db push omit native checks.
    const securityMigrations = (await readdir(join(prismaDirectory, "migrations")))
      .filter(name => name.endsWith("_admin_security_foundation"));
    const preSecurity = securityMigrations.length ? current
      .replace(/\nmodel (?:AdminChallenge|AdminSessionVerification|AuditLog) \{[\s\S]*?\n\}\n/g, "\n")
      .replace(/^\s*(?:adminChallenges|adminVerifications|auditLogs|authVersion|authInvalidBefore)\s+[^\n]*\r?\n/gm, "") : current;
    const baseline = preSecurity
      .replace(/^\s*pairingHistory\s+DevicePairingHistory\[\]\r?\n/gm, "")
      .replace(/\nmodel DevicePairingHistory \{[\s\S]*?\n\}\n/, "\n");
    if (baseline === current || /DevicePairingHistory/.test(baseline)) throw new Error("Cannot build the pre-Phase A test baseline.");
    const schema = join(temporary, "schema.postgres.prisma");
    await writeFile(schema, baseline);
    const baselineMigration = join(temporary, "migrations/00000000000000_test_baseline");
    await mkdir(baselineMigration, {recursive:true});
    const sql = runPrisma(["migrate", "diff", "--from-empty", `--to-schema-datamodel=${schema}`, "--script"]);
    await writeFile(join(baselineMigration, "migration.sql"), sql);
    const phaseA = "20261014000000_plant_scoped_telemetry";
    await cp(join(prismaDirectory, "migrations", phaseA), join(temporary, "migrations", phaseA), {recursive:true});
    for (const migration of securityMigrations)
      await cp(join(prismaDirectory, "migrations", migration), join(temporary, "migrations", migration), { recursive: true });
    await cp(join(prismaDirectory, "migrations/migration_lock.toml"), join(temporary, "migrations/migration_lock.toml"));
    await writeFile(schema, current);
    return runPrisma(["migrate", "deploy", `--schema=${schema}`]);
  } finally {
    await rm(temporary, {recursive:true,force:true});
  }
}
