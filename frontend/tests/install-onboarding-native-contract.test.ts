import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import type { IntroStorage } from '../services/install-onboarding-store';
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
function adapter(path: string, overrides: Record<string, unknown>, localStorage?: unknown): IntroStorage {
  const exports: { introStorage?: IntroStorage } = {};
  runInNewContext(ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, require: (key: string) => { assert.ok(key in overrides); return overrides[key]; }, localStorage });
  assert.ok(exports.introStorage); return exports.introStorage;
}
test('native adapter reports missing binary and dispatches only to local module', async () => {
  const missing = adapter('services/install-onboarding-storage.native.ts', { 'expo-modules-core': { requireOptionalNativeModule: () => null } });
  await assert.rejects(async () => missing.read()); await assert.rejects(async () => missing.write('{}'));
  const calls: string[] = [];
  const storage = adapter('services/install-onboarding-storage.native.ts', { 'expo-modules-core': { requireOptionalNativeModule: (name: string) => { assert.equal(name, 'InstallOnboarding'); return { async read() { calls.push('read'); return null; }, async write(record: string) { calls.push(record); } }; } } });
  assert.equal(await storage.read(), null); await storage.write('completion'); assert.deepEqual(calls, ['read', 'completion']);
});
test('browser adapter persists distinct non-secret key and propagates storage denial', async () => {
  const values = new Map<string, string>();
  const storage = adapter('services/install-onboarding-storage.ts', {}, { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
  assert.equal(await storage.read(), null); await storage.write('done'); assert.equal(await storage.read(), 'done');
  assert.deepEqual([...values.keys()], ['leafcheck.install-intro.v1']);
  const denied = adapter('services/install-onboarding-storage.ts', {}, { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } });
  await assert.rejects(denied.read()); await assert.rejects(denied.write('done'));
});
test('static native contracts retain backup exclusion, atomic writes and credential isolation', () => {
  const swift = read('modules/install-onboarding/ios/InstallOnboardingModule.swift');
  const kotlin = read('modules/install-onboarding/android/src/main/java/expo/modules/installonboarding/InstallOnboardingModule.kt');
  assert.match(swift, /applicationSupportDirectory/); assert.match(swift, /isExcludedFromBackup = true/); assert.match(swift, /resourceValues\(forKeys:/); assert.match(swift, /options: \.atomic/); assert.match(swift, /handle.synchronize\(\)/);
  assert.match(kotlin, /context.noBackupFilesDir/); assert.match(kotlin, /AtomicFile/); assert.match(kotlin, /file.finishWrite/); assert.match(kotlin, /file.failWrite/);
  assert.doesNotMatch(swift + kotlin, /kSecAttrSynchronizable|SecureStore|refreshToken/);
  const config = JSON.parse(read('modules/install-onboarding/expo-module.config.json')) as { apple: { modules: string[] }; android: { modules: string[] } };
  assert.ok(config.apple.modules.includes('InstallOnboardingModule')); assert.ok(config.android.modules.includes('expo.modules.installonboarding.InstallOnboardingModule'));
  const token = read('services/token-storage.native.ts');
  assert.match(token, /WHEN_UNLOCKED_THIS_DEVICE_ONLY/); assert.match(token, /leafcheck.refresh.v1/); assert.doesNotMatch(token, /keychainService|accessGroup/);
  const app = JSON.parse(read('app.json')) as { expo: { plugins: unknown[] } };
  assert.ok(app.expo.plugins.some(plugin => Array.isArray(plugin) && plugin[0] === 'expo-secure-store' && plugin[1].configureAndroidBackup === true));
});
