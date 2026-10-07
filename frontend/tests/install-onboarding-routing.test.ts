import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync } from 'node:fs';
import * as React from 'react';
import { loadComponent, nodes } from './startup-test-helpers';
import { createIntroStore } from '../services/install-onboarding-store';
import { introRoot, guardedScreens } from './install-onboarding-test-helpers';
type Element = React.ReactElement<{ saving?: boolean; onLetsGo?: () => void }>;
test('fresh install only admits splash then intro for every authentication outcome and deep-link target', () => {
  for (const status of ['anonymous', 'restoring', 'authenticated', 'error', 'guest']) {
    for (const phase of ['splash', 'intro'] as const) {
      const root = introRoot({ phase, saving: false, error: null }, status);
      assert.deepEqual(guardedScreens(root), [phase === 'intro' ? 'onboarding' : 'splash']);
      for (const forbidden of ['login', '(tabs)', 'setup', 'terms', 'plant-profile']) assert.ok(!guardedScreens(root).includes(forbidden));
    }
  }
});
test('bootstrap loading and storage errors cannot mount account navigation', () => {
  assert.equal(introRoot({ phase: 'loading', saving: false, error: null }, 'authenticated').type, 'Splash');
  const failed = introRoot({ phase: 'error', saving: false, error: 'Retry' }, 'authenticated');
  assert.equal(failed.props.title, 'Introductory setup unavailable');
  assert.equal(guardedScreens(failed).length, 0);
});
test('restore completion cannot change intro guards before a durable final action', async () => {
  let release: (() => void) | undefined;
  const store = createIntroStore({ async read() { return null; }, async write() { await new Promise<void>(resolve => { release = resolve; }); } });
  await store.load(); store.finishSplash();
  const saving = store.complete();
  assert.deepEqual(guardedScreens(introRoot(store.snapshot(), 'restoring')), ['onboarding']);
  assert.deepEqual(guardedScreens(introRoot(store.snapshot(), 'authenticated')), ['onboarding']);
  await Promise.resolve(); assert.ok(release); release(); assert.equal(await saving, true);
  assert.equal(store.snapshot().phase, 'completed');
});
test('splash timer advances install state rather than navigating around auth guards', () => {
  const effects: (() => void)[] = []; let finished = 0;
  const Splash = loadComponent('app/splash.tsx', {
    '@/components/leaf-check-logo': { LeafCheckLogo: 'Logo' },
    '@/context/install-onboarding': { useInstallOnboarding: () => ({ phase: 'loading', finishSplash: () => finished++ }) },
    'react-native': { View: 'View', StyleSheet: { create: (value: unknown) => value } },
  }, effects);
  Splash(); effects.forEach(effect => effect()); assert.equal(finished, 0);
});
test('onboarding final action saves without navigating to login or marking garden setup', async () => {
  const effects: (() => void)[] = []; let saves = 0;
  const Onboarding = loadComponent('app/onboarding.tsx', {
    react: { useState: () => [2, () => {}] },
    '@/components/onboarding-slider': { OnboardingSlider: 'Slider' },
    '@/components/screen': { Notice: 'Notice' },
    '@/context/install-onboarding': { useInstallOnboarding: () => ({ saving: true, error: null, complete: async () => { saves++; return true; } }) },
    'react-native': { View: 'View', StyleSheet: { create: (value: unknown) => value } },
  }, effects);
  const slider = nodes(Onboarding()).find(n => n.type === 'Slider') as Element | undefined;
  assert.ok(slider); assert.equal(slider.props.saving, true); slider.props.onLetsGo?.();
  await Promise.resolve(); assert.equal(saves, 1);
});

// All file-system routes must be declared, otherwise Expo Router auto-adds them.
test('all root routes are explicitly guarded, including forbidden deep-link destinations', () => {
  const routeNames = readdirSync(new URL('../app', import.meta.url), { withFileTypes: true })
    .filter(entry => entry.name !== '_layout.tsx')
    .map(entry => entry.isDirectory() ? entry.name : entry.name.replace(/\.tsx$/, ''));
  for (const phase of ['splash', 'intro'] as const) {
    const root = introRoot({ phase, saving: false, error: null }, 'authenticated');
    const declared = nodes(root).map(node => node.props.name).filter(Boolean);
    for (const route of routeNames) assert.ok(declared.includes(route), `${route} missing from intro guards`);
  }
});
test('splash waits two seconds after marker bootstrap and clears its timer', () => {
  let callback: (() => void) | undefined; let cleared = false; let finished = 0;
  const effects: (() => void)[] = [];
  const Splash = loadComponent('app/splash.tsx', {
    '@/components/leaf-check-logo': { LeafCheckLogo: 'Logo' },
    '@/context/install-onboarding': { useInstallOnboarding: () => ({ phase: 'splash', finishSplash: () => finished++ }) },
    'react-native': { View: 'View', StyleSheet: { create: (value: unknown) => value } },
  }, effects, { setTimeout: (work: () => void, delay: number) => { assert.equal(delay, 2000); callback = work; return 1; }, clearTimeout: (id: number) => { assert.equal(id, 1); cleared = true; } });
  Splash(); const cleanup: unknown = effects[0](); assert.equal(finished, 0);
  assert.ok(callback); callback(); assert.equal(finished, 1);
  assert.equal(typeof cleanup, 'function'); (cleanup as () => void)(); assert.equal(cleared, true);
});
