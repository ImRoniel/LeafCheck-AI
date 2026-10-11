import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { createIntroStore, type IntroStorage } from '../services/install-onboarding-store';

interface AsyncAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}
function adapter(storage: AsyncAdapter): IntroStorage {
  const exports: { introStorage?: IntroStorage } = {};
  const source = readFileSync(new URL('../services/install-onboarding-storage.ts', import.meta.url), 'utf8');
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports,
    require(name: string) {
      // Any native loader, credentials or runtime selector import fails this fixture.
      assert.equal(name, '@react-native-async-storage/async-storage');
      return { __esModule: true, default: storage };
    },
  });
  assert.ok(exports.introStorage);
  return exports.introStorage;
}
const key = '@leafcheck_onboarding_complete';
test('one shared adapter ignores legacy keys and writes a durable boolean only', async () => {
  const values = new Map<string, string>([
    ['leafcheck.install-intro.v1', '{"version":1,"completed":true}'],
    ['leafcheck.expo-go.install-intro.v1', '{"version":1,"completed":true}'],
    ['leafcheck.refresh.v1', 'credential-fixture'],
    ['garden-fixture', 'untouched'],
  ]);
  const original = new Map(values);
  const reads: string[] = [];
  const writes: [string, string][] = [];
  const storage = adapter({
    async getItem(name) { reads.push(name); return values.get(name) ?? null; },
    async setItem(name, value) { writes.push([name, value]); values.set(name, value); },
  });
  for (const raw of [null, 'false']) {
    if (raw === null) values.delete(key); else values.set(key, raw);
    const store = createIntroStore(storage);
    await store.load(); assert.equal(store.snapshot().phase, 'splash');
    assert.equal(writes.length, 0);
  }
  const store = createIntroStore(storage); await store.load(); store.finishSplash();
  assert.equal(await store.complete(), true);
  assert.deepEqual(writes, [[key, 'true']]);
  const reload = createIntroStore(storage); await reload.load();
  assert.equal(reload.snapshot().phase, 'completed');
  await reload.complete(); await reload.load();
  assert.equal(writes.length, 1);
  assert.ok(reads.every(name => name === key));
  for (const [name, value] of original) assert.equal(values.get(name), value);
});
test('shared adapter failures and invalid booleans remain recoverable without overwrites', async () => {
  for (const synchronous of [false, true]) {
    let failRead = true, failWrite = true;
    let raw: string | null = null;
    let writes = 0;
    const storage = adapter({
      getItem() {
        if (failRead) {
          if (synchronous) throw new Error('private storage failure');
          return Promise.reject(new Error('private storage failure'));
        }
        return Promise.resolve(raw);
      },
      setItem(_key, value) {
        writes++;
        if (failWrite) {
          if (synchronous) throw new Error('private write failure');
          return Promise.reject(new Error('private write failure'));
        }
        raw = value; return Promise.resolve();
      },
    });
    const store = createIntroStore(storage);
    await store.load(); assert.equal(store.snapshot().phase, 'error');
    assert.ok(!store.snapshot().error?.includes('private'));
    failRead = false; raw = '{"version":1,"completed":true}';
    await store.load(); assert.equal(store.snapshot().phase, 'error'); assert.equal(writes, 0);
    raw = null; await store.load(); store.finishSplash();
    assert.equal(await store.complete(), false); assert.equal(raw, null);
    assert.equal(store.snapshot().phase, 'intro');
    failWrite = false; assert.equal(await store.complete(), true); assert.equal(raw, 'true');
  }
});
