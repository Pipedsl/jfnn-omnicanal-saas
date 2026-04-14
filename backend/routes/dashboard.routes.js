const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sessionsService = require('../services/sessions.service');
const whatsappService = require('../services/whatsapp.service');
const geminiService = require('../services/gemini.service');
const db = require('../config/db');

const KNOWLEDGE_JSON_PATH = path.join(__dirname, '../data/knowledge.json');

/**
 * [P0] Calcular métricas del negocio
 * GET /api/dashboard/metrics
 */
router.get('/metrics', async (req, res) => {
    try {
        const metrics = await sessionsService.getDashboardMetrics();
        res.status(200).json(metrics);
    } catch (error) {
        console.error('Error obteniendo métricas:', error);
        res.status(500).json({ error: 'Error interno' });
    }
});

/**
 * Obtener todas las cotizaciones en espera
 */
router.get('/cotizaciones', async (req, res) => {
    try {
        const pending = await sessionsService.getAllPendingSessions();

        // Formatear y normalizar los datos antes de enviarlos al frontend
        // Esto garantiza que los precios en repuestos_solicitados sean números limpios
        // para que el formulario de rectificación los precargue correctamente (Fix Bug 3)
        const formatted = pending.map(session => {
            const e = session.entidades || {};

            const repuestosNormalizados = (e.repuestos_solicitados || []).map(r => ({
                ...r,
                precio: normalizarPrecio(r.precio) || null,
                codigo: r.codigo || null,
                disponibilidad: r.disponibilidad || 'DISPONIBLE'
            }));

            const vehiculosNormalizados = (e.vehiculos || []).map(v => ({
                ...v,
                repuestos_solicitados: (v.repuestos_solicitados || []).map(r => ({
                    ...r,
                    precio: normalizarPrecio(r.precio) || null,
                    codigo: r.codigo || null,
                    disponibilidad: r.disponibilidad || 'DISPONIBLE'
                }))
            }));

            return {
                ...session,
                entidades: {
                    ...e,
                    repuestos_solicitados: repuestosNormalizados,
                    vehiculos: vehiculosNormalizados
                }
            };
        });

        res.status(200).json(formatted);
    } catch (error) {
        console.error('Error obteniendo pendientes:', error);
        res.status(500).json({ error: 'Error interno' });
    }
});


/**
 * Obtener historial de ventas finalizadas
 */
router.get('/cotizaciones/historial', async (req, res) => {
    try {
        const history = await sessionsService.getHistoricalSessions();
        res.status(200).json(history);
    } catch (error) {
        console.error('Error obteniendo historial:', error);
        res.status(500).json({ error: 'Error interno' });
    }
});

/**
 * Enviar respuesta final al cliente y cerrar sesión
 */
