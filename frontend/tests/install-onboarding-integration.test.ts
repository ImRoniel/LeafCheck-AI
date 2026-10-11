import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
import { createIntroStore } from '../services/install-onboarding-store';
import { introRoot, guardedScreens } from './install-onboarding-test-helpers';
import { loadComponent, nodes, rootRoute, available } from './startup-test-helpers';
type Props = { children?: React.ReactNode; href?: string; currentSlide?: number; saving?: boolean; onGetStarted?: () => void; onNext?: () => void; onLetsGo?: () => void };
function entry(store: ReturnType<typeof createIntroStore>, status: string, setup = 'completed') {
  const Entry = loadComponent('app/index.tsx', {
    '@/context/install-onboarding': { useInstallOnboarding: store.snapshot },
    '@/context/auth': { useAuth: () => ({ status, isLoading: status === 'restoring', isGuest: status === 'guest' }) },
    '@/context/local-state': { useLocalState: () => ({ data: { onboarding: { status: setup } } }) },
    'expo-router': { Redirect: 'Redirect' },
  });
  let element = Entry() as React.ReactElement<Props> | null;
  if (element && typeof element.type === 'function') element = (element.type as () => React.ReactElement<Props>)();
  return element?.props.href ?? null;
}
function slides(store: ReturnType<typeof createIntroStore>) {
  let currentSlide = 0;
  const Onboarding = loadComponent('app/onboarding.tsx', {
    react: { useState: () => [currentSlide, (next: number) => { currentSlide = next; }] },
    '@/context/install-onboarding': { useInstallOnboarding: () => ({ ...store.snapshot(), complete: store.complete }) },
    '@/components/onboarding-slider': { OnboardingSlider: 'Slider' },
    '@/components/screen': { Notice: 'Notice' },
    'react-native': { View: 'View', StyleSheet: { create: (value: unknown) => value } },
  });
  return () => {
    const slider = nodes(Onboarding()).find(node => node.type === 'Slider') as React.ReactElement<Props> | undefined;
    assert.ok(slider); return slider;
  };
}
test('fresh anonymous and restored sessions traverse every slide and skip only the correct login', async () => {
  for (const status of ['anonymous', 'authenticated', 'guest', 'error', 'restoring']) {
    let saved: string | null = null;
    const disk = { async read() { return saved; }, async write(value: string) { saved = value; } };
    const store = createIntroStore(disk); await store.load();
    assert.equal(entry(store, status), '/splash');
    assert.deepEqual(guardedScreens(introRoot(store.snapshot(), status)), ['splash']);
    store.finishSplash(); assert.equal(entry(store, status), '/onboarding');
    const render = slides(store);
    assert.equal(render().props.currentSlide, 0); render().props.onGetStarted?.();
    assert.equal(render().props.currentSlide, 1); render().props.onNext?.();
    assert.equal(render().props.currentSlide, 2); render().props.onLetsGo?.();
    await store.complete(); assert.equal(store.snapshot().phase, 'completed');
    assert.equal(entry(store, status), status === 'authenticated' ? '/(tabs)' : status === 'error' || status === 'restoring' ? null : '/(auth)/login');
    const reload = createIntroStore(disk); await reload.load();
    assert.equal(reload.snapshot().phase, 'completed');
    assert.equal(entry(reload, 'authenticated', 'pending'), '/(tabs)');
    assert.equal(entry(reload, 'authenticated', 'skipped'), '/(tabs)');
  }
});
test('restore finishing on a middle slide leaves the same slide and guest/account setup untouched', async () => {
  const store = createIntroStore({ async read() { return null; }, async write() {} });
  await store.load(); store.finishSplash();
  const render = slides(store); render().props.onGetStarted?.();
  assert.equal(render().props.currentSlide, 1);
  for (const auth of ['restoring', 'authenticated', 'guest', 'error']) {
    assert.deepEqual(guardedScreens(introRoot(store.snapshot(), auth)), ['onboarding']);
    assert.equal(render().props.currentSlide, 1);
  }
  render().props.onNext?.(); render().props.onLetsGo?.(); await store.complete();
  assert.ok(available(rootRoute({ status: 'authenticated' }, { ready: true, error: null, data: { onboarding: { status: 'pending' } } }).route).includes('setup'));
  assert.ok(!available(rootRoute({ status: 'guest', isGuest: true }).route).includes('(tabs)'));
});
test('final write denial keeps the last slide and its retry; completion waits for a replacement write', async () => {
  let denied = true; let release: (() => void) | undefined; let writes = 0;
  const store = createIntroStore({ async read() { return null; }, async write() { writes++; if (denied) throw new Error('denied'); await new Promise<void>(resolve => { release = resolve; }); } });
  await store.load(); store.finishSplash(); const render = slides(store);
  render().props.onGetStarted?.(); render().props.onNext?.(); render().props.onLetsGo?.();
  assert.equal(await store.complete(), false); assert.equal(render().props.currentSlide, 2); assert.ok(store.snapshot().error);
  assert.equal(entry(store, 'authenticated'), '/onboarding');
  denied = false; render().props.onLetsGo?.(); const retry = store.complete();
  await Promise.resolve(); assert.equal(writes, 2); assert.equal(render().props.saving, true);
  assert.equal(entry(store, 'authenticated'), '/onboarding');
  assert.ok(release); release(); assert.equal(await retry, true);
  assert.equal(entry(store, 'authenticated'), '/(tabs)');
});
test('corrupt/browser-denied storage cannot admit restored sessions and does not erase disk data', async () => {
  let denied = true; const corrupt = '{"version":99,"completed":true}'; let raw: string | null = corrupt; let writes = 0;
  const store = createIntroStore({ async read() { if (denied) throw new Error('denied browser storage'); return raw; }, async write() { writes++; } });
  await store.load(); assert.equal(store.snapshot().phase, 'error'); assert.equal(entry(store, 'authenticated'), null);
  denied = false; await store.load(); assert.equal(store.snapshot().phase, 'error'); assert.equal(raw, corrupt); assert.equal(writes, 0);
  // Simulate operator repair of the corrupt marker, not an application reset.
  raw = null; await store.load(); assert.equal(entry(store, 'authenticated'), '/splash');
});

