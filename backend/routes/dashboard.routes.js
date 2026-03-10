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
        res.status(200).json(pending);
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
        const { phone, items, note } = req.body;

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

        // Actualizar sesión: Guardar ID de cotización y pasar al flujo de cierre
        await sessionsService.updateEntidades(phone, { quote_id: quoteId });
        await sessionsService.setEstado(phone, 'CONFIRMANDO_COMPRA');

        res.status(200).json({ success: true, quoteId });
    } catch (error) {
        console.error('Error respondiendo al cliente:', error);
        res.status(500).json({ error: 'Error al enviar mensaje' });
    }
});

/**
 * Actualizar estado de una cotización
 */
router.patch('/cotizaciones/estado', async (req, res) => {
    try {
        const { phone, estado, notify } = req.body;

        if (!phone || !estado) {
            return res.status(400).json({ error: 'Faltan campos obligatorios' });
        }

        const session = await sessionsService.setEstado(phone, estado);

        if (notify) {
            let message = "";
            if (estado === 'PAGO_VERIFICADO') {
                message = "✅ Hemos verificado su pago. Estamos preparando su pedido para despacho/retiro. ¡Muchas gracias!";
            } else if (estado === 'ENTREGADO') {
                message = "📦 Su pedido ha sido entregado/retirado con éxito. ¡Gracias por preferir JFNN! \n\n" +
                    "⭐ Si le gustó nuestra atención, le agradeceríamos mucho una breve reseña aquí: https://g.page/r/CZX1WTZpPafHEBM/review \n" +
                    "Nos ayuda mucho a seguir creciendo. ¡Que tenga un excelente día!";
            }

            if (message) {
                await whatsappService.sendTextMessage(phone, message);
            }
        }

        res.status(200).json({ success: true, estado: session.estado });
    } catch (error) {
        console.error('Error actualizando estado:', error);
        res.status(500).json({ error: 'Error interno' });
    }
});

/**
 * [P1] Obtener sesiones esperando aprobación manual del admin
 * GET /api/dashboard/pending-approvals
 */
router.get('/pending-approvals', async (req, res) => {
    try {
        const sessions = await sessionsService.getPendingApprovalSessions();

        // Transformar la respuesta para incluir solo los campos relevantes para el admin
        const formatted = sessions.map(s => {
            const e = s.entidades || {};

            // Calcular total de la cotización sumando los repuestos con precio
            const totalCotizacion = (e.repuestos_solicitados || []).reduce((acc, r) => {
                return acc + (parseInt(r.precio) || 0);
            }, 0);

            return {
                phone: s.phone,
                estado: s.estado,
                ultimo_mensaje: s.ultimo_mensaje,
                quote_id: e.quote_id || null,
                // Datos del vehículo y repuestos
                vehiculo: {
                    marca_modelo: e.marca_modelo,
                    ano: e.ano,
                    patente: e.patente,
                    vin: e.vin,
                },
                repuestos: e.repuestos_solicitados || [],
                total_cotizacion: totalCotizacion,
                // Datos de logística
                metodo_entrega: e.metodo_entrega || null,
                direccion_envio: e.direccion_envio || null,
                tipo_documento: e.tipo_documento || null,
                // Datos del comprobante (extraídos por IA)
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
 */
router.post('/verify-payment', async (req, res) => {
    try {
        const { phone, accion, nota_admin } = req.body;

        if (!phone || !['approve', 'reject'].includes(accion)) {
            return res.status(400).json({
                error: "Faltan campos obligatorios. 'phone' y 'accion' (approve/reject) son requeridos."
            });
        }

        // Verificar que la sesión esté en el estado correcto antes de actuar
        const session = await sessionsService.getSession(phone);
        if (session.estado !== 'ESPERANDO_APROBACION_ADMIN') {
            return res.status(409).json({
                error: `Conflicto de estado: la sesión del cliente está en '${session.estado}', no en 'ESPERANDO_APROBACION_ADMIN'.`
            });
        }

        if (accion === 'approve') {
            // ─── APROBAR ──────────────────────────────────────────────
            await sessionsService.setEstado(phone, 'PAGO_VERIFICADO');

            const mensajeAprobacion =
                `✅ *¡Pago confirmado!* Su transferencia fue verificada exitosamente por nuestro equipo.\n\n` +
                `📦 Estamos preparando su pedido. En breve le informaremos sobre los detalles del despacho/retiro.\n\n` +
                `Número de cotización: *${session.entidades?.quote_id || 'JFNN-TEMP'}*\n` +
                `¡Muchas gracias por su preferencia! 🙌`;

            await whatsappService.sendTextMessage(phone, mensajeAprobacion);

            console.log(`[Dashboard] ✅ Pago APROBADO para ${phone}${nota_admin ? ` | Nota: ${nota_admin}` : ''}`);
            res.status(200).json({
                success: true,
                accion: 'approved',
                nuevo_estado: 'PAGO_VERIFICADO',
                phone
            });

        } else if (accion === 'reject') {
            // ─── RECHAZAR ─────────────────────────────────────────────
            // Regresa al cliente al estado de confirmación para que reenvíe el comprobante
            await sessionsService.setEstado(phone, 'CONFIRMANDO_COMPRA');

            const motivoRechazo = nota_admin
                ? `El motivo indicado por nuestro equipo es: _${nota_admin}_`
                : `Esto puede deberse a que la imagen no era legible o no correspondía a la cotización.`;

            const mensajeRechazo =
                `⚠️ Lamentablemente *no pudimos verificar* el comprobante enviado. ${motivoRechazo}\n\n` +
                `Le pedimos que envíe nuevamente una fotografía clara del comprobante de transferencia. ` +
                `Si tiene dudas, puede escribirnos y con gusto le ayudamos. 🙏`;

            await whatsappService.sendTextMessage(phone, mensajeRechazo);

            console.log(`[Dashboard] ❌ Pago RECHAZADO para ${phone}${nota_admin ? ` | Motivo: ${nota_admin}` : ''}`);
            res.status(200).json({
                success: true,
                accion: 'rejected',
                nuevo_estado: 'CONFIRMANDO_COMPRA',
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

module.exports = router;
