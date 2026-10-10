const express = require('express');
const path = require('path');

const configRoutes = require('./src/routes/config');
const browseRoutes = require('./src/routes/browse');
const folderStatusRoutes = require('./src/routes/folderStatus');
const imageRoutes = require('./src/routes/image');
const thumbnailRoutes = require('./src/routes/thumbnail');
const thumbnailStatusRoutes = require('./src/routes/thumbnailStatus');
const copyRoutes = require('./src/routes/copy');
const resumeRoutes = require('./src/routes/resume');
const pickFolderRoutes = require('./src/routes/pickFolder');
const { loadConfig } = require('./src/config');
const { startWarming } = require('./src/thumbnailWarmer');
const logger = require('./src/logger');

// Last-resort safety nets: log the full error and keep the server alive
// instead of the whole process dying (which would surface to the browser as
// "Failed to fetch" for every request until manually restarted). A crash
// here means some code path threw/rejected without being caught locally --
// data/app.log will have the details.
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: logger.serializeError(err) });
});
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { error: logger.serializeError(reason) });
});

const PORT = 4000;
// Loopback only: the API can read anything under the origin root, so it must
// not be reachable from other machines on the network.
const HOST = '127.0.0.1';

const app = express();
app.use(express.json());

app.use('/api', configRoutes);
app.use('/api', browseRoutes);
app.use('/api', folderStatusRoutes);
app.use('/api', imageRoutes);
app.use('/api', thumbnailRoutes);
app.use('/api', thumbnailStatusRoutes);
app.use('/api', copyRoutes);
app.use('/api', resumeRoutes);
app.use('/api', pickFolderRoutes);

app.use(express.static(path.join(__dirname, 'public')));

// Final safety net for anything a route didn't handle itself (e.g. a
// synchronous throw in a non-async handler that Express forwards here).
// Without this, Express's default error page is HTML, which the frontend's
// fetchJson() can't parse into a useful message.
app.use((err, req, res, next) => {
  logger.error('Unhandled request error', { path: req.path, error: logger.serializeError(err) });
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Internal server error' });
});

const httpServer = app.listen(PORT, HOST, () => {
  logger.info(`copyIms listening on http://localhost:${PORT}`);

  // If a root was already configured from a previous session, start warming
  // its thumbnail cache right away instead of waiting for the user to Save again.
  const config = loadConfig();
  startWarming(config.originRoot);
});

// A second copy of the app (e.g. double-clicking start.bat while one is
// already running) hits this, not the generic uncaughtException handler
// above -- give it a message that says what's actually going on instead of
// a raw stack trace, and exit quietly rather than sitting there half-alive.
httpServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\ncopyIms is already running -- open http://localhost:${PORT} in your browser.\n(Port ${PORT} is already in use by another copy of this server.)\n`);
    process.exit(1);
  }
  logger.error('Server failed to start', { error: logger.serializeError(err) });
  process.exit(1);
});
