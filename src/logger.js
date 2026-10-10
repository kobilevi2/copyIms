// Minimal file + console logger. Appends timestamped, leveled lines to
// data/app.log so problems (slow requests, conversion failures, crashes) can
// be diagnosed after the fact without needing to reproduce them live.
//
// Writes are fire-and-forget async (chained onto a queue so lines stay
// ordered and rotation doesn't race, but callers never wait on disk I/O) --
// a burst of logging (e.g. many failures in one thumbnail sweep) must never
// itself become a source of blocking. A single file handle (opened in append
// mode) is kept open and reused across writes instead of the default
// open+write+close per call, since that per-call overhead is what makes a
// large burst of log lines lag noticeably behind real time on Windows.

const fsp = require('fs/promises');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const LOG_PATH = path.join(DATA_DIR, 'app.log');
const MAX_LOG_BYTES = 5 * 1024 * 1024; // rotate at 5MB so it can't grow unbounded

let logHandle = null;
async function getHandle() {
  if (logHandle) return logHandle;
  await fsp.mkdir(DATA_DIR, { recursive: true });
  logHandle = await fsp.open(LOG_PATH, 'a');
  return logHandle;
}

async function closeHandle() {
  if (!logHandle) return;
  const handle = logHandle;
  logHandle = null;
  await handle.close().catch(() => {});
}

let approxLogBytes = null; // lazily resolved from a real stat on first write, then tracked in memory
async function rotateIfNeeded(nextLineBytes) {
  if (approxLogBytes === null) {
    try {
      approxLogBytes = (await fsp.stat(LOG_PATH)).size;
    } catch (err) {
      approxLogBytes = 0; // no log file yet
    }
  }

  if (approxLogBytes + nextLineBytes <= MAX_LOG_BYTES) return;

  await closeHandle();
  try {
    const prevPath = `${LOG_PATH}.1`;
    await fsp.rm(prevPath, { force: true });
    await fsp.rename(LOG_PATH, prevPath);
  } catch (err) {
    // Best-effort -- if rotation itself fails, keep appending to the current file.
  }
  approxLogBytes = 0;
}

// Turns an Error into something JSON.stringify-able (plain objects lose
// .message/.stack otherwise).
function serializeError(err) {
  if (!err) return err;
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return err;
}

let writeQueue = Promise.resolve();

function write(level, message, meta) {
  const time = new Date().toISOString();

  const consoleFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  consoleFn(`[${time}] [${level.toUpperCase()}] ${message}`, meta ? meta : '');

  const line = `${JSON.stringify({ time, level, message, ...(meta ? { meta } : {}) })}\n`;
  const lineBytes = Buffer.byteLength(line, 'utf8');

  writeQueue = writeQueue
    .then(async () => {
      await rotateIfNeeded(lineBytes);
      const handle = await getHandle();
      await handle.write(line, null, 'utf8');
      approxLogBytes += lineBytes;
    })
    .catch((err) => {
      // Logging must never crash or block the app -- the console line above still landed.
      console.error('Failed to write to log file:', err.message);
    });
}

module.exports = {
  info: (message, meta) => write('info', message, meta),
  warn: (message, meta) => write('warn', message, meta),
  error: (message, meta) => write('error', message, meta),
  serializeError,
  LOG_PATH,
};
