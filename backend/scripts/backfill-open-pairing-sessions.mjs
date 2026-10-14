import { backfillOpenPairingSessions } from "../src/lib/backfill-pairing-sessions.ts";
import { prismaPg } from "../src/lib/prisma-pg.ts";

try {
  const count = await backfillOpenPairingSessions(prismaPg);
  console.log(`Created ${count} open pairing session(s). Existing sessions and MongoDB readings were unchanged.`);
} catch (error) {
  // Database diagnostics may contain connection details. Print no credentials.
  console.error("Pairing-session backfill failed.",
    { code: typeof error === "object" && error !== null && "code" in error ? error.code : "unknown" });
  process.exitCode = 1;
} finally { await prismaPg.$disconnect(); }
