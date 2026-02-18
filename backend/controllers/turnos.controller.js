const turnosService = require('../services/turnos.service');
const jwt = require('jsonwebtoken');
const {
  crearTurnoSchema,
  responderRecordatorioSchema,
} = require('../validators');

function getTodos(req, res, next) {
  try {
    const result = turnosService.obtenerTodos(req.user);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

function getPorFecha(req, res, next) {
  try {
    const { fecha, barberId } = req.params;
    const result = turnosService.obtenerPorFecha(
      fecha,
      barberId,
      req.user
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

function getDisponibilidad(req, res, next) {
  try {
    const { fecha } = req.params;
    const result = turnosService.obtenerDisponibilidad(fecha);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

function create(req, res, next) {
  try {
    const payload = { ...req.body, barber_id: 1 };
    const { error, value } = crearTurnoSchema.validate(payload);
    if (error) {
      return res.status(400).json({
        message: error.details[0].message,
      });
    }

    const result = turnosService.crearTurno(value);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

function remove(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const { cliente_id } = req.body;
    const authHeader = req.headers.authorization;
    let user = null;

    if (authHeader) {
      const token = authHeader.split(' ')[1];
      try {
        user = jwt.verify(token, process.env.JWT_SECRET);
      } catch (err) {
        return res.status(403).json({ message: 'Token inválido o expirado' });
      }
    }

    const result = turnosService.eliminarTurno({ id, cliente_id, user });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

function getRecordatorioActivo(req, res, next) {
  try {
    const { cliente_id } = req.params;
    const result = turnosService.getRecordatorioActivo(cliente_id);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

function responderRecordatorio(req, res, next) {
  try {
    const { error } = responderRecordatorioSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        message: error.details[0].message,
      });
    }

    const id = parseInt(req.params.id, 10);
    const { accion, cliente_id } = req.body;
    const result = turnosService.responderRecordatorio({
      id,
      accion,
      cliente_id,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getTodos,
  getPorFecha,
  getDisponibilidad,
  create,
  remove,
  getRecordatorioActivo,
  responderRecordatorio,
};
