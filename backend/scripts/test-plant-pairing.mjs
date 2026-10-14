import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout } from "node:timers/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { PrismaClient as MongoDBClient } from "@prisma/client";
import { deployIntegrationPostgres } from "./integration-postgres.mjs";

const cwd = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const id = randomUUID();
const name = `leafcheck-pairing-test-${id}`;
const mongoName = `leafcheck-pairing-mongo-${id}`;
const password = randomBytes(24).toString("hex");
const image = "postgres:16-alpine";
const created = [];

function run(command, args, env = process.env, timeout = 60_000) {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", timeout });
  if (result.error || result.status !== 0) throw new Error(`${command} step failed; check Docker, the local PostgreSQL image and Prisma prerequisites.`);
  return result.stdout;
}

function cleanup() {
  for (const container of [...created].reverse()) {
    // Never delete a resource based on a caller-provided name or database URL.
    const owner = spawnSync("docker", ["inspect", "--format", '{{index .Config.Labels "leafcheck.pairing-test"}}', container], { encoding: "utf8", timeout: 10_000 });
    if (owner.status !== 0 || owner.stdout.trim() !== id) throw new Error("Cannot confirm disposable test container ownership for cleanup.");
    run("docker", ["rm", "--force", "--volumes", container]);
    created.splice(created.indexOf(container),1);
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
  try { cleanup(); } catch { console.error("Disposable test container cleanup failed."); }
  process.exit(signal === "SIGINT" ? 130 : 143);
});

try {
  run("docker", ["info", "--format", "{{.ServerVersion}}"]);
  run("docker", ["image", "inspect", image]);
  run("docker", ["image", "inspect", "mongo:7.0"]);
  run("docker", ["create", "--name", name, "--label", `leafcheck.pairing-test=${id}`,
    "--publish", "127.0.0.1::5432", "--tmpfs", "/var/lib/postgresql/data",
    "--env", "POSTGRES_PASSWORD", "--env", "POSTGRES_USER=leafcheck_test",
    "--env", "POSTGRES_DB=leafcheck_pairing_test", image], { ...process.env, POSTGRES_PASSWORD: password });
  created.push(name);
  run("docker", ["start", name]);
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    const result = spawnSync("docker", ["exec", name, "pg_isready", "-U", "leafcheck_test", "-d", "leafcheck_pairing_test"], { encoding: "utf8", timeout: 5000 });
    if (result.status === 0) { ready = true; break; }
    await setTimeout(1000);
  }
  if (!ready) throw new Error("Disposable PostgreSQL did not become ready.");
  const published = run("docker", ["port", name, "5432/tcp"]).trim();
  if (!/^127\.0\.0\.1:\d+$/.test(published)) throw new Error("Unexpected disposable database binding.");
  const url = `postgresql://leafcheck_test:${password}@${published}/leafcheck_pairing_test`;
  run("docker", ["create", "--name", mongoName, "--label", `leafcheck.pairing-test=${id}`,
    "--publish", "127.0.0.1::27017", "--tmpfs", "/data/db", "--tmpfs", "/data/configdb",
    "mongo:7.0", "--replSet", "leafcheck_pairing", "--bind_ip_all"]);
  created.push(mongoName);
  run("docker", ["start", mongoName]);
  const mongoPublished = run("docker", ["port", mongoName, "27017/tcp"]).trim();
  if (!/^127\.0\.0\.1:\d+$/.test(mongoPublished)) throw new Error("Unexpected disposable MongoDB binding.");
  const mongoUrl = `mongodb://${mongoPublished}/leafcheck_pairing_test?directConnection=true&serverSelectionTimeoutMS=2000&connectTimeoutMS=2000`;
  const administrator = new MongoDBClient({datasources:{db:{url:mongoUrl.replace("/leafcheck_pairing_test?","/admin?")}},log:[]});
  try {
    let mongoReady = false;
    for (let attempt=0;attempt<30;attempt++) {
      try { await administrator.$runCommandRaw({ping:1}); mongoReady=true; break; } catch { await setTimeout(500); }
    }
    if (!mongoReady) throw new Error("Disposable MongoDB did not become ready.");
    await administrator.$runCommandRaw({replSetInitiate:{_id:"leafcheck_pairing",members:[{_id:0,host:"localhost:27017"}]}});
    mongoReady = false;
    for (let attempt=0;attempt<30;attempt++) {
      if ((await administrator.$runCommandRaw({hello:1})).isWritablePrimary === true) {mongoReady=true; break;}
      await setTimeout(500);
    }
    if (!mongoReady) throw new Error("Disposable MongoDB primary was not elected.");
  } finally { await administrator.$disconnect(); }
  const env = { ...process.env, POSTGRES_URL: url, DIRECT_URL: url,
    DATABASE_URL: mongoUrl, LEAFCHECK_SCAN_TEST_CONTAINER: name };
  const prisma = join(dirname(require.resolve("prisma/package.json")), "build/index.js");
  run(process.execPath, [prisma, "generate", "--schema=prisma/schema.postgres.prisma"], env);
  const deployment = await deployIntegrationPostgres(args => run(process.execPath, [prisma, ...args], env));
  process.stdout.write(deployment.replaceAll(password,"[redacted]"));
  const files = process.argv.includes("--plant-telemetry")
    ? ["tests/integration/plant-telemetry.test.mjs"]
    : ["tests/integration/plant-pairing.test.mjs", "tests/integration/ingestion-context.test.mjs"];
  console.log("Disposable PostgreSQL/MongoDB ready; running telemetry integration checks.");
  const result = spawnSync(process.execPath, ["--import", "tsx/esm", "--experimental-test-module-mocks", "--test", ...files], { cwd, env, encoding: "utf8", timeout: 600_000 });
  // Redact the test-only credential even if an upstream diagnostic contains it.
  const redact = (text) => (text ?? "").replaceAll(url, "[test database]").replaceAll(password, "[redacted]");
  process.stdout.write(redact(result.stdout));
  process.stderr.write(redact(result.stderr));
  if (result.error || result.status !== 0) throw new Error("Real PostgreSQL pairing checks failed.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Pairing verification failed.");
  process.exitCode = 1;
} finally {
  try { cleanup(); } catch { console.error("Disposable test container cleanup failed."); process.exitCode = 1; }
}
