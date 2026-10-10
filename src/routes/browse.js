const express = require('express');
const fs = require('fs');
const path = require('path');
const { loadConfig } = require('../config');
const { resolveSafe, SafetyError } = require('../fsSafety');
const {
  readEntries,
  buildBreadcrumb,
  mirroredRelPath,
  needsHeicConversion,
  collectImagesFlat,
  flattenedRelPath,
  folderSegmentsWithinMergeRoot,
  resolveMergeRoot,
} = require('../imageScan');
const { prioritizeFolder, markForegroundActivity } = require('../thumbnailWarmer');
const logger = require('../logger');

const router = express.Router();

router.get('/browse', async (req, res) => {
  const config = loadConfig();
  if (!config.originRoot || !config.targetRoot) {
    return res.status(400).json({ error: 'Origin and target roots are not configured yet' });
  }

  const rel = req.query.rel || '';
  const merge = req.query.merge === 'true';

  let absDir;
  try {
    absDir = resolveSafe(config.originRoot, rel);
  } catch (err) {
    if (err instanceof SafetyError) return res.status(400).json({ error: err.message });
    logger.error('Unexpected error resolving browse path', { rel, error: logger.serializeError(err) });
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

  // Tell the background warmer the user is looking at this folder now (jumps
  // it to the front of the queue) and that there's live foreground activity
  // (so the warmer backs off briefly instead of competing for CPU/thread-pool
  // slots against the thumbnails this folder is about to request).
  prioritizeFolder(config.originRoot, rel);
  markForegroundActivity();

  try {
    if (merge) {
      // "Merge subdirectories": one flat list of every image anywhere under
      // this folder, no folder tiles (there's nothing to navigate into --
      // everything's already shown). Copying uses the flattened destination
      // path (see flattenedRelPath), so the "copied" check here has to too.
      const flatImages = await collectImagesFlat(absDir, rel);
      const effectiveMergeRoot = resolveMergeRoot(config.originRoot, rel);

      const imageEntries = flatImages.map(({ name, rel: childRel }) => {
        const destRel = mirroredRelPath(flattenedRelPath(effectiveMergeRoot, childRel), config.convertHeic);
        const destPath = path.join(config.targetRoot, destRel);
        const sourceFolder = folderSegmentsWithinMergeRoot(rel, childRel).join('/');
        return {
          name,
          rel: childRel,
          copied: fs.existsSync(destPath),
          convertsToJpg: config.convertHeic && needsHeicConversion(name),
          sourceFolder, // '' for a direct child of the merge root
        };
      });

      return res.json({
        rel,
        merged: true,
        breadcrumb: buildBreadcrumb(rel),
        folders: [],
        images: imageEntries,
      });
    }

    const { folders, images } = await readEntries(absDir);

    // Folder tiles intentionally do NOT include a "fully copied" badge here --
    // computing that recursively for every visible subfolder would make this
    // response as slow as the whole subtree, which defeats the point of
    // showing the current folder's images as fast as possible. The frontend
    // fetches that separately per folder via GET /api/folder-status.
    const folderEntries = folders.map((name) => ({ name, rel: path.join(rel, name) }));

    const imageEntries = images.map((name) => {
      const childRel = path.join(rel, name);
      const destPath = path.join(config.targetRoot, mirroredRelPath(childRel, config.convertHeic));
      return {
        name,
        rel: childRel,
        copied: fs.existsSync(destPath),
        convertsToJpg: config.convertHeic && needsHeicConversion(name),
      };
    });

    res.json({
      rel,
      merged: false,
      breadcrumb: buildBreadcrumb(rel),
      folders: folderEntries,
      images: imageEntries,
    });
  } catch (err) {
    logger.error('Failed to browse folder', { rel, merge, error: logger.serializeError(err) });
    res.status(500).json({ error: 'Failed to read folder' });
  }
});

module.exports = router;
