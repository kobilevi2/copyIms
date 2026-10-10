const express = require('express');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { loadConfig } = require('../config');
const { resolveSafe, SafetyError } = require('../fsSafety');
const { isImageFile, mimeTypeFor, needsHeicConversion } = require('../imageScan');
const { decodeHeicToJpegBuffer } = require('../heicConversion');
const logger = require('../logger');

const router = express.Router();

// Formats Chrome/Edge can't display natively. For the large preview these are
// converted to JPEG on the fly instead of being sent as-is.
const NEEDS_BROWSER_CONVERSION = new Set(['.heic', '.heif', '.tif', '.tiff']);
const PREVIEW_MAX_DIMENSION = 2560;
const PREVIEW_QUALITY = 88;
const HEIC_PREVIEW_DECODE_QUALITY = 0.9;

router.get('/image', async (req, res) => {
  const config = loadConfig();
  if (!config.originRoot) {
    return res.status(400).json({ error: 'Origin root is not configured yet' });
  }

  const rel = req.query.rel || '';
  if (!isImageFile(rel)) {
    return res.status(400).json({ error: 'Not an image path' });
  }

  let absPath;
  try {
    absPath = resolveSafe(config.originRoot, rel);
  } catch (err) {
    if (err instanceof SafetyError) return res.status(400).json({ error: err.message });
    logger.error('Unexpected error resolving image path', { rel, error: logger.serializeError(err) });
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

  if (NEEDS_BROWSER_CONVERSION.has(path.extname(absPath).toLowerCase())) {
    try {
      const sharpInput = needsHeicConversion(absPath)
        ? await decodeHeicToJpegBuffer(absPath, HEIC_PREVIEW_DECODE_QUALITY)
        : absPath;
      // Same relaxed limits as thumbnails.js -- these are the user's own files.
      const buffer = await sharp(sharpInput, { limitInputPixels: false, failOn: 'none' })
        .rotate()
        .resize(PREVIEW_MAX_DIMENSION, PREVIEW_MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: PREVIEW_QUALITY })
        .toBuffer();
      return res.type('image/jpeg').send(buffer);
    } catch (err) {
      logger.warn('Preview conversion failed', { rel, error: logger.serializeError(err) });
      return res.status(500).json({ error: 'Failed to convert image for preview' });
    }
  }

  res.type(mimeTypeFor(absPath));
  res.sendFile(absPath, (err) => {
    if (err && !res.headersSent) {
      res.status(500).json({ error: 'Failed to read image' });
    }
  });
});

module.exports = router;
