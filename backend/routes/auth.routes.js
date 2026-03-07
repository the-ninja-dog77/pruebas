const express = require('express');
const rateLimit = require('express-rate-limit');
const authController = require('../controllers/auth.controller');
const authMiddleware = require('../middlewares/auth.middleware');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Demasiados intentos de login. Intenta mas tarde.',
});

const passwordRotateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  message: 'Demasiados intentos de cambio de password. Intenta mas tarde.',
});

router.post('/login', loginLimiter, authController.login);
router.post(
  '/rotate-password',
  passwordRotateLimiter,
  authMiddleware,
  authController.rotatePassword
);

module.exports = router;
