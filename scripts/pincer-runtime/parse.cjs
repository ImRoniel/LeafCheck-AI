'use strict';
// PINCER runtime — parser and validator for the supported Markdown grammar
// (docs/runtime-contracts.md, "Supported grammar" and "Content revisions").
// Dependency-free. The rules and diagnostics match the v0.4.1 Bash validators
// so the two never disagree; the Node module is now the only implementation.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const PRD_REF = /^\.prd\/prd-v([1-9][0-9]{0,8})\.md$/;
const HEX40 = /^[0-9a-f]{40}$/;
const DEFAULT_TIMEOUT = 600;
const MAX_TIMEOUT = 2147483; // setTimeout's 32-bit millisecond limit, in seconds
const LIFECYCLE_FIELDS = ['status', 'started', 'finished', 'verified', 'last_check'];
const CHECKBOX_LINE = /^([ \t]*(?:[-+*]|[0-9]+[.)])[ \t]+)\[([ xX])\]/;

const sha256 = text => crypto.createHash('sha256').update(text).digest('hex');
const lines = text => {
  const all = String(text).split('\n');
  if (all.length && all[all.length - 1] === '') all.pop();
  return all;
};

// CLI shorthand -> canonical ID ("3" -> "T-03"); null when not a ticket id.
function normalizeId(input) {
  let n = String(input);
  if (n.startsWith('T-') || n.startsWith('t-')) n = n.slice(2);
  if (!/^[0-9]{1,6}$/.test(n) || Number(n) === 0) return null;
  return `T-${String(Number(n)).padStart(2, '0')}`;
}
function canonicalId(s) {
  if (typeof s !== 'string' || !/^T-[0-9][0-9]+$/.test(s)) return false;
  const n = s.slice(2);
  return n.length <= 6 && Number(n) > 0 && `T-${String(Number(n)).padStart(2, '0')}` === s;
}

