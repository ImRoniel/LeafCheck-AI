# Recover a partial demo-account auth migration

`auth:migration:apply` never adopts an existing unlinked Supabase account, even if
an earlier import created it. Successful, fully linked migrations are read-only
no-ops on subsequent runs. A failed apply prints `RECOVERY_REQUIRED` with the
checkpoint, intended Supabase UUID, and exact fields to link after review.

1. Save the printed checkpoint JSON outside Render's ephemeral filesystem. It
   contains row IDs/fingerprints, not password hashes or keys. The on-disk file is
   created with mode `0600` before the provider request and updated atomically.
2. In the checkpoint's Supabase project, find its exact `supabaseUserId` under
   **Authentication > Users**. Verify `cuaresmaroniel27@gmail.com`, confirmed
   email, and `app_metadata.leafcheck_migration_user_id` equal to
   `2da2cd1a-e594-43cc-a165-552342882246`. Never substitute another account found
   by email. A `prepared` checkpoint can mean the create response was lost;
   inspect the provider before assuming no account was created. Keep the provider
   account; do not delete/recreate it or repeat password import.
3. Run the dry-run again. Its existing-identity blocker is expected for this
   partial state; any other blocker requires investigation first.
4. After reviewing the checkpoint and verifying the provider identity above,
   perform only the guarded link below from the `backend` directory. This is a
   separate, deliberate manual recovery operation, not an automatic apply retry.
   Set `AUTH_MIGRATION_CHECKPOINT` to the saved checkpoint's absolute path.

```bash
AUTH_MIGRATION_CHECKPOINT=/absolute/path/to/checkpoint.json \
node --import tsx/esm --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import './src/lib/env.ts';
import { PrismaClient } from './src/generated/postgres-client/index.js';
import { authRead } from './src/lib/prisma-auth-read.ts';
import { migrationDigest, migrationReport, migrationSnapshot, target } from './scripts/auth-migration-dry-run.mjs';
import { preservationManifest } from './scripts/auth-migration-apply.mjs';

const checkpoint = JSON.parse(await readFile(process.env.AUTH_MIGRATION_CHECKPOINT, 'utf8'));
assert.equal(checkpoint.version, 1);
assert.equal(checkpoint.userId, target.id);
assert.equal(checkpoint.email, target.email);
assert.equal(checkpoint.project, new URL(process.env.SUPABASE_URL).origin);
const db = new PrismaClient({ log: [] });
try {
  const report = await migrationReport(db, authRead);
  assert.ok(report.blockers.every(code => code === 'EXISTING_SUPABASE_IDENTITY_REQUIRES_REVIEW'));
  const accounts = await authRead.usersByEmail(target.email);
  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].id, checkpoint.supabaseUserId);
  assert.ok(accounts[0].emailConfirmedAt);
  await db.$transaction(async tx => {
    const before = await migrationSnapshot(tx);
    assert.equal(before.user.id, target.id);
    assert.equal(before.user.email, target.email);
    assert.equal(before.user.isActive, true);
    assert.equal(migrationDigest(preservationManifest(before)), migrationDigest(checkpoint.before));
    const mapping = await tx.user.findUnique({ where: { id: target.id }, select: { supabaseUserId: true, emailVerifiedAt: true } });
    if (mapping.supabaseUserId === checkpoint.supabaseUserId && mapping.emailVerifiedAt) return;
    assert.equal(mapping.supabaseUserId, null);
    const changed = await tx.user.updateMany({
      where: { id: target.id, email: target.email, supabaseUserId: null, isActive: true,
        password: before.user.password, updatedAt: before.user.updatedAt },
      data: { supabaseUserId: checkpoint.supabaseUserId, emailVerifiedAt: new Date() },
    });
    assert.equal(changed.count, 1);
    assert.equal(migrationDigest(preservationManifest(await migrationSnapshot(tx))), migrationDigest(checkpoint.before));
  }, { isolationLevel: 'Serializable', maxWait: 5000, timeout: 15000 });
  console.log('Existing User linked; User.id, legacy hash, role, domain data and legacy sessions preserved.');
} catch {
  console.error('Recovery stopped. Inspect the checkpoint and preservation manifest; no provider user was deleted.');
  process.exitCode = 1;
} finally {
  await Promise.all([db.$disconnect(), authRead.disconnect()]);
}
NODE
```

5. Re-run the original apply command with the same confirmation. It must print
   `ALREADY_MIGRATED` with zero application/provider writes. If it instead reports
   a blocker, stop and inspect it. Do not change `AUTH_PROVIDER` as part of
   recovery. Apply does not delete any legacy sessions or refresh tokens.

If no intended provider UUID exists after an uncertain response, investigate the
provider request outcome before choosing a new checkpoint path and retrying.
The existing checkpoint is deliberately never overwritten for another import.
