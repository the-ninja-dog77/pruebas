function roleMiddleware(rolesPermitidos = []) {
  return (req, res, next) => {
    if (!rolesPermitidos.includes(req.user.role)) {
      return res.status(403).json({
        message: 'No tenés permisos para acceder',
      });
    }
    next();
  };
}

module.exports = roleMiddleware;
