#!/usr/bin/env node
'use strict';
// PINCER runtime — the local command entry point (docs/runtime-contracts.md).
//
//   node scripts/pincer-runtime.cjs validate <file>... [--digests]
//   node scripts/pincer-runtime.cjs register --prd .prd/prd-vN.md [--change <id>] [--authorization <text>] [--replace] [--rebind]
//   node scripts/pincer-runtime.cjs snapshot [--json] [--store]
//   node scripts/pincer-runtime.cjs recover
//   node scripts/pincer-runtime.cjs status [--json] [--change <id>]
//   node scripts/pincer-runtime.cjs ready [T-NN]
//   node scripts/pincer-runtime.cjs start|verify|done T-NN · bind T-NN .prd/prd-vN.md
//   node scripts/pincer-runtime.cjs migrate --preview|--apply --prd .prd/prd-vN.md [--change <id>] [--authorization <text>]
//   node scripts/pincer-runtime.cjs check C-NN --candidate <sha> [--timeout <seconds>] -- <command...>
//   node scripts/pincer-runtime.cjs evidence export --candidate <sha> --base <sha> --prd .prd/prd-vN.md --draft <file>
//   node scripts/pincer-runtime.cjs change list [--json] · change show <id> [--json] · change select <id> · change revise <id>
//   node scripts/pincer-runtime.cjs change authorize <id> --agreement <digest> (--reference <text> --excerpt <text> | --delegated --basis A-NN --explanation <text>) [--decision D-NN]...
//   node scripts/pincer-runtime.cjs change decide <id> --summary <text> [--id D-NN] | --resolve D-NN --reference <text> --excerpt <text>
//   node scripts/pincer-runtime.cjs change activate|pause|resume|complete|reopen|cancel|supersede <id> [--reason <text>] [--note <text>] [--decision D-NN] [--with <id>]
//   node scripts/pincer-runtime.cjs resume [--change <id>] [--brief] [--json]
//   node scripts/pincer-runtime.cjs coverage [--change <id>] [--json] · coverage scaffold --change <id> [--json] · coverage adopt --preview|--apply --change <id> [--agreement <digest>]
//   node scripts/pincer-runtime.cjs impact [--change <id>] [--from G-NN|A-NN] [--json]
//
// Exit codes: 0 ok · 1 failed/not ready/refused · 2 usage · 3 state busy ·
// 4 invalid input or state · 124 timed out · 130 interrupted.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const io = require('./pincer-runtime/io.cjs');
const parse = require('./pincer-runtime/parse.cjs');
const identity = require('./pincer-runtime/identity.cjs');
const source = require('./pincer-runtime/source.cjs');
const state = require('./pincer-runtime/state.cjs');
const status = require('./pincer-runtime/status.cjs');
const runner = require('./pincer-runtime/runner.cjs');
const sanitize = require('./pincer-runtime/sanitize.cjs');
const lifecycle = require('./pincer-runtime/lifecycle.cjs');
const migrate = require('./pincer-runtime/migrate.cjs');
const evidence = require('./pincer-runtime/evidence.cjs');
const changes = require('./pincer-runtime/changes.cjs');
const agreement = require('./pincer-runtime/agreement.cjs');
const authorization = require('./pincer-runtime/authorization.cjs');
const transitions = require('./pincer-runtime/transitions.cjs');
const gates = require('./pincer-runtime/gates.cjs');
const locator = require('./pincer-runtime/locator.cjs');
const resume = require('./pincer-runtime/resume.cjs');
const adopt = require('./pincer-runtime/adopt.cjs');
const impact = require('./pincer-runtime/impact.cjs');
const checks = require('./pincer-runtime/checks.cjs');
const { atomicWrite, nowIso, tryGit } = require('./pincer-runtime/fsutil.cjs');
const EXIT = { OK: 0, FAILED: 1, USAGE: 2, BUSY: 3, INVALID: 4, TIMED_OUT: 124, INTERRUPTED: 130 };

function repoRoot() {
  if (process.env.CLAUDE_PROJECT_DIR) return path.resolve(process.env.CLAUDE_PROJECT_DIR);
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return process.cwd();
  }
}

function usage(message) {
  if (message) io.err(`pincer: ${message}\n`);
  io.err('usage: pincer-runtime.cjs validate <file>... [--digests]\n' +
    '       pincer-runtime.cjs register --prd .prd/prd-vN.md [--change <id>] [--authorization <text>] [--replace] [--rebind]\n' +
    '       pincer-runtime.cjs snapshot [--json] [--store]\n' +
    '       pincer-runtime.cjs recover\n' +
    '       pincer-runtime.cjs status [--json] [--change <id>]\n' +
    '       pincer-runtime.cjs ready [T-NN]\n' +
    '       pincer-runtime.cjs start|verify|done T-NN\n' +
    '       pincer-runtime.cjs bind T-NN .prd/prd-vN.md\n' +
    '       pincer-runtime.cjs migrate --preview|--apply --prd .prd/prd-vN.md [--change <id>] [--authorization <text>]\n' +
    '       pincer-runtime.cjs check C-NN --candidate <sha> [--timeout <seconds>] -- <command...>\n' +
    '       pincer-runtime.cjs evidence export --candidate <sha> --base <sha> --prd .prd/prd-vN.md --draft <file>\n' +
    '       pincer-runtime.cjs change list [--json] · change show <id> [--json] · change select <id> · change revise <id>\n' +
    '       pincer-runtime.cjs change authorize <id> --agreement <digest> (--reference <text> --excerpt <text> [--constraints <text>] | --delegated --basis A-NN --explanation <text>) [--decision D-NN]...\n' +
    '       pincer-runtime.cjs change decide <id> --summary <text> [--id D-NN] | --resolve D-NN --reference <text> --excerpt <text>\n' +
    '       pincer-runtime.cjs change activate|resume|complete <id> · change pause <id> --reason <text> [--note <text>] · change reopen <id> --reason <text>\n' +
    '       pincer-runtime.cjs change cancel <id> --decision D-NN --reason <text> · change supersede <id> --with <id> --decision D-NN\n' +
    '       pincer-runtime.cjs resume [--change <id>] [--brief] [--json]   (the read-only report; `change resume` is the lifecycle operation)\n' +
    '       pincer-runtime.cjs coverage [--change <id>] [--json] · coverage scaffold --change <id> [--json] · coverage adopt --preview|--apply --change <id> [--agreement <digest>]\n' +
    '       pincer-runtime.cjs impact [--change <id>] [--from G-NN|A-NN] [--json]\n');
  process.exit(EXIT.USAGE);
}

