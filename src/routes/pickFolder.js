// Native Windows folder-browser dialog, so the user doesn't have to type
// absolute paths by hand. Runs as an inline PowerShell -Command (not a .ps1
// script file), which sidesteps script-execution-policy restrictions.

const express = require('express');
const { execFile } = require('child_process');
const logger = require('../logger');

const router = express.Router();

// Reads the initial folder from an env var rather than interpolating it into
// the -Command string, to avoid any quoting/injection concerns.
const PS_SCRIPT = `
Add-Type -AssemblyName System.Windows.Forms | Out-Null
$initial = $env:COPYIMS_INITIAL_PATH
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Select a folder'
$dialog.ShowNewFolderButton = $true
if ($initial -and (Test-Path -LiteralPath $initial -PathType Container)) {
  $dialog.SelectedPath = $initial
}
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.StartPosition = 'CenterScreen'
$result = $dialog.ShowDialog($owner)
$owner.Dispose()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
  Write-Output $dialog.SelectedPath
}
`;

function pickFolder(initialPath) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-STA', '-Command', PS_SCRIPT],
      { env: { ...process.env, COPYIMS_INITIAL_PATH: initialPath || '' } },
      (err, stdout) => {
        if (err) return reject(err);
        const selected = stdout.trim();
        resolve(selected || null);
      }
    );
  });
}

router.get('/pick-folder', async (req, res) => {
  if (process.platform !== 'win32') {
    return res.status(400).json({ error: 'Folder browser is only available on Windows. Enter the path directly.' });
  }
  const initial = req.query.initial || '';
  try {
    const selected = await pickFolder(initial);
    res.json({ path: selected });
  } catch (err) {
    logger.error('Folder picker dialog failed', { error: logger.serializeError(err) });
    res.status(500).json({ error: 'Could not open the folder picker: ' + err.message });
  }
});

module.exports = router;
