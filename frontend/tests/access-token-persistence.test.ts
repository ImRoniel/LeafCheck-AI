import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionCoordinator, type TokenStorage } from '../services/session';
function fixture(access: string | null = null, refresh: string | null = null) {
  let savedAccess = access;
  let savedRefresh: string | null = refresh;
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
test('login keeps access in memory, persists only refresh, and removes old access credentials', async () => {
  const f = fixture('obsolete-persisted-access');
  f.accessStorage.get = async () => { throw new Error('Access tokens must never be read'); };
  f.accessStorage.set = async () => { throw new Error('Access tokens must never be persisted'); };
  await f.session.login({ email: 'fixture@example.test', password: 'fixture' });
  assert.equal(f.access(), null);
  assert.equal(f.session.snapshot().token, 'access-fixture');
  assert.equal(f.refresh(), 'refresh-fixture');
  assert.equal(f.session.snapshot().status, 'authenticated');
  await f.session.logout();
  assert.equal(f.access(), null);
  assert.equal(f.refresh(), null);
  assert.equal(f.session.snapshot().status, 'signedOut');
});
test('startup ignores persisted access and rotates the SecureStore refresh credential', async () => {
  const f = fixture('stored-access-fixture', 'surviving-refresh');
  f.accessStorage.get = async () => { throw new Error('Must not read persisted access'); };
  await f.session.restore();
  assert.equal(f.session.snapshot().token, 'access-fixture');
  assert.equal(f.access(), null);
  assert.equal(f.session.snapshot().status, 'authenticated');
  assert.equal(f.refreshes(), 1);
});
test('failure to remove an obsolete persisted access token prevents authentication', async () => {
  const f = fixture('old-access');
  f.accessStorage.remove = async () => { throw new Error('storage denied'); };
  await assert.rejects(f.session.login({ email: 'fixture@example.test', password: 'fixture' }));
  assert.equal(f.session.snapshot().status, 'signedOut');
  assert.equal(f.session.snapshot().token, null);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(f.refresh(), null);
});

test('a cold start restores from refresh with no persisted access token', async () => {
  const f = fixture();
  await f.session.login({ email: 'fixture@example.test', password: 'fixture' });
  await f.accessStorage.remove();
  // A new coordinator simulates a cold start with the surviving refresh credential.
  const session = createSessionCoordinator({
    async get() { return f.refresh(); }, async set() {}, async remove() {},
  }, true, { run: work => work(), broadcastLogout() {}, listenLogout: () => () => {} }, f.accessStorage);
  session.bind({
    async refresh(body) {
      assert.equal(body.refreshToken, 'refresh-fixture');
      return { accessToken: 'new-memory-token', refreshToken: 'rotated-refresh' };
    },
    async me() { return { id: 'fixture', email: 'fixture@example.test', name: null }; },
    async login() { throw new Error('Unexpected login'); },
    async register() { throw new Error('Unexpected register'); },
    async logout() {},
  });
  await session.restore();
  assert.equal(session.snapshot().status, 'authenticated');
  assert.equal(session.snapshot().token, 'new-memory-token');
  assert.equal(f.access(), null);
});

test('a persisted access token alone cannot restore a session', async () => {
  const f = fixture('obsolete-token');
  await f.session.restore();
  assert.equal(f.session.snapshot().status, 'signedOut');
  assert.equal(f.session.snapshot().token, null);
  assert.equal(f.refreshes(), 0);
  assert.equal(f.access(), null);
});
