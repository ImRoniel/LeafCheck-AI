import { access, cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(
  new URL("../src/generated/postgres-client/", import.meta.url),
);
const destination = fileURLToPath(
  new URL("../dist/generated/postgres-client/", import.meta.url),
);

// Verify generation before removing any previously packaged client.
await access(
  new URL("../src/generated/postgres-client/index.js", import.meta.url),
);
await access(
  new URL("../src/generated/postgres-client/package.json", import.meta.url),
);
await mkdir(new URL("../dist/generated/", import.meta.url), {
  recursive: true,
});
await rm(destination, { recursive: true, force: true });
// Preserve package metadata, runtime code, schema, and platform-specific engines.
await cp(source, destination, { recursive: true });
console.log(
  "Packaged PostgreSQL Prisma client into dist/generated/postgres-client.",
);
