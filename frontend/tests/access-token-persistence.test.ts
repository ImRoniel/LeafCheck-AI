import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionCoordinator, type TokenStorage } from '../services/session';
function fixture(access: string | null = null) {
  let savedAccess = access;
  let savedRefresh: string | null = null;
  const accessStorage: TokenStorage = {
    async get() { return savedAccess; },
    async set(value) { savedAccess = value; },
    async remove() { savedAccess = null; },
  };
  const session = createSessionCoordinator({
    async get() { return savedRefresh; },
    async set(value) { savedRefresh = value; },
    async remove() { savedRefresh = null; },
  }, true, { run: work => work(), broadcastLogout() {}, listenLogout: () => () => {} }, accessStorage);
  let refreshes = 0;
  const tokens = { accessToken: 'access-fixture', refreshToken: 'refresh-fixture' };
  session.bind({
    async login() { return tokens; },
    async register() { return tokens; },
    async refresh() { refreshes++; return tokens; },
    async me() { return { id: 'fixture', email: 'fixture@example.test', name: null }; },
    async logout() {},
  });
  return { session, accessStorage, access: () => savedAccess, refresh: () => savedRefresh, refreshes: () => refreshes };
}
test('login persists the access token and logout removes both native credentials', async () => {
  const f = fixture();
  await f.session.login({ email: 'fixture@example.test', password: 'fixture' });
  assert.equal(f.access(), 'access-fixture');
  assert.equal(f.refresh(), 'refresh-fixture');
  assert.equal(f.session.snapshot().status, 'authenticated');
  await f.session.logout();
  assert.equal(f.access(), null);
  assert.equal(f.refresh(), null);
  assert.equal(f.session.snapshot().status, 'signedOut');
});
test('startup restores the stored access token into the API session', async () => {
  const f = fixture('stored-access-fixture');
  await f.session.restore();
  assert.equal(f.session.snapshot().token, 'stored-access-fixture');
  assert.equal(f.session.snapshot().status, 'authenticated');
  assert.equal(f.refreshes(), 0);
});
test('access-token persistence failure does not publish an authenticated session', async () => {
  const f = fixture();
  f.accessStorage.set = async () => { throw new Error('storage denied'); };
  await assert.rejects(f.session.login({ email: 'fixture@example.test', password: 'fixture' }));
  assert.equal(f.session.snapshot().status, 'signedOut');
  assert.equal(f.session.snapshot().token, null);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(f.refresh(), null);
});

test('missing access_token requires login even when a legacy refresh credential exists', async () => {
  const f = fixture();
  await f.session.login({ email: 'fixture@example.test', password: 'fixture' });
  await f.accessStorage.remove();
  // A new coordinator simulates a cold start with the surviving refresh credential.
  const session = createSessionCoordinator({
    async get() { return f.refresh(); }, async set() {}, async remove() {},
  }, true, { run: work => work(), broadcastLogout() {}, listenLogout: () => () => {} }, f.accessStorage);
  session.bind({
    async refresh() { throw new Error('Must not restore without access_token'); },
    async me() { throw new Error('Must not request a profile'); },
    async login() { throw new Error('Unexpected login'); },
    async register() { throw new Error('Unexpected register'); },
    async logout() {},
  });
  await session.restore();
  assert.equal(session.snapshot().status, 'signedOut');
  assert.equal(session.snapshot().token, null);
});
