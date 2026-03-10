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

module.exports = router;
