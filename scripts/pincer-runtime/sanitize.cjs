'use strict';
// PINCER runtime — output sanitizer (docs/runtime-contracts.md, "Capture and
// sanitization"). A safety net applied to every captured line and to command
// display text before anything is persisted: documented secret patterns are
// replaced by [redacted] and counted. It is not a guarantee; checks must avoid
// printing secrets, and no raw log is ever exported.
const PATTERNS = [
  // Bearer tokens first, so an `Authorization: Bearer <token>` header keeps the
  // token, not the word Bearer, as the redacted value.
  { re: /((?:bearer|basic|token|digest)\s+)[A-Za-z0-9\-._~+/=]+/gi, replace: '$1[redacted]' },
  // key/secret/password/token/authorization assignments and JSON fields; a
  // quoted value is redacted up to its closing quote, an unquoted one to the
  // next whitespace or separator. Bounded quantifiers: an unbounded prefix would
  // backtrack quadratically on long lines.
  { re: /((?:^|[^A-Za-z0-9_.-])[A-Za-z0-9_.-]{0,64}?(?:key|secret|password|passwd|token|authorization)[A-Za-z0-9_.-]{0,64}["']?[ \t]{0,8}[:=][ \t]{0,8})(?:"([^"\n]{0,512})"|'([^'\n]{0,512})'|([^\s"',;]+))/gi, replace: (m, head, dq, sq, bare) => `${head}${dq !== undefined ? '"[redacted]"' : sq !== undefined ? "'[redacted]'" : '[redacted]'}` },
  { re: /AKIA[0-9A-Z]{16}/g, replace: '[redacted]' },
  { re: /gh[pousr]_[A-Za-z0-9]{20,}/g, replace: '[redacted]' },
];
const PEM_BEGIN = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const PEM_END = /-----END [A-Z ]*PRIVATE KEY-----/;

// Stateful: PEM private key blocks span lines. `state` is a plain object the
// caller keeps per stream.
function sanitizeLine(line, state = {}) {
  let redactions = 0;
  if (state.inPem) {
    if (PEM_END.test(line)) state.inPem = false;
    return { text: '[redacted]', redactions: 1 };
  }
  if (PEM_BEGIN.test(line)) {
    state.inPem = !PEM_END.test(line);
    return { text: '[redacted]', redactions: 1 };
  }
  let text = line;
  for (const { re, replace } of PATTERNS) {
    text = text.replace(re, (...args) => {
      redactions++;
      return typeof replace === 'function' ? replace(...args) : replace.replace(/\$(\d)/g, (_, n) => args[Number(n)]);
    });
  }
  return { text, redactions };
}

function sanitizeText(text) {
  const state = {};
  let redactions = 0;
  const lines = String(text).split('\n').map(line => { const r = sanitizeLine(line, state); redactions += r.redactions; return r.text; });
  return { text: lines.join('\n'), redactions };
}

// A Verification block must not carry an inline secret literal: the block is
// recorded as display text and would persist the value. `$references` and
// empty values are fine.
// An assignment anywhere in the line (after a word boundary, so `env TOKEN=x cmd`
// and `true; TOKEN=x cmd` count); `$VAR`, `"$VAR"`, `$(…)` and backtick
// references are allowed, literals are not.
const INLINE_SECRET = /(?:^|[\s;&|(])(?:export\s+)?[A-Za-z0-9_]*(?:KEY|SECRET|PASSWORD|PASSWD|TOKEN)[A-Za-z0-9_]*=(?!["']?\$|["']?`|\s|$)\S/i;
function inlineSecretLine(commands) {
  const index = commands.findIndex(line => INLINE_SECRET.test(line));
  return index === -1 ? null : index + 1;
}

module.exports = { sanitizeLine, sanitizeText, inlineSecretLine, PATTERNS };
