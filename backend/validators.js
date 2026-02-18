const Joi = require('joi');

/* ======================================================
   VALIDACION CREAR TURNO
   ====================================================== */

const crearTurnoSchema = Joi.object({
  cliente: Joi.string().min(2).max(100).required(),
  cliente_id: Joi.string().required(),
  servicio: Joi.string().min(2).max(100).required(),
  fecha: Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .required(),
  hora: Joi.string()
    .pattern(/^\d{2}:\d{2}$/)
    .required(),
  origen: Joi.string().valid('bot', 'panel').optional(),
  precio: Joi.number().integer().min(0).optional(),
  barber_id: Joi.number().integer().required(),
});

/* ======================================================
   VALIDACION LOGIN
   ====================================================== */

const loginSchema = Joi.object({
  username: Joi.string().required(),
  password: Joi.string().required(),
});

/* ======================================================
   VALIDACION RESPUESTA RECORDATORIO
   ====================================================== */

const responderRecordatorioSchema = Joi.object({
  accion: Joi.string().valid('confirmar', 'cancelar').required(),
  cliente_id: Joi.string().required(),
});

module.exports = {
  crearTurnoSchema,
  loginSchema,
  responderRecordatorioSchema,
};
