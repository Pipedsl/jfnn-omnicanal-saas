/**
 * reengage.service.js — Re-enganche automático al abrir el local.
 *
 * Cuando el local PASA de cerrado a abierto (transición — una sola pasada por apertura,
 * ej. 9:00 y 15:00), busca las sesiones en ESPERANDO_VENDEDOR cuya ventana de 24h de
 * WhatsApp está CERRADA (último mensaje entrante del cliente hace más de 24h) y les envía
 * la plantilla HSM `estamos_de_vuelta` para reabrir el canal y no perder la venta.
 *
 * El flag `entidades.vuelta_template_enviada` evita reenvíos; se limpia cuando el cliente
 * responde (en el controller del webhook), para que aplique de nuevo en una próxima
 * ventana cerrada.
 */

const db = require('../config/db');
const scheduleService = require('./schedule.service');
const whatsappService = require('./whatsapp.service');
const sessionsService = require('./sessions.service');

const VENTANA_24H_MS = 24 * 60 * 60 * 1000;

// Estado de transición (cerrado→abierto). null en el primer chequeo.
let previamenteAbierto = null;

// La plantilla no estaba registrada en el código; idioma exacto desconocido. Intentamos
// es_CL (Chile) y luego es. Configurable por env si Meta la tiene con otro código.
const VUELTA_LANGS = (process.env.ESTAMOS_DE_VUELTA_LANG || 'es_CL,es').split(',').map(s => s.trim()).filter(Boolean);

async function enviarPlantillaVuelta(phone) {
    for (const lang of VUELTA_LANGS) {
        try {
            await whatsappService.sendTemplateMessage(phone, 'estamos_de_vuelta', lang, []);
            return true;
        } catch (err) {
            console.warn(`[Reengage] ⚠️ estamos_de_vuelta lang=${lang} falló para ${phone}: ${err.message}`);
        }
    }
    return false;
}

/**
 * Corre periódicamente pero SOLO actúa en la transición cerrado→abierto.
 */
async function reengancharAlAbrir() {
    try {
        const { abierto } = await scheduleService.getEstadoAtencion();
        const eraAbierto = previamenteAbierto;
        previamenteAbierto = abierto;

        if (!abierto) return;                 // cerrado → nada
        if (eraAbierto === true) return;      // ya estaba abierto → no es transición
        // eraAbierto === false (acaba de abrir) o null (primer chequeo ya abierto, ej.
        // redeploy a media jornada) → procesamos. El flag evita reenvíos duplicados.

        console.log('[Reengage] 🔔 Apertura detectada. Buscando ESPERANDO_VENDEDOR con ventana 24h cerrada…');
        const { rows } = await db.query(`
            SELECT s.phone,
                   (SELECT MAX(m.created_at) FROM mensajes m
                      WHERE m.phone = s.phone AND m.direccion = 'entrante') AS ultimo_entrante
            FROM user_sessions s
            WHERE s.estado = 'ESPERANDO_VENDEDOR'
              AND COALESCE((s.entidades->>'vuelta_template_enviada')::boolean, false) = false
        `);

        const limiteVentana = Date.now() - VENTANA_24H_MS;
        let enviados = 0, candidatas = 0;
        for (const r of rows) {
            if (!r.ultimo_entrante) continue;                                  // sin mensajes entrantes → saltar
            if (new Date(r.ultimo_entrante).getTime() > limiteVentana) continue; // ventana AÚN abierta → no hace falta plantilla
            candidatas++;
            const ok = await enviarPlantillaVuelta(r.phone);
            if (ok) {
                await sessionsService.updateEntidades(r.phone, {
                    vuelta_template_enviada: true,
                    vuelta_template_at: new Date().toISOString(),
                });
                enviados++;
            }
            await new Promise(res => setTimeout(res, 1200)); // throttle suave anti-rate-limit
        }
        console.log(`[Reengage] ✅ ${enviados}/${candidatas} plantilla(s) estamos_de_vuelta enviada(s) (de ${rows.length} en espera).`);
    } catch (err) {
        console.error('[Reengage] ❌ Error en reengancharAlAbrir:', err.message);
    }
}

module.exports = { reengancharAlAbrir };
