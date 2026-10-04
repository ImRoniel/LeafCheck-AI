import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout } from "node:timers/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const cwd = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const id = randomUUID();
const name = `leafcheck-scan-test-${id}`;
const password = randomBytes(24).toString("hex");
const image = "postgres:16-alpine";
let created = false;

function run(command, args, env = process.env, timeout = 60_000) {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", timeout });
  if (result.error || result.status !== 0) throw new Error(`${command} step failed; check Docker, the local PostgreSQL image and Prisma prerequisites.`);
  return result.stdout;
}

function cleanup() {
  if (!created) return;
  // Never delete a resource based on a caller-provided name or database URL.
  const owner = spawnSync("docker", ["inspect", "--format", '{{index .Config.Labels "leafcheck.scan-test"}}', name], { encoding: "utf8", timeout: 10_000 });
  if (owner.status !== 0 || owner.stdout.trim() !== id) throw new Error("Cannot confirm disposable test container ownership for cleanup.");
  run("docker", ["rm", "--force", name]);
  created = false;
}

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
  try { cleanup(); } catch { console.error("Disposable test container cleanup failed."); }
  process.exit(signal === "SIGINT" ? 130 : 143);
});

try {
  run("docker", ["info", "--format", "{{.ServerVersion}}"]);
  run("docker", ["image", "inspect", image]);
  run("docker", ["create", "--name", name, "--label", `leafcheck.scan-test=${id}`,
    "--publish", "127.0.0.1::5432", "--tmpfs", "/var/lib/postgresql/data",
    "--env", "POSTGRES_PASSWORD", "--env", "POSTGRES_USER=leafcheck_test",
    "--env", "POSTGRES_DB=leafcheck_scan_test", image], { ...process.env, POSTGRES_PASSWORD: password });
  created = true;
  run("docker", ["start", name]);
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    const result = spawnSync("docker", ["exec", name, "pg_isready", "-U", "leafcheck_test", "-d", "leafcheck_scan_test"], { encoding: "utf8", timeout: 5000 });
    if (result.status === 0) { ready = true; break; }
    await setTimeout(1000);
  }
  if (!ready) throw new Error("Disposable PostgreSQL did not become ready.");
  const published = run("docker", ["port", name, "5432/tcp"]).trim();
  if (!/^127\.0\.0\.1:\d+$/.test(published)) throw new Error("Unexpected disposable database binding.");
  const url = `postgresql://leafcheck_test:${password}@${published}/leafcheck_scan_test`;
  const env = { ...process.env, POSTGRES_URL: url, DIRECT_URL: url,
    DATABASE_URL: "mongodb://127.0.0.1:1/unused", LEAFCHECK_SCAN_TEST_CONTAINER: name };
  const prisma = join(dirname(require.resolve("prisma/package.json")), "build/index.js");
  run(process.execPath, [prisma, "generate", "--schema=prisma/schema.postgres.prisma"], env);
  run(process.execPath, [prisma, "db", "push", "--schema=prisma/schema.postgres.prisma", "--skip-generate"], env);
  console.log("Disposable PostgreSQL ready; running real commit/rollback checks.");
  const result = spawnSync(process.execPath, ["--import", "tsx/esm", "--test", "tests/integration/scan-persistence.test.mjs"], { cwd, env, encoding: "utf8", timeout: 600_000 });
  // Redact the test-only credential even if an upstream diagnostic contains it.
  const redact = (text) => (text ?? "").replaceAll(url, "[test database]").replaceAll(password, "[redacted]");
  process.stdout.write(redact(result.stdout));
  process.stderr.write(redact(result.stderr));
  if (result.error || result.status !== 0) throw new Error("Real PostgreSQL scan persistence checks failed.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Persistence verification failed.");
  process.exitCode = 1;
} finally {
  try { cleanup(); } catch { console.error("Disposable test container cleanup failed."); process.exitCode = 1; }
}
