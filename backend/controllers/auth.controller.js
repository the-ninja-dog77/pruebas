const authService = require('../services/auth.service');
const { loginSchema, rotatePasswordSchema } = require('../validators');

async function login(req, res, next) {
  try {
    const { error } = loginSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        message: error.details[0].message,
      });
    }

    const { username, password } = req.body;
    const result = await authService.login(username, password);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function rotatePassword(req, res, next) {
  try {
    const { error, value } = rotatePasswordSchema.validate(req.body || {});
    if (error) {
      return res.status(400).json({
        message: error.details[0].message,
      });
    }

    const result = await authService.rotatePassword({
      userId: req.user?.user_id,
      currentPassword: value.currentPassword,
      newPassword: value.newPassword,
    });
    return res.json(result);
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  login,
  rotatePassword,
};