router.post('/cotizaciones/responder', async (req, res) => {
    try {
        const { phone, items, vehiculos, note, horario_entrega } = req.body;

        if (!phone || (!items && !vehiculos)) {
            return res.status(400).json({ error: 'Faltan campos obligatorios' });
        }

        const quoteId = `JFNN-2026-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        let total = 0;
        let detailsText = '';

        const parseItem = (item) => {
            const disponibilidad = item.disponibilidad || "DISPONIBLE";
            const isAgotado = disponibilidad === "SIN_STOCK";
            const isEncargo = disponibilidad === "POR_ENCARGO";
            const cant = item.cantidad || 1;
            const precio = item.precio ? parseInt(String(item.precio).replace(/[^\d]/g, "")) : null;
            const priceStr = precio ? precio.toLocaleString("es-CL") : null;

            if (isAgotado) {
                return `❌ ${item.nombre} - Agotado momentáneamente`;
            }

            if (precio) total += (precio * cant);
            if (isEncargo) {
                return `📦 ${cant}x ${item.nombre} | $${priceStr} c/u (Requiere abono previo)`;
            }

            return `✔️ ${cant}x ${item.nombre} | Cód: ${item.codigo || 'N/A'} | $${priceStr || 0} c/u${cant > 1 ? ` (Total: $${(parseInt(item.precio) * cant).toLocaleString('es-CL')})` : ''}`;
        };

        if (vehiculos && vehiculos.length > 0) {
            detailsText = vehiculos.map(v => {
                let vehiculoHeader = `🚗 *${v.marca_modelo || 'Vehículo'} ${v.ano || ''}*\n`;
                let vehiculoDetails = (v.repuestos_solicitados || []).map(parseItem).join('\n');
                return vehiculoHeader + vehiculoDetails;
            }).join('\n\n');
        } else if (items) {
            detailsText = items.map(parseItem).join('\n');
        }

        const message = `*COTIZACIÓN FORMAL - JFNN*\n` +
            `📄 ID: ${quoteId}\n\n` +
            `Estimado cliente, revisamos el stock de lo solicitado:\n\n` +
            `${detailsText}\n\n` +
            (total > 0 ? `*TOTAL APROXIMADO: $${total.toLocaleString('es-CL')}*\n\n` : '') +
            `${horario_entrega ? `📦 Logística: ${horario_entrega}\n\n` : ''}` +
            `${note ? `📝 Nota del asesor: ${note}\n\n` : ''}` +
            `--- \n` +
            `🏢 Origen: Venta Online / WhatsApp\n` +
            `👤 Atentamente: Asesor JFNN\n\n` +
            `¿Deseas confirmar la compra o el encargo de los productos disponibles?`;

        await whatsappService.sendTextMessage(phone, message);

        // Actualizar sesión: Guardar ID de cotización, total, horario, precios y pasar al flujo de cierre
        const sessionUpdateParams = {
            quote_id: quoteId,
            total_cotizacion: total,
            horario_entrega: horario_entrega || null
        };
        if (vehiculos && vehiculos.length > 0) {
            sessionUpdateParams.vehiculos = vehiculos;
        } else {
            sessionUpdateParams.repuestos_solicitados = items;
        }

        await sessionsService.patchSellerData(phone, sessionUpdateParams);
        await sessionsService.setEstado(phone, 'CONFIRMANDO_COMPRA');

        res.status(200).json({ success: true, quoteId });
    } catch (error) {
        console.error('Error respondiendo al cliente:', error);
        res.status(500).json({ error: 'Error al enviar mensaje' });
    }
});

/**
 * Enviar plantilla HSM para re-enganchar al cliente
 */
router.post('/cotizaciones/template', async (req, res) => {
    try {
        const { phone, templateName, nombre, repuesto } = req.body;

        if (!phone || !templateName) {
            return res.status(400).json({ error: 'Faltan campos obligatorios (phone, templateName)' });
        }

        // Recuperar sesión para saber el estado actual
        const session = await sessionsService.getSession(phone);
        if (!session) {
            return res.status(404).json({ error: 'Sesión no encontrada' });
        }

        // Construir parámetros con nombre (Meta API v19+ requiere parameter_name)
        const bodyParams = [];
        if (nombre) bodyParams.push({ name: 'nombre', text: nombre });
        if (repuesto) bodyParams.push({ name: 'repuesto', text: repuesto });

        // Idioma correcto según la plantilla registrada en Meta
        const langMap = {
            'cotizacion_lista': 'es',
            'retomar_cotizacion': 'es_CL'
        };
        const languageCode = langMap[templateName] || 'es';

        const response = await whatsappService.sendTemplateMessage(phone, templateName, languageCode, bodyParams);

        // Si estaba ARCHIVADO o expirado, lo pasamos a ESPERANDO_VENDEDOR para que
        // vuelva a aparecer activo en el tablero. Además, actualizamos ultimo_mensaje
        // para que a nivel de UI el dashboard lo vea recién tocado.
        const nuevosDatos = {};
        if (session.estado === 'ARCHIVADO') {
            await sessionsService.setEstado(phone, 'ESPERANDO_VENDEDOR');
        }
        
        // Actualizamos el ultimo_mensaje en la DB para que suba en la bandeja.
        await db.query(
            `UPDATE user_sessions SET ultimo_mensaje = NOW() WHERE phone = $1`,
            [phone]
        );

        res.status(200).json({ success: true, messageId: response?.messages?.[0]?.id || 'mocked' });
    } catch (error) {
        console.error('Error enviando plantilla HSM:', error);
        res.status(500).json({ error: 'Error al enviar plantilla', detalle: error.message });
    }
});

/**
 * Actualizar estado de una cotización
 * 
 * NOTA IMPORTANTE DE FLUJO:
 * - Cuando estado='ENTREGADO' + notify=true: el vendedor confirma la logística.
 *   Se envía el mensaje personalizado (mensaje_logistica) al cliente.
 *   Este es el ÚNICO punto donde el cliente recibe notificación post-pago.
 * - Cuando estado='PAGO_VERIFICADO': no se notifica al cliente (lo hace el vendedor
 *   desde su panel de logística, que dispara este mismo endpoint con ENTREGADO).
 */
router.patch('/cotizaciones/estado', async (req, res) => {
    try {
        const { phone, estado, notify, mensaje_logistica, numero_seguimiento } = req.body;

        if (!phone || !estado) {
            return res.status(400).json({ error: 'Faltan campos obligatorios' });
        }

        // Si viene numero_seguimiento, actualizar entidades
        if (numero_seguimiento) {
            const session = await sessionsService.getSession(phone);
            const entidades = session.entidades || {};
            entidades.numero_seguimiento = numero_seguimiento;
            await sessionsService.updateEntidades(phone, entidades);
        }

        const session = await sessionsService.setEstado(phone, estado);

        if (notify) {
            let message = "";

            if (estado === 'ESPERANDO_RETIRO' || estado === 'ENTREGADO') {
                // El vendedor confirma la logística desde su panel.
                // Si escribió un mensaje personalizado, se lo enviamos al cliente.
                // Si no, usamos el mensaje genérico de entrega.
                if (mensaje_logistica && mensaje_logistica.trim()) {
                    const seguimientoLinea = numero_seguimiento && numero_seguimiento.trim()
                        ? `📮 *Número de seguimiento:* ${numero_seguimiento.trim()}\n\n`
                        : '';
                    message =
                        `✅ *¡Su pago fue confirmado!* Gracias por su preferencia.\n\n` +
                        `📦 *Información de despacho/retiro:*\n${mensaje_logistica.trim()}\n\n` +
                        seguimientoLinea +
                        `¡Muchas gracias por preferir *Repuestos JFNN*! 🙌`;
                } else {
                    message =
                        `✅ *¡Su pago fue verificado!* Estamos preparando su pedido.\n\n` +
                        `📦 En breve le informaremos sobre el despacho o puede pasar a retirarlo a nuestro local.\n\n` +
                        `¡Muchas gracias por preferir *Repuestos JFNN*! 🙌`;
                }
            }
            // NOTA: El estado PAGO_VERIFICADO NO notifica al cliente.
            // La notificación la gestiona el vendedor al confirmar la logística (ESPERANDO_RETIRO o ENTREGADO).
            if (message) {
                await whatsappService.sendTextMessage(phone, message);

                // HU-6: Solicitud de reseña en Google Maps
                // Se envía cuando el cliente retira el producto o recibe el envío (estado ENTREGADO)
                if (estado === 'ENTREGADO') {
                    // Pequeño delay de 5s para que no se envíe al mismo momento exacto
                    setTimeout(() => {
                        whatsappService.sendGoogleReviewRequest(phone).catch(err => {
                            console.error('Error enviando solicitud de reseña Google:', err);
                        });
                    }, 5000);
                }
            }
        }

        res.status(200).json({ success: true, estado: session.estado });
    } catch (error) {
        console.error('Error actualizando estado:', error);
        res.status(500).json({ error: 'Error interno' });
    }
});


/**
 * Confirmar identificación de pieza por imagen desde el dashboard del vendedor.
 * PATCH /api/dashboard/repuestos/confirmar-imagen
 * Body: { phone, imagen_url, nombre_confirmado }
 *
 * Flujo:
 * 1. Encuentra el repuesto con esa imagen_url en la sesión (root o vehiculos)
 * 2. Actualiza: pendiente_identificacion=false, nombre=nombre_confirmado
 * 3. Graba en part_image_dataset para entrenamiento futuro
 * 4. Envía WhatsApp al cliente confirmando la pieza + pregunta si quiere cotizar más
 */
router.patch('/repuestos/confirmar-imagen', async (req, res) => {
    try {
        const { phone, imagen_url, nombre_confirmado } = req.body;
        if (!phone || !imagen_url || !nombre_confirmado) {
            return res.status(400).json({ error: 'Faltan campos: phone, imagen_url, nombre_confirmado' });
        }

        const session = await sessionsService.getSession(phone);
        if (!session) {
            return res.status(404).json({ error: 'Sesión no encontrada' });
        }

        const entidades = session.entidades || {};
        let encontrado = false;
        let repuestoViejo = null;

        // Buscar en repuestos_solicitados raíz
        const repuestosRaiz = entidades.repuestos_solicitados || [];
        const idxRaiz = repuestosRaiz.findIndex(r => r.imagen_url === imagen_url);
        if (idxRaiz !== -1) {
            repuestoViejo = { ...repuestosRaiz[idxRaiz] };
            repuestosRaiz[idxRaiz] = {
                ...repuestosRaiz[idxRaiz],
                nombre: nombre_confirmado,
                pendiente_identificacion: false
            };
            entidades.repuestos_solicitados = repuestosRaiz;
            encontrado = true;
        }

        // Buscar en vehiculos si no se encontró en raíz
        if (!encontrado && Array.isArray(entidades.vehiculos)) {
            for (const v of entidades.vehiculos) {
                const reps = v.repuestos_solicitados || [];
                const idx = reps.findIndex(r => r.imagen_url === imagen_url);
                if (idx !== -1) {
                    repuestoViejo = { ...reps[idx] };
                    reps[idx] = { ...reps[idx], nombre: nombre_confirmado, pendiente_identificacion: false };
                    encontrado = true;
                    break;
                }
            }
        }

        if (!encontrado) {
            return res.status(404).json({ error: 'Repuesto con esa imagen_url no encontrado en la sesión' });
        }

        // Guardar entidades actualizadas directamente
        await db.query(
            `UPDATE user_sessions SET entidades = $1, ultimo_mensaje = NOW() WHERE phone = $2`,
            [JSON.stringify(entidades), phone]
        );

        // Registrar en dataset de entrenamiento
        try {
            await db.query(
                `INSERT INTO part_image_dataset (phone, image_url, identificacion_ia, nombre_ia, confianza_ia, nombre_confirmado, session_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [
                    phone,
                    imagen_url,
                    repuestoViejo?.identificacion_ia || null,
                    repuestoViejo?.nombre || null,
                    repuestoViejo?.confianza_ia || null,
                    nombre_confirmado,
                    session.id || null
                ]
            );
        } catch (dbErr) {
            // No bloquear el flujo si falla el dataset (tabla puede no existir aún en prod)
            console.warn('[Dashboard] ⚠️ No se pudo grabar en part_image_dataset:', dbErr.message);
        }

        // Notificar al cliente por WhatsApp
        const msg = `✅ ¡Identificamos la pieza de tu foto! Es: *${nombre_confirmado}*.\n\n¿Necesitas cotizar algún otro repuesto o producto? Estoy acá para ayudarte. 🔧`;
        await whatsappService.sendTextMessage(phone, msg);

        console.log(`[Dashboard] ✅ Pieza confirmada: "${nombre_confirmado}" para ${phone} (imagen: ${imagen_url})`);
        res.status(200).json({ success: true, nombre_confirmado });

    } catch (error) {
        console.error('[Dashboard] Error confirmando imagen:', error);
        res.status(500).json({ error: 'Error interno' });
    }
});

