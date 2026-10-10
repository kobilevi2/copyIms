const express = require('express');
const { loadConfig } = require('../config');
const { findResumeFolder } = require('../imageScan');
const logger = require('../logger');

const router = express.Router();

router.get('/resume', async (req, res) => {
  const config = loadConfig();
  if (!config.originRoot || !config.targetRoot) {
    return res.json({ rel: '' });
  }

  try {
    const result = await findResumeFolder(config.originRoot, config.targetRoot, '', config.convertHeic);
    res.json({ rel: result === null ? '' : result });
  } catch (err) {
    logger.error('Failed to compute resume folder', { error: logger.serializeError(err) });
    res.status(500).json({ error: 'Failed to compute resume folder' });
  }
});

module.exports = router;
