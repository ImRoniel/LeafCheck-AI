import assert from "node:assert/strict";
import { test } from "node:test";
import { latestReusableIdentification } from "../src/lib/scan-identification.ts";

function fixture(rows) {
  const queries = [];
  const client = {plantIdentification: {findMany: async query => {
    queries.push(query);
    const start = query.cursor ? rows.findIndex(row => row.id === query.cursor.id) + query.skip : 0;
    return rows.slice(start, start + query.take);
  }}};
  return {client, queries};
}
const synthetic = index => ({id: `synthetic-${index}`, confidence: 0, rawResponse: {source: "saved-plant"}});

test("confidence recovery crosses pages of synthetic records and scopes every query to the owner", async () => {
  const original = {id: "real", confidence: 0.989, rawResponse: {results: []}};
  const {client, queries} = fixture([...Array.from({length: 103}, (_,index) => synthetic(index)), original]);
  assert.deepEqual(await latestReusableIdentification(client, "plant", "owner"), original);
  assert.equal(queries.length, 3);
  for (const query of queries) {
    assert.deepEqual(query.where, {plantId: "plant", plant: {userId: "owner"}});
    assert.deepEqual(query.orderBy, [{createdAt: "desc"}, {id: "desc"}]);
  }
  assert.deepEqual(queries[1].cursor, {id: "synthetic-49"});
  assert.deepEqual(queries[2].cursor, {id: "synthetic-99"});
});

test("confidence recovery returns none after all synthetic pages", async () => {
  const {client, queries} = fixture(Array.from({length: 100}, (_,index) => synthetic(index)));
  assert.equal(await latestReusableIdentification(client, "plant", "owner"), null);
  assert.equal(queries.length, 3);
});

for (const confidence of [0, 0.00001, 0.989]) test(`genuine confidence ${confidence} remains usable with nullable or provider metadata`, async () => {
  for (const rawResponse of [null, {results: []}, {source: "gemini"}]) {
    const original = {id: "real", confidence, rawResponse};
    const {client} = fixture([synthetic(1), original]);
    assert.deepEqual(await latestReusableIdentification(client, "plant", "owner"), original);
  }
});