/**
 * Helper: Normaliza un precio a número entero limpio.
 * Maneja strings con formato chileno ("8.500"), strings puros ("8500") y números.
 * @param {any} precio
 * @returns {number}
 */
function normalizarPrecio(precio) {
    if (precio === null || precio === undefined || precio === '') return 0;
    const limpio = String(precio).replace(/[^0-9]/g, '');
    const parsed = parseInt(limpio, 10);
    return isNaN(parsed) ? 0 : parsed;
}

/**
 * [P1] Obtener sesiones esperando aprobación manual del admin
 * GET /api/dashboard/pending-approvals
 * 
 * FIX BUG: Normalizamos los precios con `normalizarPrecio` para manejar
 * strings con punto como separador de miles ("8.500" → 8500).
 */
router.get('/pending-approvals', async (req, res) => {
    try {
        const sessions = await sessionsService.getPendingApprovalSessions();

        const formatted = sessions.map(s => {
            const e = s.entidades || {};

            // Normalizar precios de cada repuesto para garantizar que son números limpios
            const repuestosNormalizados = (e.repuestos_solicitados || []).map(r => ({
                ...r,
                precio: normalizarPrecio(r.precio) || null
            }));

            // Calcular total usando los precios ya normalizados y cantidades
            const totalCotizacion = repuestosNormalizados.reduce((acc, r) => {
                return acc + ((r.precio || 0) * (r.cantidad || 1));
            }, 0);

            return {
                phone: s.phone,
                estado: s.estado,
                ultimo_mensaje: s.ultimo_mensaje,
                quote_id: e.quote_id || null,
                vehiculo: {
                    marca_modelo: e.marca_modelo,
                    ano: e.ano,
                    patente: e.patente,
                    vin: e.vin,
                    motor: e.motor || null,
                    combustible: e.combustible || null,
                },
                // Retornamos repuestos con precios normalizados (números limpios)
                repuestos: repuestosNormalizados,
                total_cotizacion: totalCotizacion,
                metodo_entrega: e.metodo_entrega || null,
                horario_entrega: e.horario_entrega || null,
                direccion_envio: e.direccion_envio || null,
                tipo_documento: e.tipo_documento || null,
                comprobante_url: e.comprobante_url || null,
                pago_pendiente: e.pago_pendiente || null,
            };
        });

        res.status(200).json({ total: formatted.length, aprobaciones_pendientes: formatted });
    } catch (error) {
        console.error('[Dashboard] Error en GET /pending-approvals:', error);
        res.status(500).json({ error: 'Error interno al obtener aprobaciones pendientes' });
    }
});

