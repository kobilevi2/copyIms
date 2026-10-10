// Converts iPhone HEIC/HEIF photos to JPEG. Reuses the same approach validated
// in the standalone convertIphoneImages tool: heic-convert is a WASM-based
// decoder (no native/build-tool dependency), so `npm install` stays simple.

const fsp = require('fs').promises;
const heicConvert = require('heic-convert');

// Copy-time conversion: as close to lossless as a JPEG re-encode allows.
const COPY_QUALITY = 1;
// Thumbnail-only decode: a ~320px preview doesn't need a full-quality decode.
const THUMBNAIL_DECODE_QUALITY = 0.6;

async function decodeHeicToJpegBuffer(absSourcePath, quality) {
  const inputBuffer = await fsp.readFile(absSourcePath);
  const outputBuffer = await heicConvert({
    buffer: inputBuffer,
    format: 'JPEG',
    quality,
  });
  return Buffer.from(outputBuffer);
}

// Writes the converted JPEG directly -- no further re-encoding -- so the
// "lossless / near-lossless" copy-time conversion isn't degraded by a second
// compression pass.
async function convertHeicToJpegFile(srcAbsPath, destAbsPath) {
  const buffer = await decodeHeicToJpegBuffer(srcAbsPath, COPY_QUALITY);
  await fsp.writeFile(destAbsPath, buffer);
}

module.exports = {
  decodeHeicToJpegBuffer,
  convertHeicToJpegFile,
  THUMBNAIL_DECODE_QUALITY,
};
