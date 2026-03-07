require('dotenv').config();

const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const logger = require('./logger');
const loggerMiddleware = require('./middlewares/logger.middleware');
const errorMiddleware = require('./middlewares/error.middleware');
const runMigrations = require('./migrationRunner');
const runSeeders = require('./seederRunner');
const { createBackup } = require('./backupManager');

const authRoutes = require('./routes/auth.routes');
const turnosRoutes = require('./routes/turnos.routes');
const clientesRoutes = require('./routes/clientes.routes');
const healthRoutes = require('./routes/health.routes');
const metricsRoutes = require('./routes/metrics.routes');
const statsRoutes = require('./routes/stats.routes');
const whatsappWebhookRoutes = require('./routes/metaWebhook.routes');
const barberPanelRoutes = require('./routes/barberPanel.routes');
const turnosService = require('./services/turnos.service');
const opsMonitoring = require('./services/opsMonitoring.service');

runMigrations();
runSeeders();

if (process.env.NODE_ENV !== 'test') {
  try {
    createBackup();
  } catch (err) {
    console.error('Error creando backup:', err);
  }

  setInterval(() => {
    try {
      createBackup();
    } catch (err) {
      console.error('Error creando backup:', err);
    }
  }, 6 * 60 * 60 * 1000); // 6 horas
}

const app = express();

// Railway/Reverse proxy: necesario para rate-limit con X-Forwarded-For
app.set('trust proxy', 1);

app.use(cors());
app.use(helmet());
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = Buffer.from(buf || []).toString('utf8');
    },
  })
);

const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000);
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 300);

const limiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  // Evita bloquear flujos normales del panel y webhooks bajo uso real.
  skip: req =>
    req.path.startsWith('/meta-webhook') ||
    req.path.startsWith('/whatsapp-webhook') ||
    req.path.startsWith('/gupshup-webhook') ||
    req.path.startsWith('/api/barber-panel') ||
    req.path.startsWith('/app') ||
    req.path.startsWith('/health') ||
    req.path.startsWith('/metrics'),
});
app.use(limiter);

// logger http
app.use(loggerMiddleware);
app.use((req, res, next) => {
  const isWebhookPath =
    req.path.startsWith('/meta-webhook') ||
    req.path.startsWith('/whatsapp-webhook') ||
    req.path.startsWith('/gupshup-webhook');

  if (!isWebhookPath) {
    next();
    return;
  }

  const startedAt = Date.now();
  res.on('finish', () => {
    opsMonitoring.recordWebhook({
      path: req.path,
      status: res.statusCode,
      latencyMs: Date.now() - startedAt,
    });
  });

  next();
});

// rutas
app.use('/auth', authRoutes);
app.use('/', authRoutes); // compatibilidad: mantiene /login
app.use('/turnos', turnosRoutes);
app.use('/clientes', clientesRoutes);
app.use('/health', healthRoutes);
app.use('/metrics', metricsRoutes);
app.use('/stats', statsRoutes);
app.use('/meta-webhook', whatsappWebhookRoutes); // legado
app.use('/whatsapp-webhook', whatsappWebhookRoutes); // recomendado
app.use('/gupshup-webhook', whatsappWebhookRoutes); // alias util para onboarding
app.use('/api/barber-panel', barberPanelRoutes);
app.use('/app', express.static(path.join(__dirname, 'public', 'app')));

// error global
app.use(errorMiddleware);

process.on('uncaughtException', (err) => {
  logger.error(`UNCAUGHT EXCEPTION: ${err.stack || err.message}`);
});

process.on('unhandledRejection', (err) => {
  logger.error(`UNHANDLED REJECTION: ${err}`);
});

if (process.env.NODE_ENV !== 'test') {
  turnosService.iniciarRecordatorios(logger);
  setInterval(() => {
    opsMonitoring.runAlertCycle().catch(err => {
      logger.warn(`OPS alert cycle failed: ${err.message}`);
    });
  }, Math.max(15000, Number(opsMonitoring.ALERT_CHECK_INTERVAL_MS || 60000)));

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    logger.info(`Servidor corriendo en puerto ${PORT}`);
  });
}

module.exports = app;