// The change context of a candidate command: the v0.5.0 binding in migrated
// mode, or the selected change's guarded context in changes mode (selected,
// owning the PRD, completed, compatible view, authorization current).
function candidateBinding(root, command, prd) {
  const bind = identity.loadBinding(root, prd ? { prd } : {});
  if (bind.code === 'CHANGES_MODE') {
    try { return gates.guard(root, { command, prd }).binding; } catch (error) {
      if (error && error.refusal) fail('pincer', `${error.code}: ${error.message}`, exitForCode(error.code));
      throw error;
    }
  }
  if (bind.code) fail('pincer', `${bind.code}: ${bind.problem}`, EXIT.INVALID);
  return bind.binding;
}

// The clean-view precondition for candidate checks and exports: HEAD is the
// candidate and nothing is dirty outside NOTES.md and the candidate's evidence
// directory. Never stashes, resets or commits.
function requireCandidateView(root, candidate, prd) {
  const head = identity.head(root);
  if (!head) fail('pincer', 'not a git repository with commits', EXIT.INVALID);
  const version = prd.match(parse.PRD_REF)[1];
  // Only this PRD's evidence directory for the candidate (being assembled by
  // this evaluation) and the candidate's validated followers (NOTES.md, valid
  // locators, listed artifacts of validated manifests for the same candidate —
  // two changes may share a candidate) may differ. Never another whole directory.
  const followers = locator.followers(root, candidate);
  const allowed = p => p.startsWith(`.prd/evidence/prd-v${version}/${candidate}/`) || followers.has(p);
  if (head !== candidate) {
    // A descendant that only adds NOTES.md and the candidate's evidence (the
    // evaluate commit) is still a clean view of the candidate's source.
    const ancestor = tryGit(root, ['merge-base', '--is-ancestor', candidate, 'HEAD']);
    const diff = ancestor.error ? { error: 'not an ancestor' } : tryGit(root, ['diff', '--name-only', candidate, 'HEAD']);
    const differing = diff.error ? null : diff.out.split('\n').filter(Boolean).filter(p => !allowed(p));
    if (!differing || differing.length) {
      fail('pincer', `HEAD is ${head.slice(0, 7)}, not the candidate ${candidate.slice(0, 7)}${differing ? ` and differs from it in: ${differing.slice(0, 5).join(', ')}` : ' (the candidate is not an ancestor of HEAD)'}; check out the committed candidate first (no stash, reset or commit is made for you)`, EXIT.FAILED);
    }
  }
  const dirty = tryGit(root, ['status', '--porcelain', '--untracked-files=all']);
  if (dirty.error) fail('pincer', `git status failed: ${dirty.error}`, EXIT.INVALID);
  const offending = dirty.out.split('\n').filter(Boolean).map(l => l.slice(3).replace(/^"(.*)"$/, '$1')).filter(p => !allowed(p));
  if (offending.length) fail('pincer', `the working tree is not a clean view of the candidate: ${offending.slice(0, 5).join(', ')}${offending.length > 5 ? ` (+${offending.length - 5})` : ''}; only NOTES.md and .prd/evidence/prd-v${version}/${candidate}/ may differ`, EXIT.FAILED);
}

async function cmdCheck(root, args) {
  const o = parseOptions(args, { valued: ['--candidate', '--timeout'] });
  const [checkId, ...command] = o.positional;
  if (!checkId || !evidence.CHECK_ID.test(checkId)) usage('check requires a check ID such as C-01');
  if (!o.candidate || !parse.HEX40.test(o.candidate)) usage('check requires --candidate <full 40-hex commit ID>');
  const b = candidateBinding(root, 'check', null);
  // Strict coverage (docs/runtime-contracts.md, "Declared candidate checks"): the map's
  // declaration is the only source of the command, timeout and cwd; a supplied
  // command or timeout cannot become evidence for a declared check by reusing its ID.
  let commands, timeout, cwd = null, declared = null;
  if (b.strict) {
    if (o.timeout !== undefined || command.length) fail('pincer', `CHECK_UNDECLARED: ${checkId} runs its declaration in a strict change; --timeout and a command after -- are not accepted (edit .prd/coverage/${b.change}.json and authorize the agreement instead)`, EXIT.INVALID);
    declared = checks.declaration(root, b, checkId);
    if (declared.code) fail('pincer', `${declared.code}: ${declared.problem}`, exitForCode(declared.code));
    commands = declared.commands; timeout = declared.timeout; cwd = declared.cwd;
  } else {
    if (!command.length) usage('check requires the command after --');
    timeout = o.timeout === undefined ? parse.DEFAULT_TIMEOUT : Number(o.timeout);
    if (!Number.isInteger(timeout) || timeout <= 0) usage('--timeout must be a positive integer number of seconds');
    commands = [command.join(' ')];
  }
  requireCandidateView(root, o.candidate, b.prd);
  const line = commands.join('\n');
  const secretLine = sanitize.inlineSecretLine(commands);
  if (secretLine) fail('pincer', 'the check command assigns a secret-like literal; reference it from the environment instead', EXIT.INVALID);
  const announce = () => io.out(`── ${checkId} candidate ${o.candidate.slice(0, 7)}${declared ? ` (declared in ${declared.file}${cwd ? `, cwd ${cwd}` : ''})` : ''} ──\n${commands.map(c => `  $ ${sanitize.sanitizeText(c).text}`).join('\n')}\n`);
  const contextFor = c => ({ kind: 'candidate', change: c.change, prd: c.prd, prd_revision: c.prd_revision, base: c.base, candidate: o.candidate, check: checkId, ...(c.mode === 'changes' ? { mode: 'changes', agreement: c.agreement } : {}), ...(c.strict ? { inventory: c.inventory, coverage: c.coverage } : {}) });
  // In changes mode the guard runs again under the runner's lock (docs/runtime-contracts.md,
  // "Command gates"); a lifecycle or agreement change committed since the pre-launch
  // evaluation refuses the attempt before anything is recorded.
  // In a strict change the declaration is recomputed under the lock too: a changed
  // declaration whose agreement was re-authorized meanwhile refuses (CHECK_UNDECLARED).
  const revalidate = b.mode === 'changes' ? () => {
    const g = gates.guard(root, { command: 'check', prd: b.prd });
    if (g.binding.strict) {
      const again = checks.declaration(root, g.binding, checkId);
      if (again.code) require('./pincer-runtime/transaction.cjs').refuse(again.code, again.problem);
      if (!declared || again.digest !== declared.digest) require('./pincer-runtime/transaction.cjs').refuse('CHECK_UNDECLARED', `the declaration of ${checkId} changed since the command was prepared (${declared ? declared.digest.slice(0, 12) : 'none'} → ${again.digest.slice(0, 12)}); run the check again`);
    } else if (declared) require('./pincer-runtime/transaction.cjs').refuse('CHECK_UNDECLARED', `change ${b.change} is no longer strict; run the check again`);
    return contextFor(g.binding);
  } : null;
  const result = await runner.runAttempt({ root, context: contextFor(b), commands, timeoutSeconds: timeout, command: `check ${checkId}`, revalidate, announce, cwd });
  if (result.code) fail('pincer', `${result.code}: ${result.problem}`, result.refused ? exitForCode(result.code) : problemExit(result.code));
  const a = result.attempt;
  const logs = `${state.RUNTIME_DIR}/attempts/${a.id}/`;
  if (a.outcome === 'passed') io.out(`✓ ${checkId} passed — attempt ${a.id} (source ${a.source.after.slice(0, 12)}, logs ${logs})\n`);
  else io.err(`✗ ${checkId} ${a.outcome}${a.exit_code !== null ? ` (exit ${a.exit_code})` : ''}${a.error ? `: ${a.error}` : ''} — attempt ${a.id} (logs ${logs})\n`);
  process.exit(runner.exitFor(a));
}

