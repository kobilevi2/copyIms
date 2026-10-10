const express = require('express');
const fs = require('fs');
const path = require('path');
const { loadConfig } = require('../config');
const { resolveSafe, SafetyError } = require('../fsSafety');
const { isImageFile, needsHeicConversion, mirroredRelPath, flattenedRelPath, resolveMergeRoot } = require('../imageScan');
const { convertHeicToJpegFile } = require('../heicConversion');
const logger = require('../logger');

const router = express.Router();

router.post('/copy', async (req, res) => {
  const config = loadConfig();
  if (!config.originRoot || !config.targetRoot) {
    return res.status(400).json({ error: 'Origin and target roots are not configured yet' });
  }

  const rel = (req.body && req.body.rel) || '';
  if (!isImageFile(rel)) {
    return res.status(400).json({ error: 'Not an image path' });
  }

  // "Merge subdirectories" mode: mergeRoot is the folder the user was
  // viewing merged, so a nested image's destination collapses to directly
  // under that folder (see flattenedRelPath) instead of mirroring its real
  // nested location.
  const mergeRoot = req.body && typeof req.body.mergeRoot === 'string' ? req.body.mergeRoot : null;
  const flattenedRel = mergeRoot !== null ? flattenedRelPath(resolveMergeRoot(config.originRoot, mergeRoot), rel) : rel;

  const willConvert = config.convertHeic && needsHeicConversion(rel);
  const destRel = mirroredRelPath(flattenedRel, config.convertHeic); // same as rel unless flattening/converting

  let srcAbs;
  let destAbs;
  try {
    srcAbs = resolveSafe(config.originRoot, rel);
    destAbs = resolveSafe(config.targetRoot, destRel);
  } catch (err) {
    if (err instanceof SafetyError) return res.status(400).json({ error: err.message });
    logger.error('Unexpected error resolving copy path', { rel, error: logger.serializeError(err) });
    return res.status(500).json({ error: 'Unexpected server error' });
  }

  let srcStat;
  try {
    srcStat = fs.statSync(srcAbs);
  } catch (err) {
    return res.status(404).json({ error: 'Source image not found' });
  }
  if (!srcStat.isFile()) {
    return res.status(400).json({ error: 'Source is not a file' });
  }

  if (fs.existsSync(destAbs)) {
    return res.json({ ok: true, alreadyCopied: true, converted: willConvert });
  }

  try {
    fs.mkdirSync(path.dirname(destAbs), { recursive: true });
    if (willConvert) {
      // iPhone HEIC/HEIF isn't viewable in most places -- convert to JPEG
      // (near-lossless) instead of copying the raw file.
      await convertHeicToJpegFile(srcAbs, destAbs);
    } else {
      fs.copyFileSync(srcAbs, destAbs);
    }
  } catch (err) {
    const message = willConvert ? `Failed to convert HEIC image: ${err.message}` : 'Failed to copy file';
    logger.error(willConvert ? 'HEIC conversion failed' : 'Copy failed', { rel, destRel, error: logger.serializeError(err) });
    return res.status(500).json({ error: message });
  }

  logger.info('Copied file', { rel, destRel, converted: willConvert });
  res.json({ ok: true, alreadyCopied: false, converted: willConvert });
});

module.exports = router;
