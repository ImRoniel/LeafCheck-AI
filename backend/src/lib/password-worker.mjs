import { argon2id } from "hash-wasm";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { parentPort } from "node:worker_threads";

const parameters = {
  memorySize: 65536,
  iterations: 3,
  parallelism: 1,
  hashLength: 32,
};

// Public dummy fixture: invalid/missing credentials still do a full KDF.
const dummy =
  "$argon2id$v=19$m=65536,p=1,t=3$MDEyMzQ1Njc4OWFiY2RlZg$Rodqfi3TRnDrJEDFHDYIqSfIpHjPepGqQdijfA2O+0U";

function parseHash(encoded) {
  if (typeof encoded !== "string" || encoded.length > 1024) return null;
  const match =
    /^\$argon2id\$v=19\$((?:[mtp]=[1-9][0-9]*,){2}[mtp]=[1-9][0-9]*)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/.exec(
      encoded,
    );
  if (!match) return null;
  const entries = match[1].split(",").map((entry) => entry.split("="));
  if (new Set(entries.map(([key]) => key)).size !== 3) return null;
  const { m, t, p } = Object.fromEntries(
    entries.map(([key, value]) => [key, Number(value)]),
  );
  // Bound untrusted stored parameters before allocating WASM memory.
  if (p > 4 || t > 10 || m < 8 * p || m > 262144) return null;
  const salt = Buffer.from(match[2], "base64");
  const digest = Buffer.from(match[3], "base64");
  if (
    salt.length < 8 ||
    salt.length > 64 ||
    digest.length < 16 ||
    digest.length > 64
  )
    return null;
  if (
    salt.toString("base64").replace(/=+$/, "") !== match[2] ||
    digest.toString("base64").replace(/=+$/, "") !== match[3]
  )
    return null;
  return {
    memorySize: m,
    iterations: t,
    parallelism: p,
    hashLength: digest.length,
    salt,
    digest,
  };
}

parentPort.on("message", async ({ operation, password, stored }) => {
  try {
    let result;
    if (operation === "hash") {
      result = await argon2id({
        ...parameters,
        password,
        salt: randomBytes(16),
        outputType: "encoded",
      });
    } else {
      const parsed = parseHash(stored);
      const { digest, ...options } = parsed ?? parseHash(dummy);
      const actual = await argon2id({
        ...options,
        password,
        outputType: "binary",
      });
      result = timingSafeEqual(actual, digest) && parsed !== null;
    }
    parentPort.postMessage({ result });
  } catch {
    // Never send credentials, hashes, or underlying exceptions to logs/clients.
    parentPort.postMessage({ failed: true });
  }
});
