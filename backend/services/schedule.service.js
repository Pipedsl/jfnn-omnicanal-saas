/**
 * schedule.service.js — Gestión de horario de atención + feriados chilenos.
 *
 * Zona horaria: America/Santiago (incluye DST automático de Chile).
 * Horario L-V: 9:00-13:50 y 15:01-18:30.
 * Horario Sáb: 9:00-13:00.
 * Dom + feriados: cerrado.
 *
 * Los feriados se leen desde la tabla `feriados` de PostgreSQL con cache de 24h.
 * Llamar invalidateCache() después de INSERT o DELETE en feriados.
 */

const db = require('../config/db');

// ─── Cache ────────────────────────────────────────────────────────
let feriadosCache = { dates: new Set(), loadedAt: 0 };
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

async function loadFeriados() {
    if (Date.now() - feriadosCache.loadedAt < CACHE_TTL_MS) return feriadosCache.dates;
    try {
        const { rows } = await db.query('SELECT fecha FROM feriados ORDER BY fecha');
        feriadosCache = {
            dates: new Set(rows.map(r => {
                const d = new Date(r.fecha);
                // Formatear como YYYY-MM-DD en UTC (DATE de PG no tiene hora)
                return d.toISOString().slice(0, 10);
            })),
            loadedAt: Date.now()
        };
        console.log(`[Schedule] ✅ Feriados cargados: ${feriadosCache.dates.size} fechas.`);
    } catch (err) {
        console.error('[Schedule] ⚠️ Error cargando feriados:', err.message);
        // Si falla la DB, mantener el cache anterior (o vacío)
        feriadosCache.loadedAt = Date.now(); // no reintentar hasta el próximo TTL
    }
    return feriadosCache.dates;
}

function invalidateCache() {
    feriadosCache.loadedAt = 0;
    console.log('[Schedule] 🔄 Cache de feriados invalidado.');
}

// ─── Utilidad de hora en Chile ────────────────────────────────────
function getChileTime(now = new Date()) {
    const tz = 'America/Santiago';
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', weekday: 'short',
        hour12: false
    }).formatToParts(now);

    const get = (type) => parts.find(p => p.type === type)?.value;
    const hour = parseInt(get('hour'));   // 0-23
    const minute = parseInt(get('minute'));
    const weekday = get('weekday'); // 'Sun','Mon',...
    const year = get('year');
    const month = get('month');
    const day = get('day');
    const dateStr = `${year}-${month}-${day}`; // YYYY-MM-DD

    return { hour, minute, weekday, dateStr, timeMinutes: hour * 60 + minute };
}

// ─── Estado de atención ───────────────────────────────────────────
/**
 * @returns {{ abierto: boolean, estado: 'ABIERTO'|'COLACION'|'CERRADO'|'FERIADO', mensaje: string|null }}
 */
async function getEstadoAtencion(now = new Date()) {
    const { hour, minute, weekday, dateStr, timeMinutes } = getChileTime(now);
    const feriados = await loadFeriados();

    // Domingo
    if (weekday === 'Sun') {
        return {
            abierto: false, estado: 'FERIADO',
            mensaje: 'Hoy es domingo y no atendemos. Nuestro horario es de lunes a viernes de 9:00 a 18:30 (colación de 13:50 a 15:01) y sábados de 9:00 a 13:00. Déjame los datos de tu consulta y el lunes a primera hora te contactamos. 😊'
        };
    }

    // Feriado
    if (feriados.has(dateStr)) {
        return {
            abierto: false, estado: 'FERIADO',
            mensaje: 'Hoy es feriado y estamos cerrados. Nuestro horario habitual es de lunes a viernes de 9:00 a 18:30 (colación de 13:50 a 15:01) y sábados de 9:00 a 13:00. Cuéntame qué repuestos necesitas y te respondemos en cuanto retomemos. 🙌'
        };
    }

    // Sábado: 9:00-13:00
    if (weekday === 'Sat') {
        if (timeMinutes >= 540 && timeMinutes < 780) {
            return { abierto: true, estado: 'ABIERTO', mensaje: null };
        }
        const esManana = timeMinutes < 540;
        return {
            abierto: false, estado: 'CERRADO',
            mensaje: esManana
                ? 'Aún no hemos abierto. Los sábados atendemos de 9:00 a 13:00. Cuéntame qué necesitas y en cuanto abramos te respondemos. 🙌'
                : 'Ya cerramos por hoy. Los sábados atendemos de 9:00 a 13:00. El lunes desde las 9:00 estamos disponibles. Cuéntame qué necesitas y te contactamos. 😊'
        };
    }

    // Lunes a Viernes
    // Antes de abrir: <9:00
    if (timeMinutes < 540) {
        return {
            abierto: false, estado: 'CERRADO',
            mensaje: 'Aún no hemos abierto. Nuestro horario es de lunes a viernes de 9:00 a 18:30 (colación de 13:50 a 15:01) y sábados de 9:00 a 13:00. Cuéntame qué necesitas y te respondemos al abrir. 🙌'
        };
    }

    // Mañana: 9:00-13:50
    if (timeMinutes < 830) {
        return { abierto: true, estado: 'ABIERTO', mensaje: null };
    }

    // Colación: 13:50-15:01
    if (timeMinutes < 901) {
        return {
            abierto: false, estado: 'COLACION',
            mensaje: 'Estamos en horario de colación 🍽️. Nuestros asesores regresan a las 15:01. Mientras tanto, cuéntame qué repuestos necesitas y lo dejamos todo listo para cuando vuelvan.'
        };
    }

    // Tarde: 15:01-18:30
    if (timeMinutes < 1110) {
        return { abierto: true, estado: 'ABIERTO', mensaje: null };
    }

    // Después de 18:30
    return {
        abierto: false, estado: 'CERRADO',
        mensaje: 'Ya cerramos por hoy. Nuestro horario es de lunes a viernes de 9:00 a 18:30 (colación de 13:50 a 15:01) y sábados de 9:00 a 13:00. Cuéntame qué necesitas y mañana a primera hora te respondemos. 😊'
    };
}

module.exports = { getEstadoAtencion, invalidateCache, loadFeriados };