test('completed intro routes by verified native restoration, not credential presence', async () => {
  const { createSessionCoordinator } = await import('../services/session');
  const { ApiError } = await import('../services/errors');
  for (const credential of [null, 'rejected-fixture', 'valid-fixture']) {
    let refreshed = 0;
    let stored = credential;
    const session = createSessionCoordinator({
      async get() { return stored; },
      async set(value) { stored = value; },
      async remove() { stored = null; },
    }, true, { run: work => work(), broadcastLogout() {}, listenLogout: () => () => {} });
    session.bind({
      async refresh() {
        refreshed++;
        if (credential !== 'valid-fixture') throw new ApiError('http', 'Rejected', 401);
        return { accessToken: 'memory-access-fixture', refreshToken: 'rotated-fixture' };
      },
      async me() { return { id: 'user-fixture', email: 'fixture@example.test', name: null }; },
      async login() { throw new Error('Unexpected login'); },
      async register() { throw new Error('Unexpected register'); },
      async logout() {},
    });
    let flag: string | null = 'true';
    const intro = createIntroStore({ async read() { return flag; }, async write(value) { flag = value; } });
    await intro.load();
    assert.equal(entry(intro, session.snapshot().status), null);
    await session.restore();
    assert.equal(entry(intro, session.snapshot().status, 'pending'), credential === 'valid-fixture' ? '/(tabs)' : '/(auth)/login');
    assert.equal(refreshed, credential === null ? 0 : 1);
    if (credential === 'valid-fixture') {
      await session.logout(); assert.equal(entry(intro, session.snapshot().status), '/(auth)/login');
      session.enterGuest(); assert.equal(entry(intro, session.snapshot().status), '/(auth)/login');
      session.leaveGuest(); assert.equal(entry(intro, session.snapshot().status), '/(auth)/login');
    }
    assert.equal(flag, 'true');
  }
});
