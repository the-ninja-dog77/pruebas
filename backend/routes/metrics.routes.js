const express = require('express');
const router = express.Router();
const db = require('../database');
const authMiddleware = require('../middlewares/auth.middleware');
const roleMiddleware = require('../middlewares/role.middleware');

router.get('/', (req, res) => {
  try {
    const totalTurnos = db
      .prepare('SELECT COUNT(*) as count FROM turnos')
      .get().count;

    const totalClientes = db
      .prepare('SELECT COUNT(*) as count FROM clientes')
      .get().count;

    res.json({
      turnos: totalTurnos,
      clientes: totalClientes,
      memoryUsage: process.memoryUsage(),
      uptime: process.uptime(),
    });
  } catch (err) {
    res.status(500).json({ message: 'Error obteniendo métricas' });
  }
});

router.get(
  '/internal',
  authMiddleware,
  roleMiddleware(['admin']),
  (req, res) => {
    res.json({
      env: process.env.NODE_ENV,
      dbPath: process.env.DB_PATH,
      memory: process.memoryUsage(),
      uptime: process.uptime(),
    });
  }
);

module.exports = router;
