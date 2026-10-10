// Directory listing + the two tree-walk algorithms used to figure out what's
// already copied ("fully copied" folder badges, and the resume-folder search).
// "Copied" status is always computed live against the target tree on disk —
// there is no separate database, so it self-heals if the target folder is
// edited by hand.
//
// Everything here uses async (fs/promises) I/O, not the *Sync variants. These
// walks can be recursive over a whole subtree, and fs.readdirSync et al. are
// genuinely blocking -- they freeze Node's single thread for the entire walk,
// during which the server can't respond to *any* other request (not even a
// simple GET /api/config). Using the async equivalents lets the event loop
// interleave other requests between directory reads.

const fsp = require('fs/promises');
const path = require('path');

const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.tif', '.tiff', '.heic', '.heif',
]);

// iPhone's default photo format -- not viewable in a browser, so these get
// converted to JPEG on copy (see heicConversion.js) instead of copied as-is.
const HEIC_EXTENSIONS = new Set(['.heic', '.heif']);

const MIME_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
};

function isImageFile(name) {
  return IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase());
}

function needsHeicConversion(name) {
  return HEIC_EXTENSIONS.has(path.extname(name).toLowerCase());
}

// What a given origin-relative path should be named once it lands in the
// target tree: unchanged, unless it needs HEIC->JPEG conversion AND the
// convertHeic setting is on, in which case the extension becomes .jpg. Used
// everywhere "does the mirrored file already exist in target" is checked, so
// copied/fully-copied/resume all agree on where a file actually ends up.
function mirroredRelPath(rel, convertHeic) {
  if (!convertHeic || !needsHeicConversion(rel)) return rel;
  const dir = path.dirname(rel);
  const converted = path.basename(rel, path.extname(rel)) + '.jpg';
  return dir && dir !== '.' ? path.join(dir, converted) : converted;
}

function mimeTypeFor(absPath) {
  return MIME_TYPES[path.extname(absPath).toLowerCase()] || 'application/octet-stream';
}

// Path segments of originalRel (an origin-root-relative path) counted from
// mergeRootRel instead of the origin root, with the filename dropped -- e.g.
// mergeRootRel "A", originalRel "A/B1/C1/photo.jpg" -> ["B1", "C1"]. Empty
// array for a direct child of the merge root.
function folderSegmentsWithinMergeRoot(mergeRootRel, originalRel) {
  const prefix = mergeRootRel ? mergeRootRel + path.sep : '';
  const relativeToMergeRoot = originalRel.startsWith(prefix) ? originalRel.slice(prefix.length) : originalRel;
  const segments = relativeToMergeRoot.split(path.sep).filter(Boolean);
  segments.pop(); // drop the filename, keep just the in-between folder names
  return segments;
}

// For "merge subdirectories" mode: what a nested image's path should collapse
// to directly under mergeRootRel. A direct child of the merge root is left
// alone (e.g. "A/photo.jpg" stays "A/photo.jpg"). Anything deeper has its
// in-between folder names folded into the filename (e.g. "A/B1/C1/photo.jpg"
// -> "A/B1_C1_photo.jpg") -- this is what keeps two different subfolders'
// same-named files (very common with generic camera filenames like
// "IMG_0001.jpg") from colliding into one destination and silently only
// getting one of them copied, and it's transparent about where a flattened
// file actually came from.
function flattenedRelPath(mergeRootRel, originalRel) {
  const segments = folderSegmentsWithinMergeRoot(mergeRootRel, originalRel);
  if (segments.length === 0) return originalRel; // already a direct child, nothing to flatten

  const filename = path.basename(originalRel);
  const flatName = `${segments.join('_')}_${filename}`;
  return mergeRootRel ? path.join(mergeRootRel, flatName) : flatName;
}

