import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { PrismaClient as MongoDBClient } from "@prisma/client";

const cwd = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const prisma = join(dirname(require.resolve("prisma/package.json")), "build/index.js");
const id = randomUUID();
const label = "leafcheck.telemetry-schema-test";
const postgresName = `leafcheck-telemetry-schema-pg-${id}`;
const mongoName = `leafcheck-telemetry-schema-mongo-${id}`;
const password = randomBytes(24).toString("hex");
const phaseMigration = "20261014000000_plant_scoped_telemetry";
const containers = [];
let temporaryDirectory;

const redact = value => (value ?? "").replaceAll(password, "[test credential]");
function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", timeout: 60_000 });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} failed: ${redact(result.stderr || result.stdout || result.error?.message)}`);
  }
  return result.stdout;
}

function cleanupContainers() {
  for (const name of [...containers].reverse()) {
    const owner = run("docker", ["inspect", "--format", `{{index .Config.Labels "${label}"}}`, name]).trim();
    if (owner !== id) throw new Error("Cannot confirm ownership of disposable schema-test container.");
    run("docker", ["rm", "--force", "--volumes", name]);
    containers.splice(containers.indexOf(name), 1);
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
  try { cleanupContainers(); } catch { console.error("Schema-test container cleanup failed."); }
  process.exit(signal === "SIGINT" ? 130 : 143);
});

function createContainer(name, image, port, args, env = process.env) {
  run("docker", ["create", "--name", name, "--label", `${label}=${id}`,
    "--publish", `127.0.0.1::${port}`, ...args, image,
    ...(image.startsWith("mongo:") ? ["--replSet", "leafcheck_phase_a", "--bind_ip_all"] : [])], env);
  containers.push(name);
  run("docker", ["start", name]);
  const published = run("docker", ["port", name, `${port}/tcp`]).trim();
  if (!/^127\.0\.0\.1:\d+$/.test(published)) throw new Error("Unexpected disposable database binding.");
  return published;
}

try {
  run("docker", ["info", "--format", "{{.ServerVersion}}"]);
  for (const image of ["postgres:16-alpine", "mongo:7.0"]) run("docker", ["image", "inspect", image]);
  console.log("Creating isolated PostgreSQL and MongoDB schema-test containers.");
  const postgresAddress = createContainer(postgresName, "postgres:16-alpine", 5432,
    ["--tmpfs", "/var/lib/postgresql/data", "--env", "POSTGRES_PASSWORD",
      "--env", "POSTGRES_USER=leafcheck_test", "--env", "POSTGRES_DB=leafcheck_phase_a_test"],
    { ...process.env, POSTGRES_PASSWORD: password });
  let postgresReady = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    const result = spawnSync("docker", ["exec", postgresName, "pg_isready", "-U", "leafcheck_test", "-d", "leafcheck_phase_a_test"],
      { encoding: "utf8", timeout: 5000 });
    if (result.status === 0) { postgresReady = true; break; }
    await setTimeout(500);
  }
  if (!postgresReady) throw new Error("Disposable PostgreSQL did not become ready.");
  run("docker", ["exec", postgresName, "createdb", "-U", "leafcheck_test", "leafcheck_phase_a_duplicates"]);
  const postgresUrl = `postgresql://leafcheck_test:${password}@${postgresAddress}/leafcheck_phase_a_test`;
  const duplicateUrl = `postgresql://leafcheck_test:${password}@${postgresAddress}/leafcheck_phase_a_duplicates`;
  const mongoAddress = createContainer(mongoName, "mongo:7.0", 27017, ["--tmpfs", "/data/db", "--tmpfs", "/data/configdb"]);
  const mongoUrl = `mongodb://${mongoAddress}/leafcheck_phase_a_test?directConnection=true&serverSelectionTimeoutMS=2000&connectTimeoutMS=2000`;
  const administrator = new MongoDBClient({ datasources: { db: { url: mongoUrl.replace("/leafcheck_phase_a_test?", "/admin?") } }, log: [] });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      try { await administrator.$runCommandRaw({ ping: 1 }); ready = true; break; } catch { await setTimeout(500); }
    }
    if (!ready) throw new Error("Disposable MongoDB did not become ready.");
    await administrator.$runCommandRaw({ replSetInitiate: { _id: "leafcheck_phase_a", members: [{ _id: 0, host: "localhost:27017" }] } });
    ready = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      const state = await administrator.$runCommandRaw({ hello: 1 });
      if (state.isWritablePrimary === true) { ready = true; break; }
      await setTimeout(500);
    }
    if (!ready) throw new Error("Disposable MongoDB primary was not elected.");
  } finally { await administrator.$disconnect(); }

  const env = { ...process.env, POSTGRES_URL: postgresUrl, DIRECT_URL: postgresUrl, DATABASE_URL: mongoUrl,
    LEAFCHECK_TELEMETRY_SCHEMA_TEST_ID: id,
    LEAFCHECK_TELEMETRY_SCHEMA_DUPLICATE_URL: duplicateUrl };
  temporaryDirectory = await mkdtemp(join(tmpdir(), "leafcheck-telemetry-schema-"));
  const schema = join(temporaryDirectory, "schema.postgres.prisma");
  await cp(join(cwd, "prisma/schema.postgres.prisma"), schema);
  await mkdir(join(temporaryDirectory, "migrations"));
  await cp(join(cwd, "prisma/migrations/migration_lock.toml"), join(temporaryDirectory, "migrations/migration_lock.toml"), { recursive: true });
  for (const entry of await readdir(join(cwd, "prisma/migrations"), { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name < phaseMigration) {
      await cp(join(cwd, "prisma/migrations", entry.name), join(temporaryDirectory, "migrations", entry.name), { recursive: true });
    }
  }
  run(process.execPath, [prisma, "migrate", "deploy", `--schema=${schema}`], env);
  run(process.execPath, [prisma, "migrate", "deploy", `--schema=${schema}`],
    { ...env, POSTGRES_URL: duplicateUrl, DIRECT_URL: duplicateUrl });
  for (const name of ["schema.postgres.prisma", "schema.prisma"]) {
    run(process.execPath, [prisma, "generate", `--schema=prisma/${name}`], env);
  }
  console.log("Disposable databases ready; testing migrations, native constraints and legacy MongoDB documents.");
  const result = spawnSync(process.execPath,
    ["--import", "tsx/esm", "--test", "tests/integration/telemetry-schema.test.mjs"],
    { cwd, env, encoding: "utf8", timeout: 120_000 });
  process.stdout.write(redact(result.stdout));
  process.stderr.write(redact(result.stderr));
  if (result.error || result.status !== 0) throw new Error("Telemetry schema integration checks failed.");
} catch (error) {
  console.error(redact(error instanceof Error ? error.message : "Telemetry schema verification failed."));
  process.exitCode = 1;
} finally {
  try { cleanupContainers(); } catch (error) {
    console.error(redact(error instanceof Error ? error.message : "Schema-test cleanup failed."));
    process.exitCode = 1;
  }
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
}
