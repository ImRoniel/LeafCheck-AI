import assert from 'node:assert/strict';
import test from 'node:test';
import { rootRoute, loadComponent, available } from './startup-test-helpers';
test('completed installations exclude introductory routes for authenticated sessions', () => {
  assert.deepEqual(available(rootRoute({ status: 'authenticated' }).route), ['setup', '(tabs)', 'profile', 'device-connection', 'plant-profile', 'settings', 'archives', 'modal']);
});
test('anonymous, pending setup, completed and skipped setup retain route guards', () => {
  assert.ok(available(rootRoute({ status: 'anonymous' }).route).includes('login'));
  for (const status of ['pending', 'completed', 'skipped']) {
    const routes = available(rootRoute({ status: 'authenticated' }, { ready: true, error: null, data: { onboarding: { status } } }).route);
    assert.equal(routes.includes('setup'), true);
    assert.equal(routes.includes('(tabs)'), true);
  }
});
test('restore and local failures expose recovery before account routes', () => {
  assert.equal(rootRoute({ status: 'restoring', isLoading: true }).route.type, 'Splash');
  assert.equal(rootRoute({ status: 'error' }).route.props.title, 'Session unavailable');
  assert.equal(rootRoute({ status: 'authenticated' }, { ready: false, error: null, data: { onboarding: { status: 'pending' } } }).route.props.title, 'Restoring your garden');
  assert.equal(rootRoute({ status: 'authenticated' }, { ready: false, error: 'unavailable', data: { onboarding: { status: 'pending' } } }).route.props.title, 'Local setup unavailable');
});
test('guest navigation waits for readiness and reduced motion disables transitions', () => {
  const guest = rootRoute({ status: 'guest', isGuest: true });
  guest.effects.forEach(effect => effect());
  assert.deepEqual(guest.replacements, ['/(tabs)']);
  const loading = rootRoute({ status: 'guest', isGuest: true }, { ready: false, error: null, data: { onboarding: { status: 'pending' } } });
  loading.effects.forEach(effect => effect());
  assert.deepEqual(loading.replacements, []);
  assert.equal(rootRoute({ status: 'authenticated' }, undefined, true).route.props.screenOptions?.animation, 'none');
});
test('saved setup step redirects mismatched deep links', () => {
  const Layout = loadComponent('app/setup/_layout.tsx', { '@/context/local-state': { useLocalState: () => ({ data: { onboarding: { step: 'care' } } }) }, 'expo-router': { Redirect: 'Redirect', Slot: 'Slot', usePathname: () => '/setup/space' } });
  assert.equal(Layout().props.href, '/setup/care');
});