function cmdEvidence(root, args) {
  const [sub, ...rest] = args;
  if (sub !== 'export') usage('evidence supports: export');
  const o = parseOptions(rest, { valued: ['--candidate', '--base', '--prd', '--draft'] });
  if (o.positional.length) usage(`unexpected argument ${o.positional[0]}`);
  for (const key of ['candidate', 'base']) if (!o[key] || !parse.HEX40.test(o[key])) usage(`evidence export requires --${key} <full 40-hex commit ID>`);
  if (!o.prd || !parse.PRD_REF.test(o.prd)) usage('evidence export requires --prd .prd/prd-vN.md');
  if (!o.draft) usage('evidence export requires --draft <file>');
  const b = candidateBinding(root, 'export', o.prd);
  const bind = { binding: b };
  requireCandidateView(root, o.candidate, o.prd);
  let draft;
  try { draft = JSON.parse(fs.readFileSync(path.resolve(root, o.draft), 'utf8')); } catch (error) { fail('pincer', `cannot read draft ${o.draft}: ${error.message}`, EXIT.INVALID); }
  const indexRead = state.exists(root) ? state.readIndex(root) : { index: null };
  if (indexRead.error) fail('pincer', indexRead.error, EXIT.INVALID);
  const attemptsFor = checkId => {
    if (!indexRead.index) return { attempt: null, pointed: null };
    const key = state.contextKey({ kind: 'candidate', change: b.change, candidate: o.candidate, check: checkId, mode: b.mode });
    return { attempt: state.latestAttempt(root, key, indexRead.index), pointed: indexRead.index.current[key] || null };
  };
  const os = require('node:os');
  // Strict coverage: export needs structural coverage and derives every row from the
  // map, the inventory and the outcomes (docs/runtime-contracts.md, "Evidence schema 3").
  let strict = null;
  if (b.strict) {
    const phases = require('./pincer-runtime/phases.cjs');
    const coverageModule = require('./pincer-runtime/coverage.cjs');
    const resolved = changes.resolveSelected(root, {});
    if (resolved.code) fail('pincer', `${resolved.code}: ${resolved.problem}`, exitForCode(resolved.code));
    const report = phases.compute(root, resolved.record);
    const blocker = phases.firstBlocker(report, 'structure');
    if (blocker) fail('pincer', `${blocker.code}: evidence export refused: ${blocker.detail} — export needs structural coverage`, exitForCode(blocker.code));
    const cov = coverageModule.load(root, resolved.record, { priorInventory: gid => agreement.inventoryOf(root, resolved.record, resolved.record.agreements.find(g => g.id === gid) || null) });
    const v = authorization.verdict(root, resolved.record);
    strict = { inventory: cov.inventory, map: cov.map.map, mapDigest: cov.map.digest, graph: cov.graph, scope: report.scope, agreement: b.agreement, authorization: v.authorized ? v.authorized.id : null };
  }
  const result = evidence.exportEvidence(root, {
    candidate: o.candidate, base: o.base, prd: o.prd, draft, binding: bind.binding, attemptsFor,
    environment: { os: `${os.platform()} ${os.release()}`, node: process.version }, now: nowIso(), atomicWrite, strict,
  });
  if (result.problems.length) {
    for (const p of result.problems) io.err(`evidence: ${result.manifest || o.draft}: ${p}\n`);
    process.exit(EXIT.FAILED);
  }
  io.out(`exported ${result.manifest} (schema ${result.schema})${result.delivery ? ` — delivery: original ${result.delivery.original}, agreed ${result.delivery.agreed}` : ''} — validate: node scripts/pincer-evidence.cjs validate ${result.manifest} --candidate ${o.candidate} --prd ${o.prd}\n`);
  for (const l of result.limitations || []) io.err(`pincer: limitation: ${l}\n`);
  if (b.mode === 'changes') {
    // The per-change evaluation locator is the identity of this evaluation;
    // root NOTES.md stays the human summary (docs/runtime-contracts.md).
    const entry = { candidate: o.candidate, base: o.base, prd: o.prd, prd_revision: b.prd_revision, agreement: b.agreement, manifest: result.manifest, recorded: nowIso() };
    const appended = locator.append(root, b.change, entry);
    if (appended.code) fail('pincer', `${appended.code}: the manifest was written but the evaluation locator could not be updated: ${appended.problem}`, exitForCode(appended.code));
    io.out(`${appended.action === 'recorded' ? 'recorded' : 'already recorded'} evaluation of change ${b.change} in ${locator.file(b.change)} (candidate ${o.candidate.slice(0, 7)}); commit it with the evidence\n`);
  }
  process.exit(EXIT.OK);
}

function cmdMigrate(root, args) {
  const o = parseOptions(args, { valued: ['--prd', '--change', '--authorization'], switches: ['--preview', '--apply'] });
  if (o.positional.length) usage(`unexpected argument ${o.positional[0]}`);
  if (!o.prd) usage('migrate requires --prd .prd/prd-vN.md');
  if (Boolean(o.preview) === Boolean(o.apply)) usage('migrate requires exactly one of --preview or --apply');
  const options = { prd: o.prd, change: o.change, authorization: o.authorization ?? null };
  if (o.preview) {
    const p = migrate.plan(root, options);
    io.out(migrate.renderPlan(p));
    process.exit(p.conflicts.length ? EXIT.FAILED : EXIT.OK);
  }
  const result = migrate.apply(root, options);
  if (result.plan.conflicts.length) { io.out(migrate.renderPlan(result.plan)); process.exit(EXIT.FAILED); }
  if (result.already) { io.out(`already migrated: ${o.prd} is change ${result.plan.change} (schema 2 record); nothing changed\n`); process.exit(EXIT.OK); }
  if (result.error) { io.err(`pincer: ${result.code}: migration refused; nothing was written: ${result.error}\n`); process.exit(exitForCode(result.code)); }
  const r = result.record, p = result.plan;
  io.out(`migrated ${o.prd} → change ${r.change} (schema 2 record, ${r.lifecycle.state}${p.source === 'binding' ? ', converted from the v0.5.0 binding' : p.source === 'record' ? ', receipts imported' : ''}; base ${r.base.slice(0, 7)}; ${p.tickets.length} ticket(s) rewritten; ${Object.keys(r.legacy.receipts).length} legacy receipt(s) as history${p.index ? `; ${p.index.stale.length} candidate pointer(s) dropped` : ''})\n`);
  if (result.backupDir) io.out(`backups: ${result.backupDir} (${result.backups.length} file(s)); rollback per docs/runtime-contracts.md\n`);
  if (p.selection) io.out(`selected change ${r.change} in this worktree (${changes.SELECTION_FILE})\n`);
  io.err(`pincer: note: the change is planned with no authorization${r.legacy.authorization_text ? ' (the v0.5.0 authorization text is history only)' : ''}; existing attempts and evaluations are history until verified again — next: node scripts/pincer-runtime.cjs change authorize ${r.change} --agreement <digest> --reference <text> --excerpt <text>, then change activate ${r.change}\n`);
  process.exit(EXIT.OK);
}

