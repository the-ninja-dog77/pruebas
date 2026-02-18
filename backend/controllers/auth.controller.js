const authService = require('../services/auth.service');
const { loginSchema } = require('../validators');

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

module.exports = { login };
