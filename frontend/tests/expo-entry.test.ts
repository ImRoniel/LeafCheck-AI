import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
const requireModule = createRequire(import.meta.url);
const { getConfig } = requireModule('@expo/config') as {
  getConfig(root: string): { exp: unknown };
};
const { resolveEntryPoint } = requireModule('@expo/config/paths') as {
  resolveEntryPoint(root: string, options: { platform: string }): string;
};
function validateAssets(root: string, value: unknown): void {
  if (typeof value === 'string' && value.startsWith('./') && value.includes('/assets/')) {
    assert.ok(existsSync(path.resolve(root, value)), `Missing Expo asset: ${value}`);
  } else if (Array.isArray(value)) {
    value.forEach(entry => validateAssets(root, entry));
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach(entry => validateAssets(root, entry));
  }
}
for (const relative of ['.', '..']) {
  test(`Expo launches from ${relative} resolve Router and existing assets`, () => {
    const root = path.resolve(relative);
    for (const platform of ['android', 'ios']) {
      assert.match(resolveEntryPoint(root, { platform }), /expo-router[/\\]entry\.js$/);
    }
    validateAssets(root, getConfig(root).exp);
    const app = path.resolve(root, relative === '.' ? 'app' : 'frontend/app');
    for (const route of ['_layout.tsx', 'index.tsx', '(auth)/login.tsx', 'onboarding.tsx']) {
      assert.ok(existsSync(path.join(app, route)), `Missing route: ${route}`);
    }
  });
}