const fail = (prefix, message, code = EXIT.INVALID) => { io.err(`${prefix}: ${message}\n`); process.exit(code); };

// start | verify | done | bind — both modes; refusals carry their prefix and exit code.
async function cmdLifecycle(root, command, args) {
  const usageLine = { start: 'start T-NN', verify: 'verify T-NN', done: 'done T-NN', bind: 'bind T-NN .prd/prd-vN.md' }[command];
  const expected = command === 'bind' ? 2 : 1;
  const o = parseOptions(args, {});
  if (o.positional.length !== expected) usage(`usage: pincer-runtime.cjs ${usageLine}`);
  try {
    const result = command === 'bind' ? lifecycle.bind(root, o.positional[0], o.positional[1])
      : command === 'start' ? lifecycle.start(root, o.positional[0])
        : command === 'verify' ? await lifecycle.verify(root, o.positional[0])
          : await lifecycle.done(root, o.positional[0]);
    if (result.out) io.out(result.out);
    process.exit(result.exit ?? EXIT.OK);
  } catch (error) {
    if (error instanceof lifecycle.Refusal) fail(error.prefix, error.message, error.exit);
    throw error;
  }
}

function cmdStatus(root, args) {
  const o = parseOptions(args, { switches: ['--json'], valued: ['--change'] });
  if (o.positional.length) usage(`unexpected argument ${o.positional[0]}`);
  const budget = process.env.PINCER_BUILD_BUDGET_MIN || '';
  const result = status.render(root, { budget, change: o.change || null });
  if (o.json) io.out(`${JSON.stringify(result.json, null, 2)}\n`);
  else io.out(result.text);
  process.exit(result.exit);
}

// Read-only readiness gate: a ticket, or the candidate when no ticket is named.
function cmdReady(root, args) {
  const o = parseOptions(args, { valued: ['--change'] });
  if (o.positional.length > 1) usage('ready takes at most one ticket ID');
  const result = status.render(root, { change: o.change || null });
  if (result.exit !== 0) { io.err(result.text); process.exit(result.exit); }
  const j = result.json;
  // Changes mode: the selection, lifecycle, view and authorization gates block
  // read-only readiness too (the same codes the execution guard would refuse with).
  const changeBlockers = j.mode === 'changes' ? j.reasons.filter(r => gates.ORDER.includes(r.code)) : [];
  if (j.mode === 'changes' && j.change && j.change.lifecycle.state !== 'active' && o.positional.length === 1) changeBlockers.push({ code: 'LIFECYCLE_BLOCKED', detail: `change ${j.change.id} is ${j.change.lifecycle.state}; ticket execution runs on an active change` });
  if (o.positional.length === 1) {
    const id = parse.normalizeId(o.positional[0]);
    const ticket = id && j.tickets.find(t => t.id === id);
    if (!ticket) { io.err(`pincer: no ticket ${o.positional[0]} is associated with the selected PRD${j.mode === 'changes' && !j.change ? ` (${j.selection.problem ? j.selection.problem.detail : 'no change selected'})` : ''}\n`); process.exit(EXIT.INVALID); }
    if (ticket.readiness.ready && !changeBlockers.length) { io.out(`ready ${id}\n`); process.exit(EXIT.OK); }
    for (const r of changeBlockers) io.out(`not ready ${id}: ${r.code} ${r.detail}\n`);
    for (const r of ticket.readiness.reasons) io.out(`not ready ${id}: ${r.code} ${r.detail}\n`);
    io.out(`next: ${changeBlockers.length ? `${changeBlockers[0].code}: ${changeBlockers[0].detail}` : ticket.readiness.next}\n`);
    process.exit(EXIT.FAILED);
  }
  const blockers = [...changeBlockers];
  if (j.mode === 'changes' && j.change && j.change.lifecycle.state !== 'completed') blockers.push({ code: 'LIFECYCLE_BLOCKED', detail: `change ${j.change.id} is ${j.change.lifecycle.state}, not completed; release audits completed changes only` });
  const localUnavailable = j.candidate && j.candidate.local_attempts === 'unavailable';
  for (const t of j.tickets) {
    if (t.status !== 'done') blockers.push({ code: 'EVIDENCE_MISSING', detail: `${t.id} is ${t.status}, not done` });
    else for (const r of t.readiness.reasons) {
      // A fresh clone validates the saved candidate record only; missing local attempts are its stated limit, not a blocker.
      if (localUnavailable && r.code === 'EVIDENCE_MISSING') continue;
      blockers.push({ code: r.code, detail: `${t.id}: ${r.detail}` });
    }
  }
  if (!j.prd) blockers.push({ code: 'INPUT_INVALID', detail: 'no PRD' });
  else if (j.prd.status !== 'built') blockers.push({ code: 'CANDIDATE_STALE', detail: `PRD status is '${j.prd.status}', expected 'built'` });
  if (j.candidate) blockers.push(...j.candidate.reasons);
  if (j.mode === 'changes' && !j.change) blockers.push({ code: 'SELECTION_REQUIRED', detail: 'no change is selected' });
  // Strict coverage (docs/runtime-contracts.md, "Phase-specific coverage"): release needs
  // structural coverage and every in-scope scenario delivered by the reconciled evidence.
  if (j.mode === 'changes' && j.change && result.gathered && result.gathered.record && changes.isStrict(result.gathered.record)) {
    const report = require('./pincer-runtime/phases.cjs').compute(root, result.gathered.record, { gathered: result.gathered });
    for (const p of [...report.structure.problems, ...report.candidate.problems]) if (!blockers.some(b => b.code === p.code && b.detail === p.detail) && !(p.code === 'CANDIDATE_STALE' && blockers.some(b => b.code === 'CANDIDATE_STALE'))) blockers.push({ code: p.code, detail: p.detail });
  }
  if (!blockers.length) { io.out(`ready candidate ${j.candidate.candidate}\n`); process.exit(EXIT.OK); }
  for (const b of blockers) io.out(`not ready: ${b.code} ${b.detail}\n`);
  io.out(`next: ${j.next}\n`);
  process.exit(EXIT.FAILED);
}

