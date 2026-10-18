import assert from "node:assert/strict";
import { test } from "node:test";
import { attachPasswordPolicyStatus, passwordPolicyStatus } from "../src/lib/password-policy.ts";

const now = new Date("2026-10-18T12:00:00Z");
const day = 86400000;

test("password warnings begin at 23 elapsed days and expiration at exactly 30 days", () => {
  for (const [age, daysUntilExpiry, isExpiringSoon, isExpired] of [
    [0, 30, false, false], [23 - 1 / day, 8, false, false], [23, 7, true, false],
    [24, 6, true, false], [30 - 1 / day, 1, true, false], [30, 0, true, true], [60, 0, true, true],
  ]) assert.deepEqual(passwordPolicyStatus(new Date(now.getTime() - age * day), now), { daysUntilExpiry, isExpiringSoon, isExpired });
});

test("unknown, invalid and future timestamps do not invent an old password", () => {
  for (const value of [null, undefined, new Date(NaN), new Date(now.getTime() + day)])
    assert.deepEqual(passwordPolicyStatus(value, now), { daysUntilExpiry: 30, isExpiringSoon: false, isExpired: false });
});

test("the advisory middleware always continues, including for expired passwords", () => {
  const res = { locals: { auth: { user: { passwordChangedAt: new Date(Date.now() - 60 * day) } } } };
  let continued = false;
  attachPasswordPolicyStatus({}, res, () => { continued = true; });
  assert.equal(continued, true);
  assert.equal(res.locals.passwordPolicy.isExpired, true);
});
