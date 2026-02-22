# Plan De Respuesta Conversacional (Humanos Reales)

## Objetivo
Reducir friccion en conversaciones reales (ambiguedad, slang, cambios de idea, cansancio, ruido) sin romper el flujo de turnos ni ejecutar acciones peligrosas.

## Riesgos Principales
- Ambiguedad de intencion: un mensaje mezcla `cancelar` y `reprogramar`.
- Ruido humano: "gracias", "no se", "ayuda", "repetime" en medio del flujo.
- Dato incompleto: fecha sin hora, hora sin fecha, nombre invalido.
- Confirmacion accidental: mensajes vagos cuando falta confirmar.
- Fatiga en audio: audios cortos, ruido, confianza baja.

## Politica General
- Acciones destructivas: confirmar por texto si hay baja confianza.
- Mensajes de ayuda: responder con "siguiente dato faltante" segun etapa.
- Agradecimientos en flujo activo: no resetear, mantener contexto.
- Ambiguedad de gestion: pedir decision explicita entre cancelar/reprogramar.

## Matriz De Casos Especificos
| Caso | Estado | Entrada humana | Respuesta esperada | Accion interna |
|---|---|---|---|---|
| 1 | `idle` | "hola bro" | Saludo + instruccion de inicio | no cambia borradores |
| 2 | `idle` | "gracias" | "De nada..." | sin reset extra |
| 3 | `awaiting_service` | "que me falta?" | pedir servicio | mantener estado |
| 4 | `awaiting_date` | "no entiendo" | pedir fecha con ejemplo | mantener estado |
| 5 | `awaiting_time` | "ayuda" | horarios + pedir hora | mantener estado |
| 6 | `awaiting_name` | "resumen" | pedir nombre valido | mantener estado |
| 7 | `awaiting_payment` | "recordame" | pedir metodo de pago | mantener estado |
| 8 | `awaiting_confirm` | "gracias bro" | agradecer y volver a resumen | NO reset |
| 9 | `awaiting_confirm` | "no" | no confirmar, mantener resumen | no crear turno |
| 10 | `awaiting_confirm` | "confirmo" | confirmar turno | crear turno |
| 11 | cualquier | "cancelar y reprogramar" | pedir elegir una accion | no ejecutar accion |
| 12 | `manage_cancel_collect` | nombre sin fecha | pedir fecha | mantener manage |
| 13 | `manage_reschedule_collect_current` | fecha sin nombre | buscar proximo turno o pedir nombre | no reset |
| 14 | `manage_reschedule_collect_new` | fecha sin hora | pedir hora | mantener manage |
| 15 | `awaiting_name` | "a fernando tu bro..." | limpiar ruido y validar nombre | guardar nombre saneado |
| 16 | `awaiting_name` | "confirmar" | rechazar como nombre invalido | pedir nombre |
| 17 | `awaiting_time` | "las 4" | interpretar 16:00 | guardar hora |
| 18 | `awaiting_time` | "las cuatro" | interpretar 16:00 | guardar hora |
| 19 | `awaiting_time` | "4:00 pm" | interpretar 16:00 | guardar hora |
| 20 | `awaiting_time` | "4:00" | interpretar 16:00 | guardar hora |
| 21 | `awaiting_date` | "mismo dia de recien" | reutilizar fecha previa | guardar fecha |
| 22 | `collecting` | "hay turno el martes a las 4?" | disponibilidad concreta | stage collecting |
| 23 | `idle` | "reprogramar mi turno" | entrar a manage reschedule | actualizar manage |
| 24 | `idle` | "cancelar" con turno activo | cancelar proximo turno | borrar turno |
| 25 | `idle` | "cancelar" sin turno activo | cancelar flujo (si existe) | reset controlado |
| 26 | audio | ruido/silencio | fallback claro | no tocar estado sensible |
| 27 | audio | muy corto pero entendible (debug) | permitir progresar | evitar descarte excesivo |
| 28 | audio | baja confianza + intencion destructiva | exigir texto exacto | no ejecutar accion |
| 29 | audio | baja confianza + intencion accionable clara | progreso guiado | mantener seguridad |
| 30 | carga alta | cola audio saturada | mensaje de "audio_queue_busy" + alternativa texto | preservar latencia |

## Reglas De Fallback
- Si faltan datos: pedir solo el siguiente dato.
- Si el usuario duda: mostrar progreso y ejemplo.
- Si hay contradiccion en gestion: pedir eleccion explicita.
- Si audio no es confiable: degradar a texto con mensaje concreto.

## No Negociables
- Nunca ejecutar cancelacion/reprogramacion por audio de baja confianza.
- Nunca confirmar turno sin resumen + confirmacion positiva.
- Nunca perder estado por "gracias" cuando el flujo esta activo.
