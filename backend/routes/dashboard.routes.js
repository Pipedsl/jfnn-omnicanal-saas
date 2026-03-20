const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const sessionsService = require('../services/sessions.service');
const whatsappService = require('../services/whatsapp.service');

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

            return {
                ...session,
                entidades: {
                    ...e,
                    repuestos_solicitados: repuestosNormalizados
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
        const { phone, items, note, horario_entrega } = req.body;

        if (!phone || !items || !Array.isArray(items)) {
            return res.status(400).json({ error: 'Faltan campos obligatorios' });
        }

        const quoteId = `JFNN-2026-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        let total = 0;

        const details = items.map(item => {
            const disponibilidad = item.disponibilidad || "DISPONIBLE";
            const isAgotado = disponibilidad === "SIN_STOCK";
            const isEncargo = disponibilidad === "POR_ENCARGO";
            const priceStr = item.precio ? parseInt(item.precio).toLocaleString('es-CL') : null;

            if (isAgotado) {
                return `❌ ${item.nombre} - Agotado momentáneamente`;
            }

            if (priceStr) total += parseInt(item.precio);

            if (isEncargo) {
                return `📦 ${item.nombre} | $${priceStr} (Requiere abono previo)`;
            }

            return `✔️ ${item.nombre} | Cód: ${item.codigo || 'N/A'} | $${priceStr || 0}`;
        }).join('\n');

        const message = `*COTIZACIÓN FORMAL - JFNN*\n` +
            `📄 ID: ${quoteId}\n\n` +
            `Estimado cliente, revisamos el stock de lo solicitado:\n\n` +
            `${details}\n\n` +
            (total > 0 ? `*TOTAL APROXIMADO: $${total.toLocaleString('es-CL')}*\n\n` : '') +
            `${note ? `📝 Nota del asesor: ${note}\n\n` : ''}` +
            `--- \n` +
            `🏢 Origen: Venta Online / WhatsApp\n` +
            `👤 Atentamente: Asesor JFNN\n\n` +
            `¿Deseas confirmar la compra o el encargo de los productos disponibles?`;

        await whatsappService.sendTextMessage(phone, message);

        // Actualizar sesión: Guardar ID de cotización, total, horario, precios y pasar al flujo de cierre
        await sessionsService.updateEntidades(phone, {
            quote_id: quoteId,
            total_cotizacion: total,
            horario_entrega: horario_entrega || null,
            repuestos_solicitados: items // Persitir los precios individuales editados por el vendedor
        });
        await sessionsService.setEstado(phone, 'CONFIRMANDO_COMPRA');

        res.status(200).json({ success: true, quoteId });
    } catch (error) {
        console.error('Error respondiendo al cliente:', error);
        res.status(500).json({ error: 'Error al enviar mensaje' });
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
        const { phone, estado, notify, mensaje_logistica } = req.body;

        if (!phone || !estado) {
            return res.status(400).json({ error: 'Faltan campos obligatorios' });
        }

        const session = await sessionsService.setEstado(phone, estado);

        if (notify) {
            let message = "";

            if (estado === 'ENTREGADO') {
                // El vendedor confirma la logística desde su panel.
                // Si escribió un mensaje personalizado, se lo enviamos al cliente.
                // Si no, usamos el mensaje genérico de entrega.
                if (mensaje_logistica && mensaje_logistica.trim()) {
                    message =
                        `✅ *¡Su pago fue confirmado!* Gracias por su preferencia.\n\n` +
                        `📦 *Información de despacho/retiro:*\n${mensaje_logistica.trim()}\n\n` +
                        `¡Muchas gracias por preferir *Repuestos JFNN*! 🙌`;
                } else {
                    message =
                        `✅ *¡Su pago fue verificado!* Estamos preparando su pedido.\n\n` +
                        `📦 En breve le informaremos sobre el despacho o puede pasar a retirarlo a nuestro local.\n\n` +
                        `¡Muchas gracias por preferir *Repuestos JFNN*! 🙌`;
                }
            }
            // NOTA: El estado PAGO_VERIFICADO NO notifica al cliente.
            // La notificación la gestiona el vendedor al confirmar la logística (ENTREGADO).
            if (message) {
                await whatsappService.sendTextMessage(phone, message);
                
                // HU-6: Solicitud de reseña en Google Maps
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

            // Calcular total usando los precios ya normalizados
            const totalCotizacion = repuestosNormalizados.reduce((acc, r) => {
                return acc + (r.precio || 0);
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
                        `📦 Hemos solicitado sus repuestos a nuestro proveedor. ` +
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
            ...r, precio: normalizarPrecio(r.precio) || 0
        }));
        const totalCotizacion = repuestos.reduce((acc, r) => acc + (r.precio || 0), 0);
        
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

module.exports = router;
