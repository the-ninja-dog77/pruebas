const statsService = require('../services/stats.service');

function getDashboard(req, res, next) {
  try {
    const result = statsService.getDashboard();
    res.json(result);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getDashboard,
};
