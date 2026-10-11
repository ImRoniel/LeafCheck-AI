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
// Exercise the actual StartupTree hooks across renders without real-time sleeps.
function startupHarness(intro: ReturnType<typeof createIntroStore>) {
  let ready = false;
  let status = 'restoring';
  let callback: (() => void) | undefined;
  let schedules = 0, clears = 0;
  let hook = 0;
  const dependencies: (readonly unknown[])[] = [];
  const cleanups: (() => void)[] = [];
  const pending: (() => void)[] = [];
  const setReady = (value: boolean) => { ready = value; };
  const react = {
    ...React,
    useState: () => [ready, setReady],
    useEffect(effect: () => void | (() => void), deps: readonly unknown[]) {
      const index = hook++;
      const previous = dependencies[index];
      if (!previous || deps.some((value, i) => !Object.is(value, previous[i]))) {
        dependencies[index] = deps;
        pending.push(() => { cleanups[index]?.(); const cleanup = effect(); cleanups[index] = cleanup || (() => {}); });
      }
    },
  };
  return {
    setStatus(value: string) { status = value; },
    render() {
      hook = 0;
      const root = introRoot(intro.snapshot(), status, {
        react,
        '@/context/install-onboarding': { InstallOnboardingProvider: 'IntroProvider', useInstallOnboarding: () => ({ ...intro.snapshot(), finishSplash: intro.finishSplash }) },
      }, [], {
        setTimeout(work: () => void, delay: number) { assert.equal(delay, 2000); schedules++; callback = work; return 1; },
        clearTimeout(id: number) { assert.equal(id, 1); clears++; },
      });
      pending.splice(0).forEach(effect => effect());
      return root;
    },
    elapse() { assert.ok(callback); callback(); },
    unmount() { cleanups.forEach(cleanup => cleanup()); },
    schedules: () => schedules,
    clears: () => clears,
  };
}
test('every startup keeps branded splash for the minimum and waits for relevant checks', async () => {
  for (const raw of [null, 'false', 'true']) {
    let release: ((value: string | null) => void) | undefined;
    const store = createIntroStore({ read: () => new Promise(resolve => { release = resolve; }), async write() {} });
    const loading = store.load(); await Promise.resolve();
    const app = startupHarness(store);
    assert.equal(app.render().type, 'Splash');
    app.setStatus('authenticated'); assert.equal(app.render().type, 'Splash');
    assert.equal(app.schedules(), 1);
    app.elapse(); assert.equal(app.render().type, 'Splash'); // Slow flag read.
    assert.ok(release); release(raw); await loading;
    app.setStatus('restoring'); app.render();
    if (raw === 'true') {
      assert.equal(app.render().type, 'Splash'); // Completed flag still waits for auth.
      app.setStatus('authenticated'); assert.notEqual(app.render().type, 'Splash');
    } else {
      assert.equal(store.snapshot().phase, 'intro');
      assert.deepEqual(guardedScreens(app.render()), ['onboarding']); // Auth need not block slides.
      await store.complete(); assert.equal(app.render().type, 'Splash');
      app.setStatus('signedOut'); assert.notEqual(app.render().type, 'Splash');
    }
    assert.equal(app.schedules(), 1);
    app.unmount(); assert.equal(app.clears(), 1);
  }
});
test('fast returning-session checks cannot skip splash; errors recover after minimum', async () => {
  for (const raw of ['true', 'false', 'null', '{']) {
    const store = createIntroStore({ async read() { return raw; }, async write() {} });
    await store.load();
    const app = startupHarness(store); app.setStatus('signedOut');
    assert.equal(app.render().type, 'Splash');
    app.elapse(); const root = app.render();
    if (raw === 'true') assert.notEqual(root.type, 'Splash');
    else if (raw === 'false') { assert.equal(store.snapshot().phase, 'intro'); assert.deepEqual(guardedScreens(app.render()), ['onboarding']); }
    else assert.equal(root.props.title, 'Introductory setup unavailable');
    app.unmount(); assert.equal(app.clears(), 1);
  }
});
test('unmount clears the startup timer before it has fired', async () => {
  const store = createIntroStore({ async read() { return null; }, async write() {} });
  const app = startupHarness(store); assert.equal(app.render().type, 'Splash');
  app.unmount(); assert.equal(app.clears(), 1);
  assert.equal(store.snapshot().phase, 'loading');
});
