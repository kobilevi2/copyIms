const express = require('express');
const fs = require('fs');
const path = require('path');
const { loadConfig } = require('../config');
const { resolveSafe, SafetyError } = require('../fsSafety');
const { isImageFile, mimeTypeFor } = require('../imageScan');
const { getThumbnailPath } = require('../thumbnails');
const { markForegroundActivity } = require('../thumbnailWarmer');
const logger = require('../logger');

const router = express.Router();

router.get('/thumbnail', async (req, res) => {
  const config = loadConfig();
  if (!config.originRoot) {
    return res.status(400).json({ error: 'Origin root is not configured yet' });
  }

  const rel = req.query.rel || '';
  if (!isImageFile(rel)) {
    return res.status(400).json({ error: 'Not an image path' });
  }

  markForegroundActivity();

  let absPath;
  try {
    absPath = resolveSafe(config.originRoot, rel);
  } catch (err) {
    if (err instanceof SafetyError) return res.status(400).json({ error: err.message });
    logger.error('Unexpected error resolving thumbnail path', { rel, error: logger.serializeError(err) });
    return res.status(500).json({ error: 'Unexpected server error' });
  }

  let stat;
  try {
    stat = fs.statSync(absPath);
  } catch (err) {
    return res.status(404).json({ error: 'Image not found' });
  }
  if (!stat.isFile()) {
    return res.status(400).json({ error: 'Not a file' });
  }

  // SVGs are already small vector files -- no benefit to rasterizing/resizing them.
  if (path.extname(absPath).toLowerCase() === '.svg') {
    return res.type('image/svg+xml').sendFile(absPath);
  }

  try {
    const thumbPath = await getThumbnailPath(absPath);
    res.type('image/jpeg');
    return res.sendFile(thumbPath, (err) => {
      if (err && !res.headersSent) {
        res.status(500).json({ error: 'Failed to read thumbnail' });
      }
    });
  } catch (err) {
    // Thumbnail generation failed (corrupt/unsupported file, etc.) -- fall back
    // to serving the original so the tile still shows something.
    logger.warn('Thumbnail generation failed, falling back to original', { rel, error: logger.serializeError(err) });
    res.type(mimeTypeFor(absPath));
    return res.sendFile(absPath, (sendErr) => {
      if (sendErr && !res.headersSent) {
        res.status(500).json({ error: 'Failed to read image' });
      }
    });
  }
});

module.exports = router;