/**
 * [P1] Aprobar o rechazar un comprobante de pago
 * POST /api/dashboard/verify-payment
 * Body: { phone: string, accion: 'approve' | 'reject', nota_admin?: string }
 * 
 * ─── FLUJO CORRECTO (FIX BUG 3) ───────────────────────────────────────────
 * APROBAR: Solo cambia el estado a PAGO_VERIFICADO. NO envía mensaje al cliente.
 *   El cliente recibirá su notificación cuando el VENDEDOR confirme la logística
 *   desde su panel (endpoint PATCH /cotizaciones/estado con estado=ENTREGADO).
 * 
 * RECHAZAR: Notifica al cliente para que reenvíe el comprobante.
 * ──────────────────────────────────────────────────────────────────────────
 */
router.post('/verify-payment', async (req, res) => {
    try {
        const { phone, accion, nota_admin } = req.body;

        if (!phone || !['approve', 'approve_abono', 'reject'].includes(accion)) {
            return res.status(400).json({
                error: "Faltan campos obligatorios. 'phone' y 'accion' (approve/approve_abono/reject) son requeridos."
            });
        }

        // Verificar que la sesión esté en el estado correcto antes de actuar
        const session = await sessionsService.getSession(phone);
        if (session.estado !== 'ESPERANDO_APROBACION_ADMIN') {
            return res.status(409).json({
                error: `Conflicto de estado: la sesión del cliente está en '${session.estado}', no en 'ESPERANDO_APROBACION_ADMIN'.`
            });
        }

        const monto_corregido = req.body.monto_corregido;

        // Si el admin corrigió el monto extraído por la IA, actualizarlo en la BD
        if ((accion === 'approve' || accion === 'approve_abono') && monto_corregido !== undefined) {
            const entidades = session.entidades || {};
            const pagoPendiente = entidades.pago_pendiente || {};
            
            // Verificamos si realmente hubo un cambio para logearlo
            if (pagoPendiente.monto !== monto_corregido) {
                console.log(`[Dashboard] ✏️ Se corrigió el monto extraído por IA de ${pagoPendiente.monto} a ${monto_corregido} para ${phone}`);
                pagoPendiente.monto = monto_corregido;
                await sessionsService.updateEntidades(phone, { pago_pendiente: pagoPendiente });
            }
        }

        if (accion === 'approve') {
            // ─── APROBAR ──────────────────────────────────────────────
            // Solo cambiamos el estado. El vendedor verá la card con estado PAGO_VERIFICADO
            // y desde su panel de logística enviará el mensaje personalizado al cliente.
            await sessionsService.setEstado(phone, 'PAGO_VERIFICADO');

            console.log(`[Dashboard] ✅ Pago APROBADO (admin) para ${phone}${nota_admin ? ` | Nota: ${nota_admin}` : ''}. Esperando confirmación de logística del vendedor.`);
            res.status(200).json({
                success: true,
                accion: 'approved',
                nuevo_estado: 'PAGO_VERIFICADO',
                mensaje: 'Pago aprobado. El vendedor deberá confirmar la logística para notificar al cliente.',
                phone
            });

        } else if (accion === 'approve_abono') {
            // ─── APROBAR COMO ABONO (POR ENCARGO) ─────────────────────
            // Cambiamos el estado a ABONO_VERIFICADO.
            // El vendedor será notificado visualmente en su panel para gestionar el encargo.
            await sessionsService.setEstado(phone, 'ABONO_VERIFICADO');

            console.log(`[Dashboard] 💳💳 ABONO APROBADO (admin) para ${phone}${nota_admin ? ` | Nota: ${nota_admin}` : ''}. Encargo pendiente.`);
            res.status(200).json({
                success: true,
                accion: 'approved_abono',
                nuevo_estado: 'ABONO_VERIFICADO',
                mensaje: 'Abono verificado. El vendedor fue notificado de este encargo.',
                phone
            });

        } else if (accion === 'reject') {
            // ─── RECHAZAR ─────────────────────────────────────────────
            // Al rechazar, notificamos al cliente para que reenvíe el comprobante.
            const esSaldo = session.entidades?.pago_pendiente?.es_saldo;
            const nuevoEstado = esSaldo ? 'ESPERANDO_SALDO' : 'CONFIRMANDO_COMPRA';
            await sessionsService.setEstado(phone, nuevoEstado);

            const motivoRechazo = nota_admin
                ? `El motivo indicado por nuestro equipo es: _${nota_admin}_`
                : `Esto puede deberse a que la imagen no era legible o no correspondía a lo solicitado.`;

            const mensajeRechazo =
                `⚠️ Lamentablemente *no pudimos verificar* el comprobante enviado. ${motivoRechazo}\n\n` +
                `Le pedimos que envíe nuevamente una fotografía clara del comprobante de transferencia. ` +
                `Si tiene dudas, puede escribirnos y con gusto le ayudamos. 🙏`;

            await whatsappService.sendTextMessage(phone, mensajeRechazo);

            console.log(`[Dashboard] ❌ Pago RECHAZADO para ${phone}${nota_admin ? ` | Motivo: ${nota_admin}` : ''} | Volviendo a: ${nuevoEstado}`);
            res.status(200).json({
                success: true,
                accion: 'rejected',
                nuevo_estado: nuevoEstado,
                phone
            });
        }

    } catch (error) {
        console.error('[Dashboard] Error en POST /verify-payment:', error);
        res.status(500).json({ error: 'Error interno al verificar el pago' });
    }
});

