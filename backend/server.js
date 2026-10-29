'use strict';

const http = require('node:http');
const { loadConfig } = require('./src/config');
const { RateLimiter } = require('./src/rateLimit');
const { createMailer } = require('./src/mail');
const { createHandler } = require('./src/app');

let config;
try {
  config = loadConfig(process.env);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const mailer = createMailer(config);
const ipLimiter = new RateLimiter(config.ipRules);
const globalLimiter = new RateLimiter(config.globalRules);
ipLimiter.startSweeper();

const server = http.createServer(createHandler({ config, mailer, ipLimiter, globalLimiter }));

server.headersTimeout = 15 * 1000;
server.requestTimeout = 20 * 1000;
server.keepAliveTimeout = 5 * 1000;
server.maxHeadersCount = 50;

server.on('clientError', (error, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  else socket.destroy();
});

server.listen(config.port, '0.0.0.0', () => {
  console.log(`AB Smart Solution API listening on port ${config.port} (mail mode: ${mailer.mode})`);
  // Non-fatal startup check so a wrong password / token shows up in the logs immediately.
  mailer
    .verify()
    .then(() => console.log('Mail connection verified'))
    .catch((error) =>
      console.error('WARNING: mail connection check failed:', error && (error.code || error.message))
    );
});

function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10 * 1000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  console.error('unhandledRejection:', reason && reason.message ? reason.message : reason);
});
