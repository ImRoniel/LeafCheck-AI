'use strict';
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { runnerInfo } = require('./runner.cjs');

test('the recorded Bash executable can launch checks through native Node', () => {
  const runner = runnerInfo();
  const result = spawnSync(runner.shell, [...runner.args, 'printf verified; exit 23'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.ifError(result.error);
  assert.equal(result.stdout, 'verified');
  assert.equal(result.status, 23);
});
