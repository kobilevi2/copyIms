// Guards against path traversal: every filesystem route resolves its `rel` query/body
// param against a configured root through here, and rejects anything that would
// escape that root (via "..", absolute-path overrides, or mixed separators).

const path = require('path');

class SafetyError extends Error {}

function resolveSafe(rootAbs, rel) {
  if (typeof rel !== 'string') rel = '';
  if (rel.indexOf('\0') !== -1) {
    throw new SafetyError('Invalid path');
  }

  const rootResolved = path.resolve(rootAbs);
  const candidate = path.resolve(rootResolved, rel);

  if (candidate !== rootResolved && !candidate.startsWith(rootResolved + path.sep)) {
    throw new SafetyError('Path escapes configured root');
  }

  return candidate;
}

module.exports = { resolveSafe, SafetyError };
