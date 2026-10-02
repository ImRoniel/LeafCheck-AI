'use strict';
// Complete output on every exit path.
//
// `process.stdout` is asynchronous when it is a pipe: a write larger than the
// pipe buffer is queued on the event loop, and `process.exit()` throws away
// whatever has not drained. The CLI uses `process.exit()` as its return
// statement, so any command whose report outgrows one pipe buffer prints a
// prefix of itself and still exits 0 — `snapshot --json` is 237 KB on this
// repository and arrives as 64 KB of invalid JSON through a pipe, on every
// supported Node version. Writing the file descriptor synchronously removes the
// queue: when `out` returns, the bytes are in the pipe.
//
// A slow reader on a non-blocking pipe answers EAGAIN; wait for it rather than
// spin. A reader that has gone away answers EPIPE, and a closed descriptor
// answers EBADF: neither is an error here — `pincer status | head -3` and
// `pincer status 1>&-` are both things a person can type, and both must stay
// silent and keep the command's own exit code.
const fs = require('node:fs');

const IDLE = new Int32Array(new SharedArrayBuffer(4));

function write(fd, text) {
  if (!text) return;
  const buffer = Buffer.from(text, 'utf8');
  let offset = 0;
  while (offset < buffer.length) {
    try {
      offset += fs.writeSync(fd, buffer, offset, buffer.length - offset);
    } catch (error) {
      if (error.code === 'EAGAIN' || error.code === 'EINTR') { Atomics.wait(IDLE, 0, 0, 1); continue; }
      if (error.code === 'EPIPE' || error.code === 'EBADF') return;
      throw error;
    }
  }
}

module.exports = {
  out: text => write(1, text),
  err: text => write(2, text),
  write,
};