/**
 * [P1] Archivar una sesión completada
 * POST /api/dashboard/archive-session
 * Body: { phone: string }
 * 
 * Solo se puede archivar una sesión en estado ENTREGADO.
 * El registro queda en la tabla con estado ARCHIVADO
 * y el historial del Dashboard lo muestra separado de las activas.
 */
router.post('/archive-session', async (req, res) => {
    try {
        const { phone } = req.body;

        if (!phone) {
            return res.status(400).json({ error: "'phone' es un campo obligatorio." });
        }

        // Verificar que la sesión esté en un estado archivable
        const session = await sessionsService.getSession(phone);
        const archivableStates = ['ENTREGADO', 'PAGO_VERIFICADO'];

        if (!archivableStates.includes(session.estado)) {
            return res.status(409).json({
                error: `Solo se pueden archivar sesiones en estado ENTREGADO o PAGO_VERIFICADO. Estado actual: '${session.estado}'.`
            });
        }

        await sessionsService.setEstado(phone, 'ARCHIVADO');

        console.log(`[Dashboard] 🗄️  Sesión archivada → ${phone} (era: ${session.estado})`);
        res.status(200).json({
            success: true,
            mensaje: `Sesión de ${phone} archivada correctamente.`,
            estado_anterior: session.estado,
            nuevo_estado: 'ARCHIVADO'
        });

    } catch (error) {
        console.error('[Dashboard] Error en POST /archive-session:', error);
        res.status(500).json({ error: 'Error interno al archivar la sesión' });
    }
});