// Frontmatter: `---`, unindented unique `key: value` lines (inline `#` comments,
// blank and comment lines allowed), `---`. Returns the fields and the index of
// the closing line, or the single structural problem.
function parseFrontmatter(text, kind = 'ticket') {
  const rows = lines(text);
  const fields = {};
  const order = [];
  if (rows[0] !== '---') return { problem: 'frontmatter must begin with ---', rows };
  for (let i = 1; i < rows.length; i++) {
    const line = rows[i];
    if (line === '---') return { fields, order, end: i, rows };
    if (/^[ \t]*(#.*)?$/.test(line)) continue;
    if (!/^[a-z_][a-z0-9_]*:[ \t]*/.test(line)) {
      return { problem: kind === 'ticket' ? 'frontmatter requires unindented key: value fields' : 'expected unindented key: value metadata', rows };
    }
    const key = line.slice(0, line.indexOf(':'));
    if (key in fields) return { problem: `duplicate ${kind === 'ticket' ? 'frontmatter' : 'metadata'} key: ${key}`, rows };
    let value = line.slice(key.length + 1);
    value = value.replace(/#.*/, '').trim();
    fields[key] = value;
    order.push(key);
  }
  return { problem: 'frontmatter must close with ---', rows };
}

// Read one frontmatter field the way the Bash helper did (first match, comment
// stripped), tolerating files without valid frontmatter.
function frontmatterField(text, key) {
  const fm = parseFrontmatter(text);
  if (fm.problem && fm.problem !== 'frontmatter must close with ---') {
    if (fm.problem === 'frontmatter must begin with ---') return '';
  }
  for (const line of lines(text).slice(1)) {
    if (line === '---') break;
    if (line.startsWith(`${key}:`)) return line.slice(key.length + 1).replace(/#.*/, '').trim();
  }
  return '';
}

function verificationCommands(text) {
  const out = [];
  let inBlock = false, otherFence = false, inVerify = false;
  for (const line of lines(text)) {
    if (inBlock) { if (/^[ \t]*```[ \t]*$/.test(line)) break; out.push(line); continue; }
    if (otherFence) { if (/^[ \t]*```/.test(line)) otherFence = false; continue; }
    if (/^## Verification[ \t]*$/.test(line)) { inVerify = true; continue; }
    if (inVerify && /^[ \t]*```bash[ \t]*$/.test(line)) { inBlock = true; continue; }
    if (inVerify && /^## /.test(line)) break;
    if (/^[ \t]*```/.test(line)) otherFence = true;
  }
  return out;
}
// The block as the legacy helper hashed and executed it: joined lines, one trailing newline.
const blockText = text => { const c = verificationCommands(text); return c.length ? `${c.join('\n')}\n` : ''; };
const legacyBlockHash = text => sha256(blockText(text)).slice(0, 12);

function unticked(text) {
  const out = [];
  let otherFence = false, inAccept = false;
  for (const line of lines(text)) {
    if (otherFence) { if (/^[ \t]*```/.test(line)) otherFence = false; continue; }
    if (/^[ \t]*```/.test(line)) { otherFence = true; continue; }
    if (/^## Acceptance Criteria[ \t]*$/.test(line)) { inAccept = true; continue; }
    if (inAccept && /^## /.test(line)) break;
    if (inAccept && /^[ \t]*([-+*]|[0-9]+[.)])[ \t]+\[ \]/.test(line)) out.push(line);
  }
  return out;
}

function effectiveTimeout(fields) {
  return fields.timeout ? Number(fields.timeout) : DEFAULT_TIMEOUT;
}

// Full ticket validation. Returns { ok, problems, fields, timeout }.
function validateTicket(file, text) {
  const problems = [];
  const fm = parseFrontmatter(text, 'ticket');
  if (fm.problem) return { ok: false, problems: [fm.problem], fields: {} };
  const { fields, rows } = fm;
  let inVerify = false, otherFence = false, section = '';
  let accept = 0, verify = 0, boxes = 0, fences = 0, runnable = 0;
  for (let i = fm.end + 1; i < rows.length; i++) {
    const line = rows[i];
    if (inVerify) {
      if (/^[ \t]*```[ \t]*$/.test(line)) { inVerify = false; continue; }
      if (/^[ \t]*```/.test(line)) { problems.push('Verification requires one closed bash fence'); continue; }
      if (!/^[ \t]*(#.*)?$/.test(line)) runnable++;
      continue;
    }
    if (otherFence) { if (/^[ \t]*```/.test(line)) otherFence = false; continue; }
    if (/^## Acceptance Criteria[ \t]*$/.test(line)) { if (accept++) problems.push('duplicate Acceptance Criteria section'); section = 'accept'; continue; }
    if (/^## Verification[ \t]*$/.test(line)) { if (verify++) problems.push('duplicate Verification section'); section = 'verify'; continue; }
    if (/^## /.test(line)) { section = ''; continue; }
    if (section === 'accept') {
      if (/^[ \t]*(```|~~~)/.test(line)) { problems.push('Acceptance Criteria must contain visible checkboxes, not fences'); continue; }
      if (/^[ \t]*([-+*]|[0-9]+[.)])[ \t]+/.test(line) || /^[ \t]*([-+*]|[0-9]+[.)])?[ \t]*\[/.test(line)) {
        if (!/^[ \t]*([-+*]|[0-9]+[.)])[ \t]+\[[ xX]\][ \t]+[^ \t]/.test(line)) {
          problems.push('malformed acceptance checkbox; use - [ ] text or - [x] text (indented/list marker variants supported)');
        }
        boxes++;
      }
    }
    if (/^[ \t]*~~~/.test(line)) { problems.push('use backtick fences; tilde fences are unsupported'); continue; }
    if (/^[ \t]*```/.test(line)) {
      if (section === 'verify') {
        if (!/^[ \t]*```bash[ \t]*$/.test(line) || fences++) problems.push('Verification requires exactly one bash fence');
        inVerify = true;
      } else otherFence = true;
    }
  }
  if (!('ticket' in fields) || !canonicalId(fields.ticket)) problems.push('ticket must be a canonical ID between T-01 and T-999999');
  else {
    const base = path.basename(file);
    const prefix = `${fields.ticket}-`;
    if (!base.startsWith(prefix) || !/.+\.md$/.test(base) || base.length <= prefix.length + 3) problems.push('ticket ID must match filename T-NN-slug.md');
  }
  if (!['open', 'in_progress', 'done'].includes(fields.status)) problems.push('status must be open, in_progress, or done');
  if (!['S', 'M', 'L'].includes(fields.size)) problems.push('size must be S, M, or L');
  for (const key of ['started', 'finished']) if (key in fields && !TIMESTAMP.test(fields[key])) problems.push(`${key} must be an ISO UTC timestamp`);
  for (const key of ['verified', 'last_check']) {
    if (!(key in fields)) continue;
    const parts = fields[key].split(/[ \t]+/);
    const expected = key === 'verified' ? 2 : 3;
    if (parts.length !== expected || !TIMESTAMP.test(parts[0]) || !/^[0-9a-f]{12}$/.test(parts[parts.length - 1])) problems.push(`malformed ${key} timestamp/hash`);
    else if (key === 'last_check' && !['running', 'passed', 'failed', 'interrupted'].includes(parts[1])) problems.push('invalid last_check outcome');
  }
  if ('timeout' in fields && (!/^[1-9][0-9]{0,8}$/.test(fields.timeout) || Number(fields.timeout) > MAX_TIMEOUT)) problems.push(`timeout must be a positive integer number of seconds (at most ${MAX_TIMEOUT})`);
  const deps = fields.depends_on;
  if (!('depends_on' in fields) || !/^\[[ \t]*(T-[0-9]+([ \t]*,[ \t]*T-[0-9]+)*)?[ \t]*\]$/.test(deps)) problems.push('depends_on must be an inline list such as [T-01, T-02]');
  else {
    const seen = new Set();
    for (const entry of deps.replace(/^\[[ \t]*/, '').replace(/[ \t]*\]$/, '').split(',')) {
      const dep = entry.trim();
      if (dep === '') continue;
      if (!canonicalId(dep)) problems.push(`depends_on contains noncanonical ticket ID: ${dep}`);
      if (dep === fields.ticket) problems.push('ticket cannot depend on itself');
      if (seen.has(dep)) problems.push(`duplicate depends_on ID: ${dep}`);
      seen.add(dep);
    }
  }
  if (!accept || !boxes) problems.push('Acceptance Criteria requires at least one nonempty checkbox');
  if (!verify || fences !== 1 || inVerify || !runnable) problems.push('Verification requires exactly one closed runnable bash fence');
  if (problems.length === 0) {
    const syntax = spawnSync('bash', ['-n', '-c', blockText(text)], { encoding: 'utf8' });
    if (syntax.error) problems.push(`cannot run bash to check the Verification block (${syntax.error.message})`);
    else if (syntax.status !== 0) problems.push('invalid bash syntax in Verification block');
  }
  return { ok: problems.length === 0, problems, fields, timeout: effectiveTimeout(fields) };
}

function dependencies(fields) {
  return ((fields.depends_on || '').match(/T-[0-9]+/g) || []);
}

// PRDs and evaluation notes use the same deliberately small metadata format.
function validateMetadata(text) {
  const fm = parseFrontmatter(text, 'metadata');
  return fm.problem ? { ok: false, problems: [fm.problem], fields: {} } : { ok: true, problems: [], fields: fm.fields };
}

function validatePrd(root, ref) {
  const match = typeof ref === 'string' ? ref.match(PRD_REF) : null;
  if (!match) return { ok: false, problems: [`invalid PRD reference ${ref}; use .prd/prd-vN.md`], prefix: 'pincer' };
  const file = path.join(root, ref);
  if (!fs.existsSync(file)) return { ok: false, problems: [`PRD does not exist: ${ref}`], prefix: 'pincer' };
  const text = fs.readFileSync(file, 'utf8');
  const meta = validateMetadata(text);
  if (!meta.ok) return { ok: false, problems: meta.problems, file: ref };
  const problems = [];
  const { fields } = meta;
  if (fields.version !== match[1]) problems.push(`version must match filename (${match[1]})`);
  if (!['draft', 'ticketed', 'built'].includes(fields.status)) problems.push('PRD status must be draft, ticketed, or built');
  if (!['', 'small', 'standard', undefined].includes(fields.profile)) problems.push('profile must be small or standard (omit for standard)');
  return { ok: problems.length === 0, problems, file: ref, fields, text, profile: fields.profile || 'standard' };
}

// Normalizations (contract "Content revisions"): lifecycle fields and checkbox
// marks are the only exceptions; everything else contributes to identity.
function normalizeTicket(text) {
  const rows = lines(text);
  const out = [];
  let closed = rows[0] !== '---';
  let otherFence = false, inAccept = false;
  for (let i = 0; i < rows.length; i++) {
    const line = rows[i];
    if (!closed) {
      if (i > 0 && line === '---') closed = true;
      else if (i > 0) {
        const key = (line.match(/^([a-z_][a-z0-9_]*):/) || [])[1];
        if (key && LIFECYCLE_FIELDS.includes(key)) continue;
      }
      out.push(line);
      continue;
    }
    if (otherFence) { if (/^[ \t]*```/.test(line)) otherFence = false; out.push(line); continue; }
    if (/^[ \t]*```/.test(line)) { otherFence = true; out.push(line); continue; }
    if (/^## Acceptance Criteria[ \t]*$/.test(line)) inAccept = true;
    else if (/^## /.test(line)) inAccept = false;
    out.push(inAccept ? line.replace(CHECKBOX_LINE, '$1[ ]') : line);
  }
  return `${out.join('\n')}\n`;
}
function normalizePrd(text) {
  const rows = lines(text);
  const out = [];
  let closed = rows[0] !== '---';
  for (let i = 0; i < rows.length; i++) {
    const line = rows[i];
    if (!closed) {
      if (i > 0 && line === '---') closed = true;
      else if (i > 0 && /^status:/.test(line)) continue;
    }
    out.push(line);
  }
  return `${out.join('\n')}\n`;
}
// Split a ticket text into the parts the structural agreement difference names:
// the frontmatter, the Acceptance Criteria section, the Verification section and
// everything else (headings inside fenced blocks are ignored, as elsewhere).
function ticketSections(text) {
  const rows = lines(text);
  const parts = { frontmatter: [], acceptance: [], verification: [], other: [] };
  let inFront = rows[0] === '---', section = 'other', fence = false;
  for (let i = 0; i < rows.length; i++) {
    const line = rows[i];
    if (inFront) { parts.frontmatter.push(line); if (i > 0 && line === '---') inFront = false; continue; }
    if (fence) { parts[section].push(line); if (/^[ \t]*```/.test(line)) fence = false; continue; }
    if (/^[ \t]*```/.test(line)) { fence = true; parts[section].push(line); continue; }
    if (/^## Acceptance Criteria[ \t]*$/.test(line)) section = 'acceptance';
    else if (/^## Verification[ \t]*$/.test(line)) section = 'verification';
    else if (/^## /.test(line)) section = 'other';
    parts[section].push(line);
  }
  return Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, v.join('\n')]));
}
const ticketDigest = text => sha256(normalizeTicket(text));
const prdDigest = text => sha256(normalizePrd(text));
const checkDigest = (text, timeoutSeconds = DEFAULT_TIMEOUT) => sha256(`${blockText(text)}timeout=${timeoutSeconds}\n`);

// tickets/T-NN-*.md resolution and set validation.
function ticketFiles(root) {
  const dir = path.join(root, 'tickets');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(name => /^T-[0-9]+.*\.md$/.test(name)).sort().map(name => `tickets/${name}`);
}
function ticketFile(root, input) {
  const id = normalizeId(input);
  if (!id) return { problem: `not a ticket id (expected 1..999999): ${input}` };
  const matches = ticketFiles(root).filter(f => path.basename(f).startsWith(`${id}-`));
  if (matches.length > 1) return { problem: `several files match tickets/${id}-*.md` };
  if (matches.length === 0) return { problem: `no ticket file tickets/${id}-*.md` };
  return { id, file: matches[0] };
}
function validateTicketSet(root) {
  const files = ticketFiles(root);
  const ids = new Set();
  for (const file of files) {
    const id = frontmatterField(fs.readFileSync(path.join(root, file), 'utf8'), 'ticket');
    if (id) {
      if (ids.has(id)) return { ok: false, problems: [`duplicate ticket ID: ${id}`] };
      ids.add(id);
    }
  }
  for (const file of files) {
    const result = validateTicket(file, fs.readFileSync(path.join(root, file), 'utf8'));
    if (!result.ok) return { ok: false, file, problems: result.problems };
  }
  return { ok: true, files };
}

module.exports = {
  TIMESTAMP, PRD_REF, HEX40, DEFAULT_TIMEOUT, MAX_TIMEOUT, LIFECYCLE_FIELDS,
  sha256, lines, normalizeId, canonicalId, parseFrontmatter, frontmatterField,
  verificationCommands, blockText, legacyBlockHash, unticked, effectiveTimeout,
  validateTicket, dependencies, validateMetadata, validatePrd,
  normalizeTicket, normalizePrd, ticketDigest, prdDigest, checkDigest, ticketSections,
  ticketFiles, ticketFile, validateTicketSet,
};
