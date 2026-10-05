import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const canonical = '.claude/commands/pincer-release.md';
const checklist = 'docs/release-checklist.md';
const adapters = ['.agents/skills/pincer-release/SKILL.md', '.github/prompts/pincer-release.prompt.md'];
const read = file => readFileSync(join(root, file), 'utf8');
const flat = text => text.replace(/\s+/g, ' ');

// Static contracts, not proof that an audit ran. Semantic guidance review is C-06.
function modeContract(text) {
  const prose = flat(text);
  assert.match(prose, /Legacy and migrated modes:.*?`Notes` line is `current` and the `Evidence` line is `ok`/);
  assert.match(prose, /Changes mode:.*?selected change's `Evaluation` line is `current` and the `Evidence` line is `ok`/);
  assert.match(prose, /Root `NOTES\.md` is a compatibility summary, not the evaluation authority/);
  assert.match(prose, /missing or overwritten root Notes cannot substitute for or invalidate the selected locator's verdict/);
  assert.match(prose, /Read the selected change's human handover from root Notes or recorded history/);
  assert.match(prose, /valid evidence-only commit.*?valid evaluation locators is permitted after the candidate in changes mode/);
  assert.match(prose, /Genuine source changes, malformed\/misnamed locators, altered artifact digests and unlisted evidence files still fail freshness/);
  assert.match(prose, /evidence followers never waive the clean-tree audit requirement/);
}

test('release guidance retains explicit mode-specific authority and rejection obligations', () => {
  for (const file of [canonical, checklist, ...adapters]) modeContract(read(file));
  for (const file of [canonical, checklist]) {
    const prose = flat(read(file));
    assert.match(prose, /selected change is `completed`/);
    assert.match(prose, /authorization is `current` for the current agreement/);
    assert.match(prose, /Every file the (?:evidence )?manifest lists is tracked/i);
    assert.match(prose, /structure complete.*?every in-scope scenario `delivered`/);
    assert.match(prose, /adequate/);
    assert.match(prose, /local verification history unavailable/);
    assert.match(prose, /before and after the audit/);
    assert.match(prose, /read-only/i);
  }
  assert.match(flat(read(canonical)), /newer local attempt that failed, timed out, was interrupted or is still running.*?fails the audit/);
  assert.match(flat(read(checklist)), /no newer nonpassing local attempt for the same check and source inputs/);
  assert.match(flat(read(canonical)), /`git status --short` is empty before and after the audit/);
  assert.match(flat(read(checklist)), /working tree is clean before and after the audit/);
});

test('release static contract rejects missing authority and clean-tree clauses', () => {
  const original = read(canonical);
  for (const [before, after] of [
    ['Legacy and migrated modes:', 'All modes:'],
    ['`Evaluation` line is `current`', '`Evaluation` line may be stale'],
    ['not the\n       evaluation authority', 'the\n       evaluation authority'],
    ['evidence\n       followers never waive the clean-tree audit requirement', 'evidence\n       followers waive the clean-tree audit requirement'],
  ]) {
    assert.ok(original.includes(before), `missing mutation target: ${before}`);
    assert.throws(() => modeContract(original.replace(before, after)), assert.AssertionError);
  }
});

test('canonical release guidance and both adapters are durably tracked', () => {
  for (const file of [canonical, checklist, ...adapters]) {
    const result = spawnSync('git', ['ls-files', '--error-unmatch', '--', file], { cwd: root, encoding: 'utf8' });
    assert.ifError(result.error);
    assert.equal(result.status, 0, `${file} must be tracked, including intentionally ignored guidance`);
    assert.equal(result.stdout.trim(), file);
  }
});

test('delivery review separates pre-export evidence from the actual post-export audit', () => {
  const map = JSON.parse(read('.prd/coverage/prd-v2.json'));
  const obligation = map.checks['C-07'].obligation;
  assert.match(obligation, /^Pre-export delivery review:/);
  assert.match(obligation, /actual post-export release audit is recorded separately after committing the evaluation/);
  assert.match(obligation, /does not attest a future audit result/);
  const prose = flat(read(checklist));
  assert.match(prose, /actual read-only release audit follows the committed evaluation and is reported separately/);
  assert.match(prose, /Never make that future audit a prerequisite for exporting the same evaluation/);
  assert.ok(map.scenarios['S-08']);
  assert.equal(map.scope['S-08'], undefined);
});

test('release adapters match isolated canonical regeneration without changing the worktree', t => {
  const temporary = mkdtempSync(join(tmpdir(), 'pincer-release-guidance-'));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  for (const file of [canonical, 'scripts/sync-prompts.sh']) {
    mkdirSync(dirname(join(temporary, file)), { recursive: true });
    copyFileSync(join(root, file), join(temporary, file));
  }
  const result = spawnSync('bash', ['scripts/sync-prompts.sh'], { cwd: temporary, encoding: 'utf8' });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  for (const file of adapters) {
    assert.equal(read(file), readFileSync(join(temporary, file), 'utf8'), `${file} drifted from canonical generation`);
  }
});
