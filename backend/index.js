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
const metaWebhookRoutes = require('./routes/metaWebhook.routes');
const barberPanelRoutes = require('./routes/barberPanel.routes');
const turnosService = require('./services/turnos.service');

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
app.use(express.json());

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// logger http
app.use(loggerMiddleware);

// rutas
app.use('/auth', authRoutes);
app.use('/', authRoutes); // compatibilidad: mantiene /login
app.use('/turnos', turnosRoutes);
app.use('/clientes', clientesRoutes);
app.use('/health', healthRoutes);
app.use('/metrics', metricsRoutes);
app.use('/stats', statsRoutes);
app.use('/meta-webhook', metaWebhookRoutes);
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

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    logger.info(`Servidor corriendo en puerto ${PORT}`);
  });
}

module.exports = app;
