# Portable password hashing

## Why this changed

Windows Smart App Control / Code Integrity blocked the third-party native
Argon2 addon (event 3077). Authentication now uses hash-wasm's WebAssembly
Argon2id in Node worker threads. No native Argon2 DLL, compiler, Python toolchain,
or Windows security-policy exception is required. Do not disable Smart App Control.

## Fresh clone

Use Node.js 24 LTS (validated here on 24.12.0) and npm. From the repository root:

```sh
npm ci
npm run db:generate:all --workspace=backend
npm run dev --workspace=backend
```

Configure database connections, JWT secrets, and external services separately as
described in AUTH_DEPLOYMENT.md and the main README. Environment files/secrets are
not committed. This fix does not provision databases or bypass organizational
policies for other dependencies (including Prisma engines).

For a production build:

```sh
npm run build --workspace=backend
npm run start --workspace=backend
```

The TypeScript build copies the JavaScript worker into dist/lib automatically.
Deploy the complete dist directory plus production dependencies, not server.js alone.
Commit backend/package.json, package-lock.json, the worker, pool, tests and build
configuration together. Do not copy node_modules between operating systems.

## Compatibility and security

New hashes retain Argon2id v19, 64 MiB memory, three iterations, one lane, a random
16-byte salt and a 32-byte digest. Existing hashes produced by this application's
native Argon2 implementation remain valid; no password reset or database migration
is required. Tests contain synthetic native-generated fixtures, never real accounts.
Passwords are not trimmed or normalized. Digest comparison uses timingSafeEqual.

Verification supports v19 Argon2id with 8–64 byte salts, 16–64 byte digests,
1–4 lanes, 1–10 iterations and at most 256 MiB memory. Both parameter orders are
accepted. Unsupported/malformed records perform dummy hashing and fail closed.
If importing hashes outside these bounds, review capacity and compatibility first.

## Capacity

- AUTH_HASH_WORKERS: 1–8; default is the smaller of 2 and available CPU parallelism.
- AUTH_HASH_QUEUE_LIMIT: 0–256 waiting jobs; default 32 per process.
- Each active job has a 30-second deadline. Worker failure/timeout rejects work;
  future requests can create replacement workers.
- Saturation/failure returns HTTP 503 with AUTH_BUSY, not invalid credentials.
- Idle workers do not keep Node alive. Workers are reused; their WASM memory may
  retain its high-water allocation. Budget up to 256 MiB per worker for supported
  imported hashes, plus Node/worker overhead (normal new hashes use 64 MiB).

Load-test on deployment hardware before raising limits. Every replica has its own
pool; scale replicas according to CPU and memory budgets. Existing route rate
limits remain in force. Never log passwords, encoded hashes, or worker payloads.

Run regression tests with `npm test --workspace=backend`.
