// Load/save the persisted app config (origin root, target root, continue-from-last flag).
// Stored as a plain JSON file so the app remembers settings across restarts.

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

const DEFAULT_CONFIG = {
  originRoot: '',
  targetRoot: '',
  continueFromLast: false,
  convertHeic: true,
};

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch (err) {
    // Missing file (first run) or corrupted JSON — fall back to defaults rather than crashing.
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(config) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const toSave = {
    originRoot: config.originRoot || '',
    targetRoot: config.targetRoot || '',
    continueFromLast: !!config.continueFromLast,
    convertHeic: config.convertHeic === undefined ? true : !!config.convertHeic,
  };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(toSave, null, 2), 'utf8');
  return toSave;
}

module.exports = { loadConfig, saveConfig, DEFAULT_CONFIG };
