const logger = require('../logger');

function errorMiddleware(err, req, res, next) {
  logger.error(err.stack || err.message);

  const status = err.status || 500;
  const message =
    process.env.NODE_ENV === 'development'
      ? err.message
      : 'Error interno del servidor';

  res.status(status).json({ message });
}

module.exports = errorMiddleware;