// Run a state operation, mapping the contracted failures to exit codes.
function guarded(fn) {
  try { return fn(); } catch (error) {
    if (error && error.code === 'STATE_BUSY') { io.err(`pincer: STATE_BUSY: ${error.message}\n`); process.exit(EXIT.BUSY); }
    if (error && error.code === 'INVALID') { io.err(`pincer: ${error.message}\n`); process.exit(EXIT.INVALID); }
    throw error;
  }
}

function cmdRecover(root, args) {
  const o = parseOptions(args, {});
  if (o.positional.length) usage(`unexpected argument ${o.positional[0]}`);
  if (!state.exists(root)) { io.out('nothing to recover: no local runtime state\n'); process.exit(EXIT.OK); }
  const report = guarded(() => state.recover(root));
  for (const t of report.transactions.completed) io.out(`completed transaction ${t.id} (${t.command}): ${t.targets.join(', ')}\n`);
  for (const t of report.transactions.discarded) io.out(`discarded uncommitted staging ${t.id}\n`);
  for (const t of report.transactions.unreadable) io.out(`left transaction ${t.id} in place: ${t.problem} (inspect ${state.RUNTIME_DIR}/journal/${t.id}/manifest.json by hand)\n`);
  for (const id of report.finalized) io.out(`finalized ${id} as interrupted (owner no longer running)\n`);
  for (const { id, owner } of report.live) io.out(`still running ${id} (pid ${owner.pid} is alive)\n`);
  for (const { id, owner } of report.foreign) io.out(`still running ${id} (owned by ${owner.host}; not reclaimed from another host)\n`);
  for (const id of report.missing) io.out(`dropped ${id} from running: record missing\n`);
  for (const file of report.journal) io.out(`removed stray journal file ${file}\n`);
  const { transactions, ...lists } = report;
  if (!Object.values(lists).some(list => list.length) && !Object.values(transactions).some(list => list.length)) io.out('nothing to recover\n');
  process.exit(EXIT.OK);
}

// `--flag value` and `--switch` options; positional arguments keep their order.
function parseOptions(args, { valued = [], switches = [], repeated = [] } = {}) {
  const options = { positional: [] };
  for (const arg of repeated) options[arg.slice(2)] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') { options.positional.push(...args.slice(i + 1)); break; }
    if (repeated.includes(arg)) {
      const value = args[++i];
      if (value === undefined) usage(`${arg} requires a value`);
      options[arg.slice(2)].push(value);
    } else if (valued.includes(arg)) {
      const value = args[++i];
      if (value === undefined) usage(`${arg} requires a value`);
      options[arg.slice(2)] = value;
    } else if (switches.includes(arg)) options[arg.slice(2)] = true;
    else if (arg.startsWith('--')) usage(`unknown option ${arg}`);
    else options.positional.push(arg);
  }
  return options;
}
const problemExit = code => (code === 'STATE_BUSY' ? EXIT.BUSY : EXIT.INVALID);
// Contracted exit codes for the change commands: 3 busy, 4 invalid input or
// unreadable state, 1 for every refusal (docs/runtime-contracts.md, "Exit codes").
const INVALID_CODES = ['INPUT_INVALID', 'INVENTORY_INVALID', 'COVERAGE_INVALID', 'CHECK_UNDECLARED', 'MALFORMED', 'UNSUPPORTED_SCHEMA', 'HISTORY_INVALID', 'STATE_INCOMPLETE', 'UNSUPPORTED_INPUT', 'CHANGES_MODE', 'AMBIGUOUS', 'INVALID'];
const exitForCode = code => (code === 'STATE_BUSY' ? EXIT.BUSY : INVALID_CODES.includes(code) ? EXIT.INVALID : EXIT.FAILED);

function cmdRegister(root, args) {
  const o = parseOptions(args, { valued: ['--prd', '--change', '--authorization'], switches: ['--replace', '--rebind'] });
  if (!o.prd) usage('register requires --prd .prd/prd-vN.md');
  if (o.positional.length) usage(`unexpected argument ${o.positional[0]}`);
  const mode = changes.scan(root).mode;
  if (mode === 'migrated') {
    // v0.5.0 binding: the released semantics, except that a second PRD or
    // --replace now needs the migration to change records.
    const result = identity.register(root, { prd: o.prd, change: o.change, authorization: o.authorization ?? null, replace: Boolean(o.replace), rebind: Boolean(o.rebind) });
    if (result.code) { io.err(`pincer: ${result.code === 'MIGRATION_REQUIRED' ? 'MIGRATION_REQUIRED: ' : ''}${result.problem}\n`); process.exit(result.code === 'MIGRATION_REQUIRED' ? EXIT.FAILED : problemExit(result.code)); }
    for (const note of result.notes) io.err(`pincer: note: ${note}\n`);
    const b = result.binding;
    io.out(`${result.action} change ${b.change} → ${b.prd} revision ${b.prd_revision.slice(0, 12)} base ${b.base.slice(0, 7)} (${result.file})\n`);
    process.exit(EXIT.OK);
  }
  // Legacy or changes mode: a schema 2 record. The v0.5.0 flags are refused
  // with the command that replaces them; nothing is inferred from them.
  if (o.replace) fail('pincer', 'LIFECYCLE_BLOCKED: --replace is not supported for change records (they are retained); work on another change with `change select <id>`, retire one with `change supersede <id> --with <replacement> --decision D-NN` or `change cancel <id> --decision D-NN --reason <text>`', EXIT.FAILED);
  if (o.rebind) fail('pincer', 'AGREEMENT_CHANGED: --rebind is not supported for change records; record the revised agreement with `change revise <id>` and its disposition with `change authorize`', EXIT.FAILED);
  if (o.authorization !== undefined) fail('pincer', 'AUTHORIZATION_REQUIRED: --authorization is not recorded on change records (free text cannot become approval); record the user\'s instruction with `change authorize <id> --agreement <digest> --reference <text> --excerpt <text>` after registration', EXIT.FAILED);
  const result = changes.register(root, { prd: o.prd, change: o.change });
  if (result.code) { io.err(`pincer: ${result.code}: ${result.problem}\n`); process.exit(exitForCode(result.code)); }
  const r = result.record;
  io.out(`${result.action} change ${r.change} → ${r.prd} base ${r.base.slice(0, 7)} · ${r.lifecycle.state} (${result.file})\n`);
  if (result.action === 'registered') io.err('pincer: note: registration grants no authorization; record the user\'s instruction with `change authorize` and select the change with `change select`\n');
  process.exit(EXIT.OK);
}

