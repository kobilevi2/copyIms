const express = require('express');
const fs = require('fs');
const { loadConfig, saveConfig } = require('../config');
const { startWarming } = require('../thumbnailWarmer');
const logger = require('../logger');

const router = express.Router();

function validateRoot(label, dirPath) {
  if (!dirPath || typeof dirPath !== 'string' || !dirPath.trim()) {
    return `${label} is required`;
  }
  let stat;
  try {
    stat = fs.statSync(dirPath);
  } catch (err) {
    return `${label} does not exist`;
  }
  if (!stat.isDirectory()) {
    return `${label} is not a directory`;
  }
  return null;
}

router.get('/config', (req, res) => {
  res.json(loadConfig());
});

router.post('/config', (req, res) => {
  const { originRoot, targetRoot, continueFromLast, convertHeic } = req.body || {};

  const originError = validateRoot('Origin root', originRoot);
  if (originError) return res.status(400).json({ error: originError });

  const targetError = validateRoot('Target root', targetRoot);
  if (targetError) return res.status(400).json({ error: targetError });

  const saved = saveConfig({ originRoot, targetRoot, continueFromLast, convertHeic });
  logger.info('Config saved', saved);
  startWarming(saved.originRoot); // fire-and-forget background thumbnail sweep
  res.json({ ok: true, ...saved });
});

module.exports = router;
