/**
 * audit.service.js — Registro de auditoría de acciones sensibles del dashboard.
 *
 * Registra QUIÉN (vendedor/rol/sucursal) hizo QUÉ (archivar, cambiar estado, verificar pago,
 * etc.) sobre qué cliente. Solo el rol `soporte` puede leer estos logs.
 *
 * El INSERT es ADITIVO y tolerante a fallos: si falla, se loguea y el flujo principal continúa.
 */
'use strict';

const db = require('../config/db');

/**
 * Registra una acción de auditoría.
 * @param {object} p
 * @param {object} [p.req]            - Request Express (para extraer actor del JWT/headers/ip)
 * @param {string} p.action          - 'archivar' | 'cambiar_estado' | 'rectificar' | 'verificar_pago' | 'asignar_vendedor' | 'reactivar' | ...
 * @param {string} [p.actorNombre]   - Nombre del vendedor (si no viene en req.body)
 * @param {string} [p.targetPhone]
 * @param {string} [p.targetQuoteId]
 * @param {string} [p.estadoAnterior]
 * @param {string} [p.estadoNuevo]
 * @param {string} [p.motivo]
 * @param {object} [p.detalle]
 */
const registrarAccion = async ({
    req = null,
    action,
    actorNombre = null,
    targetPhone = null,
    targetQuoteId = null,
    estadoAnterior = null,
    estadoNuevo = null,
    motivo = null,
    detalle = {},
} = {}) => {
    try {
        const actorRole = req?.user?.role || 'sistema';
        const actorSucursal = req?.user?.sucursal || null;
        const nombre = actorNombre
            || req?.body?.vendedor_nombre
            || req?.headers?.['x-user-nombre']
            || null;
        const ip = req?.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || req?.ip || null;

        await db.query(
            `INSERT INTO audit_logs
                (actor_role, actor_nombre, actor_sucursal, action, target_phone, target_quote_id,
                 estado_anterior, estado_nuevo, motivo, detalle, ip)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [actorRole, nombre, actorSucursal, action, targetPhone, targetQuoteId,
             estadoAnterior, estadoNuevo, motivo, JSON.stringify(detalle || {}), ip]
        );
        console.log(`[Audit] 📝 ${actorRole}${nombre ? '/' + nombre : ''} → ${action}${targetPhone ? ' (' + targetPhone + ')' : ''}`);
    } catch (err) {
        console.error('[Audit] ❌ No se pudo registrar acción (flujo continúa):', err.message);
    }
};

/**
 * Lista logs de auditoría con filtros (para la vista de soporte).
 */
const listar = async ({ from = null, to = null, action = null, phone = null, actor = null, limit = 200 } = {}) => {
    try {
        const conds = [];
        const params = [];
        if (from) { params.push(from); conds.push(`created_at >= $${params.length}`); }
        if (to) { params.push(to); conds.push(`created_at <= $${params.length}`); }
        if (action) { params.push(action); conds.push(`action = $${params.length}`); }
        if (phone) { params.push(`%${phone}%`); conds.push(`target_phone ILIKE $${params.length}`); }
        if (actor) { params.push(`%${actor}%`); conds.push(`actor_nombre ILIKE $${params.length}`); }
        const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
        const lim = Math.min(parseInt(limit, 10) || 200, 1000);
        const { rows } = await db.query(
            `SELECT * FROM audit_logs ${where} ORDER BY created_at DESC LIMIT ${lim}`,
            params
        );
        return rows;
    } catch (err) {
        console.error('[Audit] ❌ Error listando logs:', err.message);
        return [];
    }
};

module.exports = { registrarAccion, listar };
