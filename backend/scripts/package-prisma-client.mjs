import { access, cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

for (const name of ["postgres-client", "auth-read-client"]) {
  const source = fileURLToPath(new URL(`../src/generated/${name}/`, import.meta.url));
  const destination = fileURLToPath(new URL(`../dist/generated/${name}/`, import.meta.url));
  // Verify generation before replacing a previously packaged client.
  await access(new URL(`../src/generated/${name}/index.js`, import.meta.url));
  await access(new URL(`../src/generated/${name}/package.json`, import.meta.url));
  await mkdir(new URL("../dist/generated/", import.meta.url), { recursive: true });
  await rm(destination, { recursive: true, force: true });
  await cp(source, destination, { recursive: true });
  console.log(`Packaged Prisma client into dist/generated/${name}.`);
}