// coverage adopt --preview|--apply --change <id> [--agreement <digest>] — the explicit
// entry into strict coverage (docs/runtime-contracts.md, "Adoption and rollback").
function cmdCoverage(root, args) {
  const [sub, ...rest] = args;
  // coverage scaffold --change <id> [--json] — the read-only coverage draft
  // (docs/runtime-contracts.md, "Coverage draft"). Writes nothing and launches nothing;
  // the draft it prints is not a map and `coverage adopt` does not accept it.
  if (sub === 'scaffold') {
    const o = parseOptions(rest, { switches: ['--json'], valued: ['--change'] });
    if (o.positional.length) usage(`unexpected argument ${o.positional[0]} (coverage scaffold takes --change <id> [--json])`);
    if (!o.change) usage('coverage scaffold requires --change <id>');
    const scaffold = require('./pincer-runtime/scaffold.cjs');
    const resolved = changes.resolveSelected(root, { change: o.change });
    if (resolved.code) fail('pincer', `${resolved.code}: ${resolved.problem}`, exitForCode(resolved.code));
    const result = scaffold.build(root, resolved.record);
    if (!result.ok) fail('pincer', `${result.code}: ${result.problems[0]}`, exitForCode(result.code));
    if (o.json) io.out(`${JSON.stringify(result.draft, null, 2)}\n`);
    else io.out(scaffold.render(result.draft));
    process.exit(EXIT.OK);
  }
  if (sub !== 'adopt') {
    // The read-only coverage report (docs/runtime-contracts.md, "Coverage and impact commands").
    const o = parseOptions(args, { switches: ['--json'], valued: ['--change'] });
    if (o.positional.length) usage(`unexpected argument ${o.positional[0]} (coverage takes [--change <id>] [--json], or the adopt subcommand)`);
    const phases = require('./pincer-runtime/phases.cjs');
    const resolved = changes.resolveSelected(root, { change: o.change || null });
    if (resolved.code) fail('pincer', `${resolved.code}: ${resolved.problem}`, exitForCode(resolved.code));
    const st = status.render(root, { change: o.change || null });
    if (st.exit === 4) { io.err(st.text); process.exit(EXIT.INVALID); }
    // A report asked for with --change may describe a change this worktree has not
    // selected; no execution command it prints could run as written.
    const selected = !resolved.selection || resolved.selection.change === resolved.record.change;
    const result = phases.report(root, resolved.record, { gathered: st.gathered, generated: st.json.generated, selected });
    if (o.json) io.out(`${JSON.stringify(result, null, 2)}\n`);
    else io.out(phases.render(result));
    process.exit(EXIT.OK);
  }
  const o = parseOptions(rest, { valued: ['--change', '--agreement'], switches: ['--preview', '--apply'] });
  if (o.positional.length) usage(`unexpected argument ${o.positional[0]}`);
  if (!o.change) usage('coverage adopt requires --change <id>');
  if (Boolean(o.preview) === Boolean(o.apply)) usage('coverage adopt requires exactly one of --preview or --apply');
  if (o.agreement !== undefined && !/^[0-9a-f]{64}$/.test(o.agreement)) usage('--agreement must be the 64-hex agreement digest the preview printed');
  if (o.preview) {
    const p = adopt.plan(root, { change: o.change });
    io.out(adopt.renderPlan(p));
    process.exit(p.conflicts.length ? EXIT.FAILED : EXIT.OK);
  }
  const result = adopt.apply(root, { change: o.change, agreement: o.agreement ?? null });
  if (result.plan.conflicts.length) { io.out(adopt.renderPlan(result.plan)); process.exit(EXIT.FAILED); }
  if (result.already) { io.out(`already adopted: change ${o.change} is strict since ${result.plan.record.coverage.adopted} (agreement ${result.plan.record.coverage.agreement}); nothing changed\n`); process.exit(EXIT.OK); }
  if (result.error) { io.err(`pincer: ${result.code}: adoption refused; nothing was written: ${result.error}\n`); process.exit(exitForCode(result.code)); }
  const r = result.record, p = result.plan;
  io.out(`adopted strict coverage for change ${r.change} (schema 3 record; agreement ${p.agreement.id} ${p.agreement.digest.slice(0, 12)}; inventory ${p.inventory.requirements} requirement(s), ${p.inventory.scenarios} scenario(s); map ${p.map.digest.slice(0, 12)}; ${p.historical} earlier attempt(s) are history)\n`);
  io.out(`backup: ${result.backup} (rollback per docs/runtime-contracts.md, "Adoption and rollback")\n`);
  io.err(`pincer: note: adoption grants no authorization; record the user's instruction covering the strict agreement with: node scripts/pincer-runtime.cjs change authorize ${r.change} --agreement ${p.agreement.digest} --reference <text> --excerpt <text> (or --delegated --basis A-NN --explanation <text>)\n`);
  process.exit(EXIT.OK);
}

// impact [--change <id>] [--from G-NN|A-NN] [--json] — read-only structural differences
// against a retained agreement (docs/runtime-contracts.md, "Coverage and impact commands").
function cmdImpact(root, args) {
  const o = parseOptions(args, { switches: ['--json'], valued: ['--change', '--from'] });
  if (o.positional.length) usage(`unexpected argument ${o.positional[0]}`);
  const resolved = changes.resolveSelected(root, { change: o.change || null });
  if (resolved.code) fail('pincer', `${resolved.code}: ${resolved.problem}`, exitForCode(resolved.code));
  const result = impact.compute(root, resolved.record, { from: o.from || null });
  if (result.code) fail('pincer', `${result.code}: ${result.problem}`, exitForCode(result.code));
  if (o.json) io.out(`${JSON.stringify(result, null, 2)}\n`);
  else io.out(impact.render(result));
  process.exit(EXIT.OK);
}

// resume [--change <id>] [--json] — the read-only resume report (never the lifecycle operation).
function cmdResume(root, args) {
  const o = parseOptions(args, { switches: ['--json', '--brief'], valued: ['--change'] });
  if (o.positional.length) usage(`unexpected argument ${o.positional[0]}`);
  const result = resume.build(root, { change: o.change || null });
  // --brief is a projection of the same computed report: same verdict, same next
  // action, same blocker categories, fewer bytes (docs/runtime-contracts.md, "Brief
  // resume"). It never recomputes a decision and never changes the exit code.
  if (o.brief) {
    const brief = resume.brief(result.json);
    if (o.json) io.out(`${JSON.stringify(brief, null, 2)}\n`);
    else io.out(resume.renderBrief(brief));
    process.exit(result.exit);
  }
  if (o.json) io.out(`${JSON.stringify(result.json, null, 2)}\n`);
  else io.out(result.text);
  process.exit(result.exit);
}

// The current agreement of a record against its recorded entries (read-only).
function agreementNow(root, record) {
  const now = agreement.compute(root, record);
  if (now.code) return now;
  const entry = agreement.entryFor(record, now.digest);
  const latest = agreement.latestEntry(record);
  let difference = null, rendered = null;
  if (!entry && latest) {
    const snap = agreement.readSnapshot(root, record, latest);
    if (!snap.code) { difference = agreement.difference(snap.snapshot, now); rendered = agreement.renderDifference(difference); }
  }
  return { digest: now.digest, entry, latest, difference, rendered };
}

