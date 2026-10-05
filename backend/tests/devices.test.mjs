import express from 'express';
import assert from 'node:assert/strict';
import { after, before, mock, test } from 'node:test';
import { SignJWT } from 'jose';

let server, baseUrl, token, otherToken;
const rows = new Map();
const calls = [];
let raceOwner, storageFailure = false;
let findBarrier;
const secret = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLM';
const device = {
  findUnique: async ({where}) => {
    calls.push(['find', where]);
    const row = rows.get(where.macAddress) ?? null;
    if (findBarrier && !row) {
      const barrier = findBarrier;
      if (++barrier.arrivals === 2) { findBarrier = undefined; barrier.release(); }
      await barrier.ready;
    }
    return row;
  },
  create: async ({data}) => {
    calls.push(['create', data]);
    if (storageFailure) throw new Error('private storage details');
    if (rows.has(data.macAddress)) throw Object.assign(new Error('unique conflict'), {code:'P2002'});
    if (raceOwner) {
      rows.set(data.macAddress, {...data, userId: raceOwner, createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01')});
      throw Object.assign(new Error('unique conflict'), {code: 'P2002'});
    }
    const row = {...data, createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'), privateRelation: 'omit'};
    rows.set(data.macAddress, row); return row;
  },
  update: async ({where, data}) => {
    calls.push(['update', where, data]);
    const row = [...rows.values()].find(row => row.id === where.id && row.userId === where.userId);
    Object.assign(row, data); return row;
  },
};
before(async () => {
  Object.assign(process.env, { AUTH_JWT_SECRET: secret, AUTH_JWT_ISSUER: 'test', AUTH_JWT_AUDIENCE: 'test', AUTH_ALLOWED_ORIGINS: 'https://example.test', PORT: '0' });
  mock.module(new URL('../src/lib/prisma-pg.js', import.meta.url).href, {namedExports: {prismaPg: {
    device,
    authSession: {findUnique: async ({where}) => ({id: where.id, userId: where.id, user: {id: where.id, isActive: true}, expiresAt: new Date(Date.now() + 60000), revokedAt: null})},
  }}});
  for (const name of ['telemetry','plants','ai','scan','auth','users']) {
    mock.module(new URL(`../src/routes/${name}.js`, import.meta.url).href, {namedExports: {[`${name}Router`]: express.Router()}});
  }
  mock.module(new URL('../src/lib/provider-startup.js', import.meta.url).href, {namedExports: {}});
  mock.module(new URL('../src/lib/ttl.js', import.meta.url).href, {namedExports: {ensureTTLIndex: async () => {}}});
  const listen = express.application.listen;
  const intercept = mock.method(express.application, 'listen', function (...args) { server = listen.apply(this, args); return server; });
  await import('../src/server.ts'); intercept.mock.restore();
  if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const sign = user => new SignJWT({sid: user}).setProtectedHeader({alg:'HS256', typ:'JWT'}).setSubject(user).setIssuer('test').setAudience('test').setIssuedAt().setExpirationTime('15m').sign(new TextEncoder().encode(secret));
  token = await sign('owner'); otherToken = await sign('other');
});
after(async () => { if(server) await new Promise(resolve => server.close(resolve)); mock.restoreAll(); });
async function claim(body, auth = token) {
  const response = await fetch(`${baseUrl}/api/devices/claim`, {method:'POST', headers:{'Content-Type':'application/json', ...(auth ? {Authorization:`Bearer ${auth}`} : {})}, body:JSON.stringify(body)});
  return {status:response.status, body:await response.json()};
}
test('actual server mount requires authentication and rejects malformed bodies without writes', async () => {
  assert.equal((await claim({macAddress:'LC-A50528'}, null)).status,401);
  for (const body of [null, [], {}, {macAddress:'bad'}, {macAddress:' LC-A50528'}, {macAddress:'aa:bb-cc:dd:ee:ff'}, {macAddress:42}, {macAddress:'LC-A50528', userId:'other'}, ...[null,42,'','  ','x'.repeat(101)].map(name => ({macAddress:'LC-A50528',name}))]) {
    const result = await claim(body); assert.equal(result.status,400); assert.ok(['INVALID_INPUT','INVALID_JSON'].includes(result.body.code));
  }
  assert.equal(calls.length,0);
});
test('create normalizes supported addresses and exposes exactly the Device contract', async () => {
  for(const mac of ['lc-a50528','aa:bb:cc:dd:ee:ff','aa-bb-cc-dd-ee-ff']) {
    const result = await claim({macAddress:mac}); assert.equal(result.status,201);
    assert.match(result.body.id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.deepEqual(Object.keys(result.body).sort(), ['id','name','macAddress','userId','status','createdAt','updatedAt'].sort());
    assert.equal(result.body.macAddress,mac.toUpperCase()); assert.equal(result.body.name,mac.toUpperCase());
    assert.equal(result.body.userId,'owner'); assert.equal(result.body.status,'OFFLINE'); assert.equal(result.body.createdAt,'2026-01-01T00:00:00.000Z');
  }
});
test('owner reclaim preserves ID/name, trims supplied names, and denies foreign claim without mutation', async () => {
  const first = rows.get('LC-A50528');
  const rename = await claim({macAddress:'lc-a50528',name:'  Window  '});
  assert.equal(rename.status,200); assert.equal(rename.body.id,first.id); assert.equal(rename.body.name,'Window');
  assert.equal((await claim({macAddress:'LC-A50528'})).body.name,'Window');
  const writes = calls.filter(c => c[0] !== 'find').length;
  const denied = await claim({macAddress:'LC-A50528',name:'Stolen'},otherToken);
  assert.equal(denied.status,409); assert.equal(denied.body.code,'DEVICE_ALREADY_CLAIMED');
  assert.equal(first.name,'Window'); assert.equal(calls.filter(c => c[0] !== 'find').length,writes);
});
test('unique-constraint race re-reads winner and applies same-owner and foreign-owner rules', async () => {
  raceOwner='owner';
  const same = await claim({macAddress:'LC-000001',name:'  Race  '});
  assert.equal(same.status,200); assert.equal(same.body.name,'Race'); assert.equal(same.body.id,rows.get('LC-000001').id);
  raceOwner='other';
  const foreign = await claim({macAddress:'LC-000002',name:'Mine'});
  assert.equal(foreign.status,409); assert.equal(foreign.body.code,'DEVICE_ALREADY_CLAIMED'); assert.equal(rows.get('LC-000002').userId,'other');
  raceOwner=undefined;
});
test('unexpected storage failures are sanitized', async () => {
  storageFailure=true;
  assert.deepEqual(await claim({macAddress:'LC-000003'}), {status:500,body:{error:'Internal server error.',code:'INTERNAL_ERROR'}});
  storageFailure=false;
});

test('parallel claims yield one creation and an owner-appropriate conflict resolution', async () => {
  for (const [macAddress, secondAuth, expected] of [['LC-000010',token,200],['LC-000011',otherToken,409]]) {
    let release;
    const ready = new Promise(resolve => { release = resolve; });
    findBarrier = {arrivals:0,ready,release};
    const results = await Promise.all([claim({macAddress},token),claim({macAddress},secondAuth)]);
    assert.deepEqual(results.map(result => result.status).sort(),[201,expected].sort());
    const stored = rows.get(macAddress); assert.ok(stored);
    for (const result of results.filter(result => result.status < 300)) assert.equal(result.body.id,stored.id);
    if(expected === 409) assert.equal(results.find(result => result.status === 409).body.code,'DEVICE_ALREADY_CLAIMED');
  }
});
