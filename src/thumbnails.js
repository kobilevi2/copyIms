// On-disk thumbnail cache for the image grid. Never touches the user's origin
// or target trees — everything lives under ./data/thumbnails.
//
// Each thumbnail is keyed by a hash of the source file's absolute path, size,
// and mtime (not by its relative path), so:
//   - switching the origin root to a different tree that happens to share
//     relative paths can never serve the wrong thumbnail, and
//   - editing/replacing a source photo naturally invalidates its old
//     thumbnail (new mtime -> new hash -> regenerated on next view) without
//     any manual cache-busting.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const { needsHeicConversion } = require('./imageScan');
const { decodeHeicToJpegBuffer, THUMBNAIL_DECODE_QUALITY } = require('./heicConversion');

const THUMB_DIR = path.join(__dirname, '..', 'data', 'thumbnails');
const THUMB_MAX_DIMENSION = 320;
const THUMB_QUALITY = 78;

function thumbnailPathFor(absSourcePath, stat) {
  const key = `${absSourcePath}|${stat.size}|${stat.mtimeMs}`;
  const hash = crypto.createHash('sha1').update(key).digest('hex');
  return path.join(THUMB_DIR, `${hash}.jpg`);
}

// Returns the absolute path to a cached thumbnail JPEG for absSourcePath,
// generating (and caching) it first if needed.
async function getThumbnailPath(absSourcePath) {
  const stat = fs.statSync(absSourcePath);
  const thumbPath = thumbnailPathFor(absSourcePath, stat);

  if (fs.existsSync(thumbPath)) {
    return thumbPath;
  }

  fs.mkdirSync(THUMB_DIR, { recursive: true });

  // Render to a per-request temp file, then rename into place, so concurrent
  // requests for the same not-yet-cached image never serve a half-written file.
  const tmpPath = `${thumbPath}.tmp-${process.pid}-${Date.now()}`;

  // Sharp/libvips can't be relied on to decode HEIC/HEIF (licensing means
  // it's not always bundled), so decode those via heic-convert first and
  // hand sharp an already-JPEG buffer to resize like anything else.
  const sharpInput = needsHeicConversion(absSourcePath)
    ? await decodeHeicToJpegBuffer(absSourcePath, THUMBNAIL_DECODE_QUALITY)
    : absSourcePath;

  await sharp(sharpInput, {
    // These are the user's own trusted local files, not untrusted uploads --
    // sharp's defaults are tuned for the latter and are too strict here:
    //   - limitInputPixels rejects large-but-legitimate scans (e.g. big TIFFs)
    //     with "Input image exceeds pixel limit".
    //   - failOn:'error' (the default) turns harmless format quirks in old
    //     files (e.g. a non-null-terminated TIFF tag from an old scanner)
    //     into hard failures instead of just proceeding.
    limitInputPixels: false,
    failOn: 'none',
  })
    .rotate() // respect EXIF orientation
    .resize(THUMB_MAX_DIMENSION, THUMB_MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: THUMB_QUALITY })
    .toFile(tmpPath);

  try {
    fs.renameSync(tmpPath, thumbPath);
  } catch (err) {
    // Windows can throw EPERM/EBUSY here if another concurrent request (e.g.
    // the background warmer and an on-demand view racing for the same
    // not-yet-cached image) already renamed its own tmp file into place a
    // moment earlier. If the destination exists now, that's a success --
    // just clean up our now-redundant tmp file instead of failing the request.
    if (fs.existsSync(thumbPath)) {
      fs.unlink(tmpPath, () => {}); // best-effort; a stray tmp file isn't harmful
    } else {
      throw err;
    }
  }

  return thumbPath;
}

module.exports = { getThumbnailPath, THUMB_DIR };
