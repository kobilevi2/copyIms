// Background thumbnail pre-warming. Triggered whenever the origin root is
// (re)configured or the server starts up with one already saved, so that by
// the time the user browses into a folder its thumbnails are usually already
// cached instead of generating on first view.
//
// Uses async (fs/promises) directory reads throughout, so a big tree walk
// never blocks the Express event loop -- browsing/copying stay responsive
// while a sweep is in progress. Fully idempotent: cheap to call repeatedly
// since getThumbnailPath() already skips any image that's already cached.
//
// The sweep walks the tree depth-first/alphabetical by default, but whatever
// folder the user is actively browsing gets bumped to the front of the still-
// pending queue (see prioritizeFolder) -- otherwise a folder late in that
// order could sit unwarmed for a long time on a big tree. Workers also back
// off whenever there's been very recent foreground activity (a browse or
// on-demand thumbnail request): HEIC decoding in particular is CPU-bound,
// single-threaded WASM work that can't be preempted once started, so the best
// we can do is avoid *starting* a new background job right when the user is
// actively waiting on something.

const path = require('path');
const { readEntries } = require('./imageScan');
const { getThumbnailPath } = require('./thumbnails');
const logger = require('./logger');

const CONCURRENCY = 2;
const FOREGROUND_QUIET_WINDOW_MS = 250;
const FOREGROUND_BACKOFF_MS = 150;

let state = {
  root: null,
  total: 0,
  done: 0,
  failed: 0,
  running: false,
  generation: 0,
  items: [], // flat list of absolute image paths for the current sweep
  cursor: 0, // index of the next not-yet-claimed item in `items`
};

let lastForegroundActivityAt = 0;

// Called by /api/browse and /api/thumbnail on every request, so the warmer
// knows the user is actively engaged right now.
function markForegroundActivity() {
  lastForegroundActivityAt = Date.now();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getStatus() {
  const { root, total, done, failed, running, generation } = state;
  return { root, total, done, failed, running, generation };
}

async function collectImages(absDir, out) {
  let entries;
  try {
    entries = await readEntries(absDir);
  } catch (err) {
    return; // unreadable directory (permissions, deleted mid-walk, etc.) -- skip
  }
  for (const name of entries.images) {
    out.push(path.join(absDir, name));
  }
  for (const name of entries.folders) {
    await collectImages(path.join(absDir, name), out);
  }
}

async function runQueue(generation) {
  async function worker() {
    while (true) {
      if (state.generation !== generation) return; // superseded by a newer warm
      if (state.cursor >= state.items.length) return;

      const sinceActivity = Date.now() - lastForegroundActivityAt;
      if (sinceActivity < FOREGROUND_QUIET_WINDOW_MS) {
        await sleep(FOREGROUND_BACKOFF_MS);
        continue; // re-check generation/cursor/activity from the top
      }

      const absPath = state.items[state.cursor++];
      try {
        await getThumbnailPath(absPath);
      } catch (err) {
        if (state.generation === generation) state.failed += 1;
        logger.warn('Thumbnail warm failed for a file', { file: absPath, error: logger.serializeError(err) });
      }
      if (state.generation === generation) state.done += 1;
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);
}

// Fire-and-forget: kicks off (or continues) a background sweep of originRoot.
// Safe to call on every config save / server start -- a no-op restart if a
// sweep for the same root is already running, and near-instant on a rerun
// against an already-fully-cached tree.
function startWarming(originRoot) {
  if (!originRoot) return;
  if (state.running && state.root === originRoot) return;

  const generation = ++state.generation;
  state = { root: originRoot, total: 0, done: 0, failed: 0, running: true, generation, items: [], cursor: 0 };
  logger.info('Thumbnail warm sweep starting', { root: originRoot, generation });

  (async () => {
    const items = [];
    await collectImages(originRoot, items);
    if (state.generation !== generation) return; // root changed again mid-walk

    state.items = items;
    state.total = items.length;
    await runQueue(generation);

    if (state.generation === generation) {
      state.running = false;
      logger.info('Thumbnail warm sweep finished', {
        root: originRoot,
        total: state.total,
        done: state.done,
        failed: state.failed,
      });
    }
  })().catch((err) => {
    logger.error('Thumbnail warm sweep crashed', { root: originRoot, error: logger.serializeError(err) });
    if (state.generation === generation) state.running = false;
  });
}

// Bumps the folder the user is currently browsing (and everything under it)
// to the front of the still-pending queue, ahead of whatever the sweep would
// otherwise have gotten to next. Cheap and safe to call on every folder
// navigation -- a synchronous array partition, no-op if there's nothing
// pending to reorder (nothing left in this folder, or warming isn't running
// against this root).
function prioritizeFolder(originRoot, rel) {
  if (!state.running || state.root !== originRoot) return;
  if (state.cursor >= state.items.length) return;

  const targetAbs = path.join(originRoot, rel || '');
  const prefix = targetAbs + path.sep;

  const remaining = state.items.slice(state.cursor);
  const matching = [];
  const rest = [];
  for (const absPath of remaining) {
    if (absPath === targetAbs || absPath.startsWith(prefix)) {
      matching.push(absPath);
    } else {
      rest.push(absPath);
    }
  }

  if (matching.length === 0) return; // this folder's images are already done or already up front

  state.items = state.items.slice(0, state.cursor).concat(matching, rest);
}

module.exports = { startWarming, prioritizeFolder, markForegroundActivity, getStatus };
