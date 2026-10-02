#!/usr/bin/env node
'use strict';
// PINCER evidence — read-only validator for candidate evidence manifests.
// Dependency-free; runs under `node` on any platform. The implementation lives
// in scripts/pincer-runtime/evidence.cjs (shared with status and release).
//
//   node scripts/pincer-evidence.cjs validate .prd/evidence/prd-vN/<candidate>/manifest.json \
//        [--candidate <sha>] [--base <sha>] [--prd .prd/prd-vN.md] [--files]
//   node scripts/pincer-evidence.cjs digest <file>...
//
// `validate` exits 0 and prints `ok <candidate>` when the manifest is
// consistent; with --files it also lists the manifest and every artifact path
// (repository-relative, one per line). Otherwise it prints one
// `evidence: <manifest>: <reason>` line per problem to stderr and exits 1.
// Usage errors exit 2. Nothing is ever written.
//
// What validation establishes: that the locally authored record is internally
// consistent — schema, references, candidate association, required results,
// artifact existence and digests, repository containment. It is NOT independent
// attestation that the recorded commands ran or that images depict the stated
// application; that judgment stays with the reviewer.
const fs = require('node:fs');
const path = require('node:path');
const { HEX40, PRD_REF, validate, digestFile } = require('./pincer-runtime/evidence.cjs');
const io = require('./pincer-runtime/io.cjs');

function usage(message) {
  if (message) io.err(`pincer-evidence: ${message}\n`);
  io.err('usage: pincer-evidence.cjs validate <manifest> [--candidate <sha>] [--base <sha>] [--prd .prd/prd-vN.md] [--files]\n       pincer-evidence.cjs digest <file>...\n');
  process.exit(2);
}

function main(argv) {
  const [command, ...rest] = argv;
  if (command === 'validate') {
    const opts = { files: false };
    let manifest = null;
    for (let i = 0; i < rest.length; i++) {
      const arg = rest[i];
      if (arg === '--files') opts.files = true;
      else if (arg === '--candidate' || arg === '--base' || arg === '--prd') {
        const value = rest[++i];
        if (value === undefined) usage(`${arg} requires a value`);
        opts[arg.slice(2)] = value;
      } else if (arg.startsWith('--')) usage(`unknown option ${arg}`);
      else if (manifest === null) manifest = arg;
      else usage('validate takes exactly one manifest path');
    }
    if (manifest === null) usage('validate requires a manifest path');
    if (opts.candidate !== undefined && !HEX40.test(opts.candidate)) usage('--candidate must be a full 40-hex commit ID');
    if (opts.base !== undefined && !HEX40.test(opts.base)) usage('--base must be a full 40-hex commit ID');
    if (opts.prd !== undefined && !PRD_REF.test(opts.prd)) usage('--prd must be of the form .prd/prd-vN.md');
    const problems = validate(manifest, opts);
    if (problems.length > 0) {
      for (const p of problems) io.err(`evidence: ${manifest}: ${p}\n`);
      process.exit(1);
    }
    const doc = JSON.parse(fs.readFileSync(path.resolve(manifest), 'utf8'));
    io.out(`ok ${doc.candidate}${doc.schema >= 2 ? ` schema ${doc.schema}` : ''}\n`);
    for (const l of opts.limitations || []) io.err(`evidence: limitation: ${l}\n`);
    if (opts.files) for (const p of opts.list) io.out(`${p}\n`);
    return;
  }
  if (command === 'digest') {
    if (rest.length === 0) usage('digest requires at least one file');
    for (const file of rest) {
      let digest;
      try { digest = digestFile(file); } catch (error) { io.err(`pincer-evidence: ${file}: ${error.code === 'ENOENT' ? 'missing' : error.message}\n`); process.exit(1); }
      io.out(`${digest}  ${file}\n`);
    }
    return;
  }
  usage(command ? `unknown command ${command}` : undefined);
}

main(process.argv.slice(2));
