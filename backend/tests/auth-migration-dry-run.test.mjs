import assert from "node:assert/strict";
import test from "node:test";
import { migrationReport, target } from "../scripts/auth-migration-dry-run.mjs";

function fixture({ pending = false, wrongEmail = false, providerConflict = false, concurrentChange = false } = {}) {
  let writes = 0, reads = 0;
  const forbidden = () => { writes++; throw new Error("Database writes forbidden"); };
  const rows = count => Array.from({ length: count }, (_, id) => ({ id: String(id), userId: target.id }));
  const db = {
    user: {
      async findUnique({ select }) {
        if (select.supabaseUserId) {
          if (pending) throw { code: "P2022" };
          return { supabaseUserId: null, emailVerifiedAt: null };
        }
        return { id: target.id, email: wrongEmail ? "wrong@example.test" : target.email,
          password: "$argon2id$v=19$m=65536,p=1,t=3$secret-salt$secret-hash", role: "USER", isActive: true,
          updatedAt: concurrentChange ? ++reads : 1 };
      },
      async count() { return 3; }, create: forbidden, update: forbidden, delete: forbidden,
    },
    plant: { async findMany() { return rows(2); }, update: forbidden },
    device: { async findMany() { return rows(2); }, update: forbidden },
    aIAnalysis: { async findMany() { return rows(5); }, update: forbidden },
    authSession: { async count() { return 28; }, deleteMany: forbidden, updateMany: forbidden },
    refreshToken: { async count() { return 112; }, deleteMany: forbidden, updateMany: forbidden },
  };
  return { db, provider: { async usersByEmail() { return providerConflict ? [{ id: "another-provider-id", emailConfirmedAt: new Date() }] : []; } }, writes: () => writes };
}
test("migration dry-run reads the exact identity, preserves relations and redacts password material", async () => {
  const f = fixture();
  const report = await migrationReport(f.db, f.provider);
  assert.equal(f.writes(), 0);
  assert.equal(report.databaseWrites, 0);
  assert.equal(report.target.identityMatches, true);
  assert.deepEqual(report.relations.observed, { plants: 2, devices: 2, scans: 5 });
  assert.equal(report.preservation.unchanged, true);
  assert.equal(report.password.importAttempted, false);
  assert.ok(!JSON.stringify(report).includes("secret-hash"));
  assert.ok(!JSON.stringify(report).includes("secret-salt"));
});
test("dry-run reports an unapplied migration without attempting it", async () => {
  const f = fixture({ pending: true });
  const report = await migrationReport(f.db, f.provider);
  assert.equal(report.additiveMigration, "pending");
  assert.ok(report.blockers.includes("ADDITIVE_MIGRATION_PENDING"));
  assert.equal(f.writes(), 0);
});
test("dry-run identifies email mismatch, provider collisions and concurrent changes without repairs", async () => {
  const f = fixture({ wrongEmail: true, providerConflict: true, concurrentChange: true });
  const report = await migrationReport(f.db, f.provider);
  assert.equal(report.target.identityMatches, false);
  assert.equal(report.preservation.unchanged, false);
  for (const blocker of ["TARGET_ID_EMAIL_MISMATCH", "EXISTING_SUPABASE_IDENTITY_REQUIRES_REVIEW", "CONCURRENT_DATABASE_CHANGE_DETECTED"])
    assert.ok(report.blockers.includes(blocker));
  assert.equal(f.writes(), 0);
});
