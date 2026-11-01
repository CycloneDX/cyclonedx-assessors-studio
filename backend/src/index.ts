import { createApp } from './app.js';
import { getConfig, setJwtSecret, validateStartupConfig } from './config/index.js';
import { initializeDatabase, closeDatabase } from './db/connection.js';
import { runMigrations } from './db/migrate.js';
import { seedDefaultRolesAndPermissions } from './db/seed.js';
import { bootstrapJwtSecret } from './db/jwt-secret.js';
import { bootstrapRegistrationModeTracking } from './db/registration-mode.js';
import { initializeStorage } from './storage/index.js';
import { initializeEventSystem, shutdownEventSystem } from './events/index.js';
import { startDomainGaugeRefresh, stopDomainGaugeRefresh } from './metrics/index.js';
import { startHealthChecks, stopHealthChecks } from './routes/health.js';
import { startSessionCleanup, stopSessionCleanup } from './services/session-cleanup.js';
import { initializeEncryption } from './utils/encryption.js';
import { logger } from './utils/logger.js';

const config = getConfig();
const app = createApp();

// Graceful shutdown
const gracefulShutdown = async (signal: string) => {
  logger.info(`Received ${signal}, starting graceful shutdown`);

  try {
    stopDomainGaugeRefresh();
    stopHealthChecks();
    stopSessionCleanup();
    await shutdownEventSystem();
    logger.info('Event system shut down');
    await closeDatabase();
    logger.info('Database connection closed');
  } catch (error) {
    logger.error('Error during shutdown', { error });
  }

  process.exit(0);
};

// A built artifact started without NODE_ENV would run with development
// defaults (no Secure cookie unless APP_URL is https, open registration
// without the acknowledgement). Refuse rather than run weakened (security
// review W4). Source runs (tsx, tests) are unaffected.
if (!process.env.NODE_ENV && import.meta.url.includes('/dist/')) {
  console.error('NODE_ENV is not set. Set NODE_ENV=production (or development) explicitly to start the server.');
  process.exit(1);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// A throw outside any request handler leaves the process in an unknown
// state. Log it with context, then exit non-zero so the supervisor
// (Docker restart policy / systemd) starts a clean instance.
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception; exiting', { error });
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection; exiting', { reason });
  process.exit(1);
});

// Start server
async function start() {
  try {
    // Refuse to boot when the operator has asked for metrics to be
    // exposed but has not protected the endpoint. Caught early so the
    // process fails loudly in container orchestrators instead of
    // silently serving Prometheus counters unauthenticated.
    validateStartupConfig(config);

    logger.info('Initializing database...');
    await initializeDatabase();
    await runMigrations();
    await seedDefaultRolesAndPermissions();
    logger.info('Database initialized');

    // Resolve the JWT signing secret before any request can hit the
    // server. Uses JWT_SECRET from the environment when set, otherwise
    // loads or generates a value stored in the app_config table.
    const jwtSecret = await bootstrapJwtSecret();
    setJwtSecret(jwtSecret);

    // Reconcile REGISTRATION_MODE against the last-known value in
    // app_config and emit a config_change audit row on drift (F15).
    // Runs after migrations so the audit_log CHECK constraint includes
    // the config_change action value.
    await bootstrapRegistrationModeTracking();

    logger.info('Initializing encryption...');
    const { getDatabase } = await import('./db/connection.js');
    await initializeEncryption(getDatabase());
    logger.info('Encryption initialized');

    logger.info('Initializing storage...');
    initializeStorage();
    logger.info('Storage initialized');

    logger.info('Initializing event system...');
    await initializeEventSystem();

    // Print the first-run setup token while no admin exists.
    {
      const { checkSetupComplete } = await import('./middleware/setup.js');
      if (!(await checkSetupComplete())) {
        const { announceSetupToken } = await import('./utils/setup-token.js');
        announceSetupToken();
      }
    }
    logger.info('Event system initialized');

    // Start periodic background tasks
    if (config.METRICS_ENABLED) {
      startDomainGaugeRefresh();
      logger.info('Prometheus domain gauge refresh started');
    }
    startHealthChecks();
    startSessionCleanup();

    const port = config.PORT;
    app.listen(port, () => {
      logger.info(`Server started on port ${port}`, {
        environment: config.NODE_ENV,
        databaseProvider: config.DATABASE_PROVIDER,
        metricsEnabled: config.METRICS_ENABLED,
      });
    });
  } catch (error) {
    logger.error('Failed to start server', { error });
    process.exit(1);
  }
}

start();

export default app;
