const express = require('express');
const { getStatus } = require('../thumbnailWarmer');

const router = express.Router();

router.get('/thumbnail-status', (req, res) => {
  res.json(getStatus());
});

module.exports = router;
