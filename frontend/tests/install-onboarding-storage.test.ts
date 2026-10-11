import assert from 'node:assert/strict';
import test from 'node:test';
import { createIntroStore, parseIntroRecord, type IntroStorage } from '../services/install-onboarding-store';
function memory() {
  let raw: string | null = null;
  let failRead = false, failWrite = false;
  const storage: IntroStorage = { async read() { if (failRead) throw new Error('private read details'); return raw; }, async write(value) { if (failWrite) throw new Error('private write details'); raw = value; } };
  return { storage, setRaw: (value: string) => { raw = value; }, readFailure: (value: boolean) => { failRead = value; }, writeFailure: (value: boolean) => { failWrite = value; } };
}
test('missing marker starts splash, persists completion and reloads without repeating intro', async () => {
  const disk = memory(); const store = createIntroStore(disk.storage);
  await store.load(); assert.equal(store.snapshot().phase, 'splash');
  assert.equal(await store.complete(), false);
  store.finishSplash(); assert.equal(store.snapshot().phase, 'intro');
  assert.equal(await store.complete(), true);
  const reload = createIntroStore(disk.storage); await reload.load();
  assert.equal(reload.snapshot().phase, 'completed');
  await store.load(); assert.equal(store.snapshot().phase, 'completed');
});
test('strict records reject malformed, unsupported and unexpected fields without overwriting', async () => {
  for (const value of ['{', 'null', '[]', '{"version":2,"completed":true}', '{"version":1,"completed":false}', '{"version":true,"completed":true}', '{"version":1,"completed":true,"token":"fixture"}']) {
    assert.throws(() => parseIntroRecord(value));
    const disk = memory(); disk.setRaw(value); const store = createIntroStore(disk.storage);
    await store.load(); assert.equal(store.snapshot().phase, 'error');
    assert.equal(await disk.storage.read(), value); assert.equal(await store.complete(), false);
  }
});
test('read and write failures expose generic recovery and preserve incomplete state', async () => {
  const disk = memory(); disk.readFailure(true); const store = createIntroStore(disk.storage);
  await store.load(); assert.equal(store.snapshot().phase, 'error'); assert.ok(!store.snapshot().error?.includes('private'));
  disk.readFailure(false); await store.load(); store.finishSplash();
  disk.writeFailure(true); assert.equal(await store.complete(), false);
  assert.equal(store.snapshot().phase, 'intro'); assert.equal(store.snapshot().saving, false);
  assert.equal(await disk.storage.read(), null);
  disk.writeFailure(false); assert.equal(await store.complete(), true);
});
test('concurrent loads and final taps coalesce; listeners observe completion only after durable write', async () => {
  let release: (() => void) | undefined; let writes = 0; let reads = 0;
  const store = createIntroStore({ async read() { reads++; return null; }, async write() { writes++; await new Promise<void>(resolve => { release = resolve; }); } });
  const snapshots: string[] = []; const stop = store.subscribe(() => snapshots.push(store.snapshot().phase));
  await Promise.all([store.load(), store.load()]); assert.equal(reads, 1); store.finishSplash();
  const first = store.complete(), second = store.complete(); assert.equal(first, second);
  await Promise.resolve(); assert.equal(writes, 1); assert.equal(store.snapshot().phase, 'intro'); assert.equal(store.snapshot().saving, true);
  assert.ok(release); release(); await first;
  assert.equal(snapshots.at(-1), 'completed'); stop();
});

test('synchronously throwing platform methods remain retryable', async () => {
  let failRead = true, failWrite = true;
  const store = createIntroStore({ read() { if (failRead) throw new Error('read'); return Promise.resolve(null); }, write() { if (failWrite) throw new Error('write'); return Promise.resolve(); } });
  await store.load(); assert.equal(store.snapshot().phase, 'error');
  failRead = false; await store.load(); assert.equal(store.snapshot().phase, 'splash'); store.finishSplash();
  assert.equal(await store.complete(), false); failWrite = false;
  assert.equal(await store.complete(), true);
});

 test('boolean flags accept only true and false; missing is incomplete', () => {
  assert.equal(parseIntroRecord(null), false);
  assert.equal(parseIntroRecord('false'), false);
  assert.equal(parseIntroRecord('true'), true);
  for (const raw of ['0', '1', '"true"', '{}', ' '.repeat(129)]) assert.throws(() => parseIntroRecord(raw));
});
