'use strict';
// Small filesystem helpers shared by the runtime modules.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

// Write via a temporary file in the same directory (or the journal directory on
// the same filesystem) and rename into place, so a reader never sees a partial
// file and a crash leaves either the old file or the new one.
function atomicWrite(file, content, { journalDir } = {}) {
  const dir = journalDir || path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = path.join(dir, `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  fs.writeFileSync(temp, content);
  fs.renameSync(temp, file);
}

function readJson(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (error) { return { error: error.code === 'ENOENT' ? 'missing' : error.message }; }
  try { return { data: JSON.parse(raw) }; } catch (error) { return { error: `malformed JSON (${error.message})` }; }
}

function git(root, args, options = {}) {
  return execFileSync('git', ['-C', root, '-c', 'core.quotePath=false', ...args], {
    encoding: options.buffer ? 'buffer' : 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024, ...options,
  });
}
function tryGit(root, args, options) {
  try { return { out: git(root, args, options) }; } catch (error) { return { error: (error.stderr && error.stderr.toString().trim()) || error.message }; }
}

module.exports = { nowIso, atomicWrite, readJson, git, tryGit };