/**
 * [HU-2] Marcar un encargo como solicitado a proveedor
 * POST /api/dashboard/encargos/solicitar
 */
router.post('/encargos/solicitar', async (req, res) => {
    try {
        const { phone, dias_eta } = req.body;
        if (!phone || !dias_eta) {
            return res.status(400).json({ error: "Faltan campos obligatorios." });
        }
        
        await sessionsService.setEstado(phone, 'ENCARGO_SOLICITADO');
        
        const mensaje = `✅ *¡Su encargo ha sido procesado!*\n\n` +
                        `📦 Sus repuestos fueron solicitados a nuestra bodega central. ` +
                        `El tiempo estimado de llegada a nuestro local es de *${dias_eta} día(s)* hábiles aproximados.\n\n` +
                        `Le notificaremos inmediatamente por este medio cuando los repuestos estén listos para entrega/despacho. ¡Gracias por confiar en *Repuestos JFNN*! 🙌`;
                        
        await whatsappService.sendTextMessage(phone, mensaje);
        
        res.status(200).json({ success: true, estado: 'ENCARGO_SOLICITADO' });
    } catch (error) {
        console.error('Error en solicitar encargo:', error);
        res.status(500).json({ error: 'Error interno' });
    }
});

/**
 * [HU-3] Marcar un encargo como recibido en local y cobrar saldo
 * POST /api/dashboard/encargos/recibido
 */
