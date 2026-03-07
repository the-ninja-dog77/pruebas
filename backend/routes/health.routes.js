const express = require('express');
const router = express.Router();
const db = require('../database');
const whatsappSender = require('../services/whatsappSender.service');
const jwtSecrets = require('../services/jwtSecrets.service');

router.get('/', (req, res) => {
  try {
    // chequeo simple a DB
    db.prepare('SELECT 1').get();
    const outboundConfigError = whatsappSender.getOutboundConfigError();
    const outboundConfig = whatsappSender.getOutboundConfigSnapshot();

    res.status(200).json({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV,
      whatsapp: {
        provider: whatsappSender.getProvider(),
        outboundConfigured: !outboundConfigError,
        outboundConfigError: outboundConfigError || null,
        outboundConfig,
      },
      security: {
        jwt: jwtSecrets.getSnapshot(),
      },
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: 'Database not responding',
    });
  }
});

module.exports = router;