// change list | show | select | revise — inspection and local/authored records.
function cmdChange(root, args) {
  const [sub, ...rest] = args;
  if (sub === 'list') {
    const o = parseOptions(rest, { switches: ['--json'] });
    if (o.positional.length) usage(`unexpected argument ${o.positional[0]}`);
    const result = changes.list(root);
    const loaded = changes.loadRecords(root);
    for (const c of result.changes) { const e = loaded.records.get(c.id); if (e) { const v = authorization.verdict(root, e.record); c.authorization = v.verdict; c.agreement = v.current; } }
    const sel = changes.readSelection(root);
    const selection = sel.code ? { change: null, problem: { code: sel.code, detail: sel.problem } } : { change: sel.change, problem: null };
    result.changes.forEach(c => { c.selected = Boolean(sel.change) && sel.change === c.id; });
    if (o.json) io.out(`${JSON.stringify({ schema: 1, runtime: changes.RUNTIME, generated: nowIso(), root, mode: result.mode, selection, changes: result.changes, problems: result.problems }, null, 2)}\n`);
    else io.out(changes.renderList(result, { selection: sel.code ? null : sel }));
    process.exit(result.problems.length ? EXIT.INVALID : EXIT.OK);
  }
  if (sub === 'select') {
    const o = parseOptions(rest, {});
    if (o.positional.length !== 1) usage('change select requires exactly one change ID');
    const result = changes.select(root, o.positional[0]);
    if (result.code) fail('pincer', `${result.code}: ${result.problem}`, exitForCode(result.code));
    io.out(`${result.action === 'unchanged' ? 'already selected' : 'selected'} change ${o.positional[0]} → ${result.record.prd} · ${result.record.lifecycle.state} (${changes.SELECTION_FILE}, local to this worktree${result.previous ? `; previously ${result.previous}` : ''})\n`);
    if (result.action === 'selected') io.err('pincer: note: selection is metadata only — no checkout, stash, reset or commit was made, and selecting grants no authorization\n');
    process.exit(EXIT.OK);
  }
  if (sub === 'show') {
    const o = parseOptions(rest, { switches: ['--json'] });
    if (o.positional.length !== 1) usage('change show requires exactly one change ID');
    const result = changes.loadRecord(root, o.positional[0]);
    if (result.code) fail('pincer', `${result.code}: ${result.problem}`, exitForCode(result.code));
    const sel = changes.readSelection(root);
    const now = agreementNow(root, result.record);
    const v = authorization.verdict(root, result.record);
    const loc = locator.read(root, o.positional[0]);
    const evaluations = loc.code ? [] : loc.locator.evaluations;
    if (o.json) io.out(`${JSON.stringify({ schema: 1, runtime: changes.RUNTIME, generated: nowIso(), root, file: result.file, selected: !sel.code && sel.change === o.positional[0], record: result.record, agreement: now.code ? { current: null, problem: { code: now.code, detail: now.problem } } : { current: now.digest, recorded: now.entry ? now.entry.id : null, latest: now.latest ? now.latest.id : null, difference: now.difference }, authorization: { verdict: v.verdict, detail: v.detail, authorized: v.authorized ? v.authorized.id : null, open_decisions: v.open }, evaluations, locator: loc.code ? { code: loc.code, detail: loc.problem } : null }, null, 2)}\n`);
    else io.out(changes.renderShow(o.positional[0], result, { agreement: now, verdict: v, evaluations: loc.code ? [] : evaluations, locatorProblem: loc.code ? loc.problem : null }));
    process.exit(EXIT.OK);
  }
  if (transitions.OPS.includes(sub)) {
    const o = parseOptions(rest, { valued: ['--reason', '--note', '--decision', '--with'] });
    if (o.positional.length !== 1) usage(`change ${sub} requires exactly one change ID`);
    const id = o.positional[0];
    const result = transitions.transition(root, id, sub, { reason: o.reason, note: o.note, decision: o.decision, with: o.with });
    if (result.code) fail('pincer', `${result.code}: ${result.problem}`, exitForCode(result.code));
    if (result.action === 'unchanged') { io.out(`change ${id} is already ${result.to}${result.record.lifecycle.superseded_by ? ` by ${result.record.lifecycle.superseded_by}` : ''}; nothing written\n`); process.exit(EXIT.OK); }
    const e = result.event;
    const past = { activate: 'activated', pause: 'paused', resume: 'resumed', complete: 'completed', reopen: 'reopened', cancel: 'cancelled', supersede: 'superseded' }[sub];
    io.out(`${past} change ${id}: ${result.from} → ${result.to} (event ${e.sequence}${e.authorization ? `, authorization ${e.authorization}` : ''}${e.decision ? `, decision ${e.decision}` : ''}${e.replacement ? `, replaced by ${e.replacement}` : ''}${e.reason ? `; reason: ${e.reason}` : ''})\n`);
    if (sub === 'complete') io.err('pincer: note: completed means implementation complete and ready for evaluation, not evaluated or released; commit the record before choosing the candidate\n');
    if (sub === 'pause' && e.note) io.err('pincer: note: the handoff note is authored text; status and resume show it but never derive readiness from it\n');
    process.exit(EXIT.OK);
  }
  if (sub === 'authorize') {
    const o = parseOptions(rest, { valued: ['--agreement', '--reference', '--excerpt', '--constraints', '--basis', '--explanation'], switches: ['--delegated'], repeated: ['--decision'] });
    if (o.positional.length !== 1) usage('change authorize requires exactly one change ID');
    if (!o.agreement) usage('change authorize requires --agreement <digest>');
    const result = authorization.authorize(root, o.positional[0], { agreement: o.agreement, delegated: Boolean(o.delegated), reference: o.reference, excerpt: o.excerpt, constraints: o.constraints, basis: o.basis, explanation: o.explanation, decisions: o.decision });
    if (result.code) fail('pincer', `${result.code}: ${result.problem}`, exitForCode(result.code));
    const a = result.authorization;
    if (result.action === 'unchanged') io.out(`unchanged: ${a.id} (${a.disposition}) already records this authorization of agreement ${a.agreement} ${a.digest.slice(0, 12)} for ${o.positional[0]}; nothing written\n`);
    else io.out(`recorded authorization ${a.id} (${a.disposition}${a.basis ? `, basis ${a.basis}` : ''}) of agreement ${a.agreement} ${a.digest.slice(0, 12)} for ${o.positional[0]}${a.decisions.length ? ` · decisions ${a.decisions.join(', ')}` : ''}\n`);
    if (result.action === 'recorded') io.err(`pincer: note: this records local provenance of ${a.disposition === 'user' ? "the user's instruction" : 'a delegation judgment'}, not authenticated identity; execution still needs the change selected and active\n`);
    process.exit(EXIT.OK);
  }
  if (sub === 'decide') {
    const o = parseOptions(rest, { valued: ['--summary', '--id', '--resolve', '--reference', '--excerpt'] });
    if (o.positional.length !== 1) usage('change decide requires exactly one change ID');
    if (!o.resolve && !o.summary) usage('change decide requires --summary <text> (raise) or --resolve D-NN --reference <text> --excerpt <text>');
    const result = authorization.decide(root, o.positional[0], { summary: o.summary, id: o.id, resolve: o.resolve, reference: o.reference, excerpt: o.excerpt });
    if (result.code) fail('pincer', `${result.code}: ${result.problem}`, exitForCode(result.code));
    const d = result.decision;
    if (result.action === 'unchanged') io.out(`unchanged: ${d.id} is already ${d.status} (${d.summary}); nothing written\n`);
    else if (result.action === 'raised') { io.out(`raised decision ${d.id} on ${o.positional[0]}: ${d.summary}\n`); io.err(`pincer: note: execution of ${o.positional[0]} is blocked (DECISION_REQUIRED) until the user's decision is recorded with: node scripts/pincer-runtime.cjs change decide ${o.positional[0]} --resolve ${d.id} --reference <text> --excerpt <text>\n`); }
    else { io.out(`resolved decision ${d.id} on ${o.positional[0]}: "${d.excerpt}" (${d.reference})\n`); io.err(`pincer: note: the agreement is now ${result.agreement ? result.agreement.slice(0, 12) : 'unavailable'} and needs authorization: node scripts/pincer-runtime.cjs change authorize ${o.positional[0]} --agreement ${result.agreement || '<digest>'} --decision ${d.id} …\n`); }
    process.exit(EXIT.OK);
  }
  if (sub === 'revise') {
    const o = parseOptions(rest, {});
    if (o.positional.length !== 1) usage('change revise requires exactly one change ID');
    const result = agreement.revise(root, o.positional[0]);
    if (result.code) fail('pincer', `${result.code}: ${result.problem}`, exitForCode(result.code));
    if (result.action === 'unchanged') io.out(`unchanged: the current agreement of ${o.positional[0]} is ${result.agreement.id} ${result.agreement.digest.slice(0, 12)} (recorded ${result.agreement.recorded}); nothing written\n`);
    else io.out(`recorded agreement ${result.agreement.id} ${result.agreement.digest.slice(0, 12)} for ${o.positional[0]} (${result.agreement.tickets.length} ticket(s), snapshot ${result.agreement.snapshot})${result.difference ? ` — differs from the previous agreement: ${agreement.renderDifference(result.difference)}` : ''}\n`);
    if (result.action === 'recorded') io.err('pincer: note: recording an agreement authorizes nothing; record its disposition with `change authorize`\n');
    process.exit(EXIT.OK);
  }
  usage(sub ? `unknown change subcommand ${sub} (change supports: list, show, select, revise, authorize, decide, activate, pause, resume, complete, reopen, cancel, supersede)` : 'change requires a subcommand: list, show, select, revise, authorize, decide, activate, pause, resume, complete, reopen, cancel, supersede');
}

