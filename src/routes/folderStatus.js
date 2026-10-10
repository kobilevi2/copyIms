// Split out from /api/browse so that computing a folder's recursive "fully
// copied" status (a full subtree walk) never blocks the main image listing
// from showing up. The frontend fetches this separately, per folder tile,
// after the grid already renders.

const express = require('express');
const fs = require('fs');
const { loadConfig } = require('../config');
const { resolveSafe, SafetyError } = require('../fsSafety');
const { isSubtreeFullyCopied } = require('../imageScan');
const logger = require('../logger');

const router = express.Router();

router.get('/folder-status', async (req, res) => {
  const config = loadConfig();
  if (!config.originRoot || !config.targetRoot) {
    return res.status(400).json({ error: 'Origin and target roots are not configured yet' });
  }

  const rel = req.query.rel || '';
  let absDir;
  try {
    absDir = resolveSafe(config.originRoot, rel);
  } catch (err) {
    if (err instanceof SafetyError) return res.status(400).json({ error: err.message });
    logger.error('Unexpected error resolving folder-status path', { rel, error: logger.serializeError(err) });
    return res.status(500).json({ error: 'Unexpected server error' });
  }

  let stat;
  try {
    stat = fs.statSync(absDir);
  } catch (err) {
    return res.status(400).json({ error: 'Folder not found' });
  }
  if (!stat.isDirectory()) {
    return res.status(400).json({ error: 'Not a directory' });
  }

  try {
    const fullyCopied = await isSubtreeFullyCopied(absDir, config.targetRoot, rel, config.convertHeic);
    res.json({ rel, fullyCopied });
  } catch (err) {
    logger.error('Failed to compute folder status', { rel, error: logger.serializeError(err) });
    res.status(500).json({ error: 'Failed to compute folder status' });
  }
});

module.exports = router;