// What mergeRootRel (the rel of the folder the user turned merge on for)
// should actually be used as for destination purposes. Merging at Home
// (mergeRootRel === '', i.e. the configured origin root itself) has no
// folder name in rel-path space to nest the flattened output under --
// without this fallback, flattenedRelPath would return bare filenames with
// no containing folder at all, and they'd spill directly into the target
// root as loose files indistinguishable from anything else already there.
// Falling back to the origin root's own folder name keeps them contained
// the same way merging inside any other subfolder already does.
function resolveMergeRoot(originRoot, mergeRootRel) {
  if (mergeRootRel) return mergeRootRel;
  return path.basename(originRoot) || mergeRootRel;
}

// Recursively collects every image under absDir (depth-first, alphabetical,
// own images before subfolders -- same order used everywhere else in the
// app), returning {name, rel} for each.
async function collectImagesFlat(absDir, relDir) {
  const results = [];
  const { folders, images } = await readEntries(absDir);

  for (const name of images) {
    results.push({ name, rel: path.join(relDir, name) });
  }

  for (const name of folders) {
    const childRel = path.join(relDir, name);
    const childAbs = path.join(absDir, name);
    results.push(...(await collectImagesFlat(childAbs, childRel)));
  }

  return results;
}

async function pathExists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch (err) {
    return false;
  }
}

async function readEntries(absDir) {
  const dirents = await fsp.readdir(absDir, { withFileTypes: true });
  const folders = dirents
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  const images = dirents
    .filter((d) => d.isFile() && isImageFile(d.name))
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  return { folders, images };
}

// Recursively checks whether every image anywhere under relDir already exists
// at its mirrored location under targetRoot. Vacuously true for empty folders
// or folders that contain only (fully-copied) subfolders.
async function isSubtreeFullyCopied(originAbs, targetRoot, relDir, convertHeic) {
  const { folders, images } = await readEntries(originAbs);

  for (const name of images) {
    const destPath = path.join(targetRoot, mirroredRelPath(path.join(relDir, name), convertHeic));
    if (!(await pathExists(destPath))) return false;
  }

  for (const name of folders) {
    const childRel = path.join(relDir, name);
    const childAbs = path.join(originAbs, name);
    if (!(await isSubtreeFullyCopied(childAbs, targetRoot, childRel, convertHeic))) return false;
  }

  return true;
}

// Depth-first, alphabetical search for the first folder that still has an
// uncopied image directly in it (checks the folder's own images before
// descending into subfolders). Returns null if the whole subtree is done.
async function findResumeFolder(originAbs, targetRoot, relDir, convertHeic) {
  const { folders, images } = await readEntries(originAbs);

  for (const name of images) {
    const destPath = path.join(targetRoot, mirroredRelPath(path.join(relDir, name), convertHeic));
    if (!(await pathExists(destPath))) {
      return relDir;
    }
  }

  for (const name of folders) {
    const childRel = path.join(relDir, name);
    const childAbs = path.join(originAbs, name);
    const result = await findResumeFolder(childAbs, targetRoot, childRel, convertHeic);
    if (result !== null) return result;
  }

  return null;
}

// Builds breadcrumb segments (root..current) from a relative path, e.g.
// "2019/Summer/Beach" -> [{name:"Home",rel:""},{name:"2019",rel:"2019"}, ...]
function buildBreadcrumb(rel) {
  const crumbs = [{ name: 'Home', rel: '' }];
  if (!rel) return crumbs;

  const parts = rel.split(path.sep).filter(Boolean);
  let acc = '';
  for (const part of parts) {
    acc = acc ? path.join(acc, part) : part;
    crumbs.push({ name: part, rel: acc });
  }
  return crumbs;
}

module.exports = {
  IMAGE_EXTENSIONS,
  HEIC_EXTENSIONS,
  MIME_TYPES,
  isImageFile,
  needsHeicConversion,
  mirroredRelPath,
  mimeTypeFor,
  pathExists,
  readEntries,
  isSubtreeFullyCopied,
  findResumeFolder,
  buildBreadcrumb,
  folderSegmentsWithinMergeRoot,
  flattenedRelPath,
  resolveMergeRoot,
  collectImagesFlat,
};
