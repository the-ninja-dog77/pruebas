const express = require('express');
const authMiddleware = require('../middlewares/auth.middleware');
const roleMiddleware = require('../middlewares/role.middleware');
const statsController = require('../controllers/stats.controller');

const router = express.Router();

router.get(
  '/',
  authMiddleware,
  roleMiddleware(['admin']),
  statsController.getDashboard
);

module.exports = router;
