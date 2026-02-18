const express = require('express');
const router = express.Router();
const db = require('../database');

router.get('/', (req, res) => {
  try {
    // chequeo simple a DB
    db.prepare('SELECT 1').get();

    res.status(200).json({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV,
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: 'Database not responding',
    });
  }
});

module.exports = router;
