import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout } from "node:timers/promises";
import { deployIntegrationPostgres } from "./integration-postgres.mjs";

const cwd = fileURLToPath(new URL("../", import.meta.url));
const owner = randomUUID();
const container = `leafcheck-admin-security-${owner}`;
const password = randomBytes(24).toString("hex");
let created = false;
const redact = value => (value ?? "").replaceAll(password, "[redacted]");
function run(command, args, env = process.env, timeout = 60_000) {
  const result = spawnSync(command, args, { cwd, env, timeout, encoding: "utf8" });
  if (result.error || result.status !== 0) throw new Error(redact(result.stderr || result.stdout || "Local admin security verification failed."));
  return result.stdout;
}
function cleanup() {
  if (!created) return;
  const label = run("docker", ["inspect", "--format", '{{index .Config.Labels "leafcheck.admin-security"}}', container]).trim();
  if (label !== owner) throw new Error("Cannot verify test container ownership.");
  run("docker", ["rm", "--force", "--volumes", container]);
  created = false;
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
  try { cleanup(); } finally { process.exit(signal === "SIGINT" ? 130 : 143); }
});
try {
  run("docker", ["image", "inspect", "postgres:16-alpine"]);
  run("docker", ["create", "--name", container, "--label", `leafcheck.admin-security=${owner}`,
    "--publish", "127.0.0.1::5432", "--tmpfs", "/var/lib/postgresql/data", "--env", "POSTGRES_PASSWORD",
    "--env", "POSTGRES_USER=leafcheck_test", "--env", "POSTGRES_DB=leafcheck_admin_test", "postgres:16-alpine"],
  { ...process.env, POSTGRES_PASSWORD: password });
  created = true;
  run("docker", ["start", container]);
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    if (spawnSync("docker", ["exec", container, "pg_isready", "-U", "leafcheck_test", "-d", "leafcheck_admin_test"], { timeout: 5000, stdio: "ignore" }).status === 0) { ready = true; break; }
    await setTimeout(500);
  }
  if (!ready) throw new Error("Local PostgreSQL did not become ready.");
  const address = run("docker", ["port", container, "5432/tcp"]).trim();
  if (!/^127\.0\.0\.1:\d+$/.test(address)) throw new Error("Unexpected test database binding.");
  const url = `postgresql://leafcheck_test:${password}@${address}/leafcheck_admin_test`;
  const env = { ...process.env, POSTGRES_URL: url, DIRECT_URL: url, LEAFCHECK_ADMIN_SECURITY_TEST_CONTAINER: container };
  const require = createRequire(import.meta.url);
  const cli = join(dirname(require.resolve("prisma/package.json")), "build/index.js");
  run(process.execPath, [cli, "generate", "--schema=prisma/schema.postgres.prisma"], env);
  console.log(redact(await deployIntegrationPostgres(args => run(process.execPath, [cli, ...args], env))));
  const tests = spawnSync(process.execPath, ["--import", "tsx/esm", "--experimental-test-module-mocks", "--test", "tests/integration/admin-security.test.mjs"],
    { cwd, env, timeout: 180_000, encoding: "utf8" });
  process.stdout.write(redact(tests.stdout));
  process.stderr.write(redact(tests.stderr));
  if (tests.error || tests.status !== 0) throw new Error("Real PostgreSQL admin security tests failed.");
} catch (error) {
  console.error(redact(error instanceof Error ? error.message : "Admin security verification failed."));
  process.exitCode = 1;
} finally {
  try { cleanup(); } catch { console.error("Owned test container cleanup failed."); process.exitCode = 1; }
}