router.post('/encargos/recibido', async (req, res) => {
    try {
        const { phone } = req.body;
        if (!phone) return res.status(400).json({ error: "Teléfono requerido." });
        
        const session = await sessionsService.getSession(phone);
        const e = session.entidades || {};
        
        const repuestos = (e.repuestos_solicitados || []).map(r => ({
            ...r, 
            precio: normalizarPrecio(r.precio) || 0,
            cantidad: r.cantidad || 1
        }));
        const totalCotizacion = repuestos.reduce((acc, r) => acc + ((r.precio || 0) * r.cantidad), 0);
        
        const montoAbono = normalizarPrecio(e.pago_pendiente?.monto || 0);
        const saldoPendiente = Math.max(0, totalCotizacion - montoAbono);
        
        // Formatear precios
        const formatMoney = (val) => new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP" }).format(val);
        
        let mensaje;
        let nuevoEstado;
        
        if (saldoPendiente > 0) {
            nuevoEstado = 'ESPERANDO_SALDO';
            mensaje = `🎉 *¡Buena noticia! Sus repuestos ya llegaron a nuestro local.*\n\n` +
                      `Para proceder con la entrega o despacho, necesitamos que por favor realice el pago del *saldo pendiente*.\n\n` +
                      `🧾 *Resumen:*\n` +
                      `- Total Cotización: ${formatMoney(totalCotizacion)}\n` +
                      `- Abono Registrado: ${formatMoney(montoAbono)}\n` +
                      `- **Saldo a Pagar: ${formatMoney(saldoPendiente)}**\n\n` +
                      `Por favor, envíenos el *comprobante de transferencia* del saldo pendiente por aquí mismo para validar y hacer la entrega.`;
        } else {
            nuevoEstado = 'PAGO_VERIFICADO'; // Ya pagó todo
             mensaje = `🎉 *¡Buena noticia! Sus repuestos ya llegaron a nuestro local.*\n\n` +
                      `Su pedido está completamente pagado. En breve gestionaremos la logística de entrega.`;
        }
        
        await sessionsService.setEstado(phone, nuevoEstado);
        await whatsappService.sendTextMessage(phone, mensaje);
        
        res.status(200).json({ success: true, estado: nuevoEstado, saldo: saldoPendiente });
    } catch (error) {
        console.error('Error en recibir encargo:', error);
        res.status(500).json({ error: 'Error interno' });
    }
});

/**
 * Activar o desactivar el agente IA para una sesión específica (HU-3)
 */
router.patch('/sessions/:phone/pausa', async (req, res) => {
    try {
        const { phone } = req.params;
        const { pausado } = req.body;

        if (typeof pausado !== 'boolean') {
            return res.status(400).json({ error: 'El campo "pausado" debe ser un booleano.' });
        }

        const data = await sessionsService.setAgentePausado(phone, pausado);
        if (!data) {
            return res.status(404).json({ error: 'Sesión no encontrada o error al actualizar.' });
        }

        res.status(200).json({ success: true, pausado });
    } catch (error) {
        console.error('Error al pausar agente:', error);
        res.status(500).json({ error: 'Error interno' });
    }
});

/**
 * Actualizar las entidades de una sesión (útil para guardar repuestos agregados manualmente sin responder la cotización)
 */
router.patch('/sessions/:phone/entidades', async (req, res) => {
    try {
        const { phone } = req.params;
        const { entidades } = req.body;

        if (!entidades) {
            return res.status(400).json({ error: 'El campo "entidades" es obligatorio.' });
        }

        const data = await sessionsService.updateEntidades(phone, entidades);
        if (!data) {
            return res.status(404).json({ error: 'Sesión no encontrada o error al actualizar.' });
        }

        res.status(200).json({ success: true, entidades: data.entidades });
    } catch (error) {
        console.error('Error al actualizar entidades:', error);
        res.status(500).json({ error: 'Error interno' });
    }
});

// ═══════════════════════════════════════════════════════════════
// HU-7: Entrenador IA — Knowledge Base
// ═══════════════════════════════════════════════════════════════

/**
 * Regenera knowledge.json desde los training_examples activos en DB.
 * Se llama después de insertar o desactivar reglas.
 */