function cmdSnapshot(root, args) {
  const o = parseOptions(args, { switches: ['--json', '--store'] });
  if (o.positional.length) usage(`unexpected argument ${o.positional[0]}`);
  const manifest = source.snapshot(root);
  for (const problem of manifest.problems) io.err(`pincer: ${problem.code}: ${problem.detail}\n`);
  if (manifest.problems.length) process.exit(EXIT.INVALID);
  if (o.store) source.storeManifest(root, manifest);
  if (o.json) io.out(`${JSON.stringify(manifest, null, 2)}\n`);
  else {
    io.out(`digest ${manifest.digest}\nfiles ${manifest.files.length}\nexcluded ${manifest.excluded.length}\n`);
    for (const l of manifest.limitations) io.err(`pincer: limitation: ${l}\n`);
  }
  process.exit(EXIT.OK);
}

function cmdValidate(root, args) {
  const digests = args.includes('--digests');
  const files = args.filter(arg => arg !== '--digests');
  if (files.some(arg => arg.startsWith('--'))) usage(`unknown option ${files.find(arg => arg.startsWith('--'))}`);
  if (files.length === 0) usage('validate requires at least one file');
  let invalid = false;
  const report = (prefix, file, problems) => { for (const p of problems) io.err(`${prefix}: ${file}: ${p}\n`); invalid ||= problems.length > 0; };
  for (const file of files) {
    const relative = path.isAbsolute(file) ? path.relative(root, file) : file;
    const base = path.basename(relative);
    if (/^T-[0-9]+.*\.md$/.test(base)) {
      let text;
      try { text = fs.readFileSync(path.resolve(root, relative), 'utf8'); } catch { report('pincer-ticket', relative, ['no such file']); continue; }
      const result = parse.validateTicket(relative, text);
      report('pincer-ticket', relative, result.problems);
      if (result.ok && digests) {
        io.out(`ticket ${parse.ticketDigest(text)}\n`);
        io.out(`check ${parse.checkDigest(text, result.timeout)}\n`);
      }
    } else if (parse.PRD_REF.test(relative)) {
      const result = parse.validatePrd(root, relative);
      report('pincer', relative, result.problems);
      if (result.ok && digests) io.out(`prd ${parse.prdDigest(result.text)}\n`);
    } else {
      let text;
      try { text = fs.readFileSync(path.resolve(root, relative), 'utf8'); } catch { report('pincer', relative, ['no such file']); continue; }
      report('pincer', relative, parse.validateMetadata(text).problems);
    }
  }
  process.exit(invalid ? EXIT.INVALID : EXIT.OK);
}

function main(argv) {
  const [command, ...rest] = argv;
  const root = repoRoot();
  if (command === 'validate') return cmdValidate(root, rest);
  if (command === 'register') return cmdRegister(root, rest);
  if (command === 'snapshot') return cmdSnapshot(root, rest);
  if (command === 'recover') return cmdRecover(root, rest);
  if (command === 'status') return cmdStatus(root, rest);
  if (command === 'ready') return cmdReady(root, rest);
  if (['start', 'verify', 'done', 'bind'].includes(command)) return cmdLifecycle(root, command, rest);
  if (command === 'migrate') return cmdMigrate(root, rest);
  if (command === 'check') return cmdCheck(root, rest);
  if (command === 'evidence') return cmdEvidence(root, rest);
  if (command === 'change') return cmdChange(root, rest);
  if (command === 'resume') return cmdResume(root, rest);
  if (command === 'coverage') return cmdCoverage(root, rest);
  if (command === 'impact') return cmdImpact(root, rest);
  usage(command ? `unknown command ${command}` : undefined);
}

Promise.resolve(main(process.argv.slice(2))).catch(error => {
  io.err(`pincer: unexpected error: ${error && error.stack ? error.stack : error}\n`);
  process.exit(EXIT.INVALID);
});