async function regenerarKnowledgeJson() {
    const result = await db.query(
        `SELECT contenido_md FROM training_examples WHERE activo = TRUE ORDER BY fecha ASC`
    );
    // Extraer reglas parseando el contenido_md (formato: "regla: texto | categoria: cat")
    const reglas = result.rows.map(row => {
        const match = row.contenido_md.match(/^regla:\s*(.+?)(?:\s*\|\s*categoria:\s*(.+))?$/i);
        return match
            ? { regla: match[1].trim(), categoria: (match[2] || 'general').trim() }
            : { regla: row.contenido_md.trim(), categoria: 'general' };
    });
    const data = { reglas, ultima_actualizacion: new Date().toISOString() };
    fs.writeFileSync(KNOWLEDGE_JSON_PATH, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * [HU-7] Entrenar al agente con historial de conversaciones
 * POST /api/settings/train
 * Body: { texto: string }
 */
router.post('/settings/train', async (req, res) => {
    try {
        const { texto } = req.body;
        if (!texto || texto.trim().length < 20) {
            return res.status(400).json({ error: 'Se requiere un historial de conversación con al menos 20 caracteres.' });
        }

        const reglas = await geminiService.trainAgentWithHistory(texto);

        if (reglas.length === 0) {
            return res.status(200).json({ success: true, reglas: [], mensaje: 'No se encontraron reglas accionables en el texto proporcionado.' });
        }

        // Guardar cada regla en la tabla training_examples
        for (const r of reglas) {
            const contenidoMd = `regla: ${r.regla} | categoria: ${r.categoria || 'general'}`;
            await db.query(
                `INSERT INTO training_examples (contenido_md) VALUES ($1)`,
                [contenidoMd]
            );
        }

        // Sincronizar knowledge.json con la DB actualizada
        await regenerarKnowledgeJson();

        console.log(`[HU-7] ✅ ${reglas.length} reglas guardadas en DB y knowledge.json regenerado.`);
        res.status(201).json({ success: true, reglas, total: reglas.length });

    } catch (error) {
        console.error('[HU-7] Error en POST /settings/train:', error);
        res.status(500).json({ error: 'Error interno al entrenar al agente.' });
    }
});

/**
 * [HU-7] Listar reglas activas del knowledge base
 * GET /api/settings/knowledge
 */
router.get('/settings/knowledge', async (_req, res) => {
    try {
        const result = await db.query(
            `SELECT id, contenido_md, fecha FROM training_examples WHERE activo = TRUE ORDER BY fecha DESC`
        );

        const reglas = result.rows.map(row => {
            const match = row.contenido_md.match(/^regla:\s*(.+?)(?:\s*\|\s*categoria:\s*(.+))?$/i);
            return {
                id: row.id,
                regla: match ? match[1].trim() : row.contenido_md.trim(),
                categoria: match ? (match[2] || 'general').trim() : 'general',
                fecha: row.fecha
            };
        });

        res.status(200).json({ total: reglas.length, reglas });

    } catch (error) {
        console.error('[HU-7] Error en GET /settings/knowledge:', error);
        res.status(500).json({ error: 'Error interno al obtener las reglas.' });
    }
});

/**
 * [HU-7] Eliminar (desactivar) una regla del knowledge base
 * DELETE /api/settings/knowledge/:id
 */
router.delete('/settings/knowledge/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await db.query(
            `UPDATE training_examples SET activo = FALSE WHERE id = $1 RETURNING id`,
            [id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: `No se encontró la regla con id ${id}.` });
        }

        // Regenerar knowledge.json sin la regla eliminada
        await regenerarKnowledgeJson();

        console.log(`[HU-7] 🗑️ Regla #${id} desactivada y knowledge.json actualizado.`);
        res.status(200).json({ success: true, id: parseInt(id) });

    } catch (error) {
        console.error('[HU-7] Error en DELETE /settings/knowledge/:id:', error);
        res.status(500).json({ error: 'Error interno al eliminar la regla.' });
    }
});

/**
 * [HU-8] Solicitar VIN manualmente desde el dashboard
 * POST /api/dashboard/solicitar-vin
 */
router.post('/solicitar-vin', async (req, res) => {
    try {
        const { phone, itemName } = req.body;
        if (!phone) {
            return res.status(400).json({ error: 'El campo "phone" es obligatorio.' });
        }

        const mensaje = itemName
            ? `Hola, para identificar con exactitud el repuesto "${itemName}", ¿podría enviarnos el VIN (número de chasis) de su vehículo, por favor?`
            : `Hola, para verificar la compatibilidad exacta de los repuestos, ¿podría enviarnos el VIN (número de chasis) de su vehículo, por favor?`;

        await whatsappService.sendTextMessage(phone, mensaje);

        res.status(200).json({ success: true, mensaje: 'Solicitud de VIN enviada exitosamente.' });
    } catch (error) {
        console.error('Error enviando solicitud de VIN:', error);
        res.status(500).json({ error: 'Error interno al enviar solicitud de VIN.' });
    }
});

// ═══════════════════════════════════════════════════════════════
// POST /auto-archive — Archivado manual de sesiones abandonadas
// ═══════════════════════════════════════════════════════════════
router.post('/auto-archive', async (req, res) => {
    try {
        const hours = parseInt(req.body.hours) || 48;
        const result = await sessionsService.autoArchiveStaleSessions(hours);
        res.status(200).json({
            success: true,
            message: `Auto-archivado completado. ${result.archived} sesiones procesadas.`,
            ...result
        });
    } catch (error) {
        console.error('Error en auto-archive:', error);
        res.status(500).json({ error: 'Error interno al ejecutar auto-archivado.' });
    }
});

module.exports = router;
