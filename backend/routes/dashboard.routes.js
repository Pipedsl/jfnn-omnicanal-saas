const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sessionsService = require('../services/sessions.service');
const whatsappService = require('../services/whatsapp.service');
const geminiService = require('../services/gemini.service');
const db = require('../config/db');
const vendedoresService = require('../services/vendedores.service');
const mensajesService = require('../services/mensajes.service');
const auditService = require('../services/audit.service');
const { requireSoporte } = require('../middleware/auth.middleware');
const storageService = require('../services/storage.service');
const cotizacionesService = require('../services/cotizaciones.service');
const { getDireccionSucursal } = require('../utils/sucursales');
const { cancelDebounce } = require('../controllers/whatsapp.controller');

const KNOWLEDGE_JSON_PATH = path.join(__dirname, '../data/knowledge.json');

/**
 * [P0] Calcular métricas del negocio
 * GET /api/dashboard/metrics
 */
/**
 * Listado de ventas con desglose de mensajes IA vs vendedor.
 * GET /api/dashboard/ventas?range=hoy|7d|30d|total&limit=20
 * Usado por la página /admin/estadisticas para la tabla de atribución.
 */
router.get('/ventas', async (req, res) => {
    try {
        const allowedRanges = ['hoy', '7d', '30d', 'total'];
        const range = allowedRanges.includes(req.query.range) ? req.query.range : '30d';
        const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);

        const METRICS_RESET_AT = process.env.METRICS_RESET_AT || '2026-05-27T13:00:00Z';
        const resetClause = `archivado_en >= '${METRICS_RESET_AT}'::timestamptz`;
        const filtroSql = (() => {
            switch (range) {
                case 'hoy': return `DATE(archivado_en AT TIME ZONE 'America/Santiago') = DATE(NOW() AT TIME ZONE 'America/Santiago') AND ${resetClause}`;
                case '7d': return `archivado_en AT TIME ZONE 'America/Santiago' >= (NOW() AT TIME ZONE 'America/Santiago') - INTERVAL '7 days' AND ${resetClause}`;
                case 'total': return resetClause;
                case '30d':
                default: return `archivado_en AT TIME ZONE 'America/Santiago' >= (NOW() AT TIME ZONE 'America/Santiago') - INTERVAL '30 days' AND ${resetClause}`;
            }
        })();

        const sucursal = req.query.sucursal || null;
        const vendedor = req.query.vendedor || null;
        const params = [limit];
        let extraFilter = '';
        if (sucursal) { params.push(sucursal); extraFilter += ` AND sucursal = $${params.length}`; }
        if (vendedor) { params.push(vendedor); extraFilter += ` AND vendedor_nombre = $${params.length}`; }

        const { rows } = await db.query(
            `SELECT id, phone, quote_id, estado_final, marca_modelo, ano, total_cotizacion,
                    mensajes_ia_total, mensajes_vendedor_total,
                    archivado_en, created_at, vendedor_nombre, sucursal,
                    EXTRACT(EPOCH FROM (archivado_en - created_at))/60 AS duracion_min
             FROM pedidos
             WHERE ${filtroSql}
               AND estado_final IN ('ENTREGADO', 'DESPACHADO', 'PAGO_VERIFICADO')${extraFilter}
             ORDER BY archivado_en DESC
             LIMIT $1`,
            params
        );

        res.status(200).json({
            range,
            total: rows.length,
            ventas: rows.map(r => ({
                id: r.id,
                phone: r.phone,
                quote_id: r.quote_id,
                estado_final: r.estado_final,
                marca_modelo: r.marca_modelo,
                ano: r.ano,
                total_cotizacion: r.total_cotizacion,
                mensajes_ia: r.mensajes_ia_total || 0,
                mensajes_vendedor: r.mensajes_vendedor_total || 0,
                duracion_min: Math.round(parseFloat(r.duracion_min) || 0),
                archivado_en: r.archivado_en,
                created_at: r.created_at,
                vendedor_nombre: r.vendedor_nombre || null,
                sucursal: r.sucursal || null
            }))
        });
    } catch (error) {
        console.error('Error obteniendo ventas:', error);
        res.status(500).json({ error: 'Error interno' });
    }
});

/**
 * [SOPORTE] Log de auditoría — solo el rol soporte puede leerlo.
 * GET /api/dashboard/audit-logs?from&to&action&phone&actor&limit
 */
router.get('/audit-logs', requireSoporte, async (req, res) => {
    try {
        const { from, to, action, phone, actor, limit } = req.query;
        const logs = await auditService.listar({ from, to, action, phone, actor, limit });
        res.json({ total: logs.length, logs });
    } catch (error) {
        console.error('[Dashboard] Error en GET /audit-logs:', error);
        res.status(500).json({ error: 'Error interno' });
    }
});

/**
 * [SOPORTE] Reactivar una sesión archivada → vuelve a ESPERANDO_VENDEDOR para que el
 * vendedor la cotice. Acción correctiva, solo soporte, queda auditada.
 * POST /api/dashboard/cotizaciones/:phone/reactivar   Body: { motivo? }
 */
router.post('/cotizaciones/:phone/reactivar', requireSoporte, async (req, res) => {
    try {
        const { phone } = req.params;
        const { motivo } = req.body || {};
        const session = await sessionsService.getSession(phone);
        if (!session) return res.status(404).json({ error: 'Sesión no encontrada' });
        const anterior = session.estado;
        await sessionsService.setEstado(phone, 'ESPERANDO_VENDEDOR');
        auditService.registrarAccion({
            req, action: 'reactivar', targetPhone: phone,
            targetQuoteId: session.entidades?.quote_id || null,
            estadoAnterior: anterior, estadoNuevo: 'ESPERANDO_VENDEDOR', motivo: motivo || null,
        });
        res.json({ success: true, phone, estado_anterior: anterior, nuevo_estado: 'ESPERANDO_VENDEDOR' });
    } catch (error) {
        console.error('[Dashboard] Error en reactivar:', error);
        res.status(500).json({ error: 'Error interno' });
    }
});

/**
 * [SOPORTE] Costos de infraestructura por mes.
 * GET /api/dashboard/soporte/costos?mes=YYYY-MM
 * Auto-crea filas fijas (Vercel/Railway/Supabase) si no existen para ese mes.
 */
const COSTOS_FIJOS = [
    { servicio: 'supabase', monto_usd: 25, nota: 'Plan Pro' },
    { servicio: 'vercel', monto_usd: 20, nota: 'Plan Pro' },
    { servicio: 'railway', monto_usd: 20, nota: 'Plan Pro' },
];
router.get('/soporte/costos', requireSoporte, async (req, res) => {
    try {
        const mes = (req.query.mes || new Date().toISOString().slice(0, 7));
        if (!/^\d{4}-\d{2}$/.test(mes)) return res.status(400).json({ error: 'Formato mes inválido (YYYY-MM)' });
        // Auto-crear fijos si faltan (idempotente).
        for (const f of COSTOS_FIJOS) {
            await db.query(
                `INSERT INTO costos_infra (mes, servicio, monto_usd, nota)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (mes, servicio) DO NOTHING`,
                [mes, f.servicio, f.monto_usd, f.nota]
            );
        }
        const { rows } = await db.query(
            `SELECT * FROM costos_infra WHERE mes = $1
             ORDER BY CASE servicio
                 WHEN 'supabase' THEN 1 WHEN 'vercel' THEN 2 WHEN 'railway' THEN 3
                 WHEN 'gemini' THEN 4 WHEN 'whatsapp' THEN 5 ELSE 9 END, id`,
            [mes]
        );
        const total = rows.reduce((acc, r) => acc + Number(r.monto_usd || 0), 0);
        res.json({ mes, total_usd: total, costos: rows });
    } catch (error) {
        console.error('[Soporte/costos] GET error:', error);
        res.status(500).json({ error: 'Error interno' });
    }
});

router.post('/soporte/costos', requireSoporte, async (req, res) => {
    try {
        const { mes, servicio, monto_usd, nota } = req.body || {};
        if (!mes || !/^\d{4}-\d{2}$/.test(mes)) return res.status(400).json({ error: 'Formato mes inválido (YYYY-MM)' });
        if (!servicio || !String(servicio).trim()) return res.status(400).json({ error: 'servicio obligatorio' });
        const { rows } = await db.query(
            `INSERT INTO costos_infra (mes, servicio, monto_usd, nota, created_by)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (mes, servicio) DO UPDATE SET monto_usd = EXCLUDED.monto_usd, nota = EXCLUDED.nota, updated_at = now()
             RETURNING *`,
            [mes, String(servicio).trim().toLowerCase(), Number(monto_usd) || 0, nota || null, req.body.vendedor_nombre || null]
        );
        auditService.registrarAccion({ req, action: 'costo_infra_upsert', detalle: { mes, servicio, monto_usd } });
        res.json({ success: true, costo: rows[0] });
    } catch (error) {
        console.error('[Soporte/costos] POST error:', error);
        res.status(500).json({ error: 'Error interno' });
    }
});

router.patch('/soporte/costos/:id', requireSoporte, async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
        const { monto_usd, nota } = req.body || {};
        const { rows } = await db.query(
            `UPDATE costos_infra
             SET monto_usd = COALESCE($1, monto_usd), nota = COALESCE($2, nota), updated_at = now()
             WHERE id = $3 RETURNING *`,
            [monto_usd != null ? Number(monto_usd) : null, nota ?? null, id]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'no encontrado' });
        auditService.registrarAccion({ req, action: 'costo_infra_update', detalle: { id, monto_usd, nota } });
        res.json({ success: true, costo: rows[0] });
    } catch (error) {
        console.error('[Soporte/costos] PATCH error:', error);
        res.status(500).json({ error: 'Error interno' });
    }
});

router.delete('/soporte/costos/:id', requireSoporte, async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
        await db.query(`DELETE FROM costos_infra WHERE id = $1`, [id]);
        auditService.registrarAccion({ req, action: 'costo_infra_delete', detalle: { id } });
        res.json({ success: true });
    } catch (error) {
        console.error('[Soporte/costos] DELETE error:', error);
        res.status(500).json({ error: 'Error interno' });
    }
});

/**
 * [SOPORTE] Cambiar manualmente el estado de una sesión (override correctivo).
 * Solo cambia el estado; NO notifica al cliente ni archiva. Queda auditado.
 * PATCH /api/dashboard/soporte/sesion/:phone/estado   Body: { estado, motivo }
 */
router.patch('/soporte/sesion/:phone/estado', requireSoporte, async (req, res) => {
    try {
        const { phone } = req.params;
        const { estado, motivo } = req.body || {};
        const estadosValidos = Object.values(sessionsService.STATES);
        if (!estado || !estadosValidos.includes(estado)) {
            return res.status(400).json({ error: 'Estado inválido', estados_validos: estadosValidos });
        }
        if (!motivo || !String(motivo).trim()) {
            return res.status(400).json({ error: 'El motivo es obligatorio.' });
        }
        const session = await sessionsService.getSession(phone);
        if (!session) return res.status(404).json({ error: 'Sesión no encontrada' });
        const anterior = session.estado;
        await sessionsService.setEstado(phone, estado);
        auditService.registrarAccion({
            req, action: 'cambiar_estado_manual', targetPhone: phone,
            targetQuoteId: session.entidades?.quote_id || null,
            estadoAnterior: anterior, estadoNuevo: estado, motivo: String(motivo).trim(),
        });
        res.json({ success: true, phone, estado_anterior: anterior, nuevo_estado: estado });
    } catch (error) {
        console.error('[Dashboard] Error en cambio manual de estado:', error);
        res.status(500).json({ error: 'Error interno' });
    }
});

/**
 * [SOPORTE] Lista de ventas sin cerrar (cotizadas con precio pero en estado no terminal).
 * GET /api/dashboard/soporte/ventas-sin-cerrar
 */
router.get('/soporte/ventas-sin-cerrar', requireSoporte, async (req, res) => {
    try {
        const estados = ['CONFIRMANDO_COMPRA', 'ESPERANDO_COMPROBANTE', 'ESPERANDO_APROBACION_ADMIN',
            'PAGO_VERIFICADO', 'ABONO_VERIFICADO', 'ENCARGO_SOLICITADO', 'ESPERANDO_SALDO', 'ESPERANDO_RETIRO'];
        const { rows } = await db.query(
            `SELECT phone, estado, sucursal, lock_vendedor, ultimo_mensaje, entidades
             FROM user_sessions WHERE estado = ANY($1) ORDER BY ultimo_mensaje DESC`,
            [estados]
        );
        const ventas = rows.map(r => {
            const e = r.entidades || {};
            const reps = [
                ...(e.repuestos_solicitados || []),
                ...((e.vehiculos || []).flatMap(v => v.repuestos_solicitados || [])),
            ];
            const total = reps.reduce((acc, x) => acc + ((parseInt(x.precio) || 0) * (parseInt(x.cantidad) || 1)), 0);
            return {
                phone: r.phone, estado: r.estado, sucursal: r.sucursal,
                nombre_cliente: e.nombre_cliente || null,
                vehiculo: e.marca_modelo || (e.vehiculos?.[0]?.marca_modelo) || null,
                items: reps.map(x => `${x.cantidad || 1}x ${x.nombre}${x.precio ? ' ($' + Number(x.precio).toLocaleString('es-CL') + ')' : ''}`).join(', '),
                total, vendedor: r.lock_vendedor || e.vendedor_nombre || null,
                quote_id: e.quote_id || null, ultimo_mensaje: r.ultimo_mensaje,
            };
        });
        res.json({ total: ventas.length, ventas });
    } catch (error) {
        console.error('[Dashboard] Error en ventas-sin-cerrar:', error);
        res.status(500).json({ error: 'Error interno' });
    }
});

/**
 * [SOPORTE] Cerrar una venta manualmente → ENTREGADO (o DESPACHADO) → KPIs + gracias/reseña.
 * POST /api/dashboard/soporte/cerrar-venta
 * Body: { phone, items?, total?, vendedor_nombre?, metodo_entrega?, enviar_resena?, motivo? }
 * Si no se pasan items, usa los de la sesión actual.
 */
router.post('/soporte/cerrar-venta', requireSoporte, async (req, res) => {
    try {
        const { phone, items, total, vendedor_nombre, metodo_entrega, enviar_resena = true, motivo } = req.body || {};
        if (!phone) return res.status(400).json({ error: 'Falta phone' });
        const session = await sessionsService.getSession(phone);
        if (!session) return res.status(404).json({ error: 'Sesión no encontrada' });

        // Reconstruir entidades si se pasan items (caso venta perdida / sesión reseteada).
        const updates = {};
        if (Array.isArray(items) && items.length > 0) {
            updates.repuestos_solicitados = items.map(it => ({
                nombre: String(it.nombre || 'Repuesto'), codigo: it.codigo || '',
                precio: it.precio != null ? parseInt(it.precio, 10) : null,
                cantidad: it.cantidad != null ? parseInt(it.cantidad, 10) : 1,
                disponibilidad: 'DISPONIBLE', cantidad_fijada: true, _isNew: false,
            }));
        }
        if (total != null) updates.total_cotizacion = parseInt(total, 10);
        if (vendedor_nombre) updates.vendedor_nombre = vendedor_nombre;
        if (metodo_entrega) updates.metodo_entrega = metodo_entrega;
        if (Object.keys(updates).length > 0) await sessionsService.patchSellerData(phone, updates);
        if (vendedor_nombre) {
            await db.query(`UPDATE user_sessions SET lock_vendedor = $1 WHERE phone = $2`, [vendedor_nombre, phone]);
        }

        const esEnvio = (metodo_entrega || session.entidades?.metodo_entrega) === 'domicilio';
        const estadoFinal = esEnvio ? 'DESPACHADO' : 'ENTREGADO';
        const anterior = session.estado;
        await sessionsService.setEstado(phone, estadoFinal);

        // Omitir encuesta de evaluación de Google al ser un cierre administrativo de Soporte (Pesquisa/Auditoría)
        const atencion = await scheduleService.getEstadoAtencion();
        const fueraDeHorario = !atencion.abierto;
        const omitirResenaSoporte = true; // Al ser realizado por Soporte, omitimos siempre por precaución (evitar spam al cliente)

        if (enviar_resena && !omitirResenaSoporte) {
            setTimeout(() => { whatsappService.sendGoogleReviewRequest(phone).catch(() => {}); }, 3000);
        }
        // Archivar a pedidos (KPIs).
        setTimeout(() => { sessionsService.archiveSession(phone).catch(err => console.error('[Soporte] archive err:', err.message)); }, 8000);

        auditService.registrarAccion({
            req, action: 'cerrar_venta_soporte', targetPhone: phone,
            targetQuoteId: session.entidades?.quote_id || null,
            estadoAnterior: anterior, estadoNuevo: estadoFinal, motivo: motivo || null,
            detalle: { enviar_resena, items: updates.repuestos_solicitados || undefined },
        });
        res.json({ success: true, phone, nuevo_estado: estadoFinal });
    } catch (error) {
        console.error('[Dashboard] Error en cerrar-venta soporte:', error);
        res.status(500).json({ error: 'Error interno' });
    }
});

/**
 * Asignar / cambiar / des-asignar el vendedor de una venta ya cerrada (pedido).
 * Usado por el dropdown de /admin/estadisticas cuando una venta quedó sin vendedor
 * (ej. cerrada sin lock activo). Admin-only por el JWT del router.
 * PATCH /api/dashboard/ventas/:id/vendedor   Body: { vendedor_nombre }
 */
router.patch('/ventas/:id/vendedor', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!Number.isInteger(id)) {
            return res.status(400).json({ error: 'ID de venta inválido' });
        }
        // Permitir des-asignar con null / "".
        const raw = req.body?.vendedor_nombre;
        const vendedorNombre = raw == null || String(raw).trim() === '' ? null : String(raw).trim().slice(0, 120);

        const { rows } = await db.query(
            `UPDATE pedidos SET vendedor_nombre = $1 WHERE id = $2 RETURNING id, phone, vendedor_nombre, sucursal`,
            [vendedorNombre, id]
        );
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Venta no encontrada' });
        }
        console.log(`[Dashboard] ✏️ Venta ${id} → vendedor: ${vendedorNombre || '(sin asignar)'}`);
        auditService.registrarAccion({
            req, action: 'asignar_vendedor', targetPhone: rows[0].phone || null,
            detalle: { pedido_id: id, vendedor_asignado: vendedorNombre },
        });
        res.json({ success: true, venta: rows[0] });
    } catch (error) {
        console.error('[Dashboard] Error asignando vendedor a venta:', error);
        res.status(500).json({ error: 'Error interno' });
    }
});

router.get('/metrics', async (req, res) => {
    try {
        const allowedRanges = ['hoy', '7d', '30d', 'total'];
        const range = allowedRanges.includes(req.query.range) ? req.query.range : 'hoy';
        const sucursal = req.query.sucursal || null;
        const vendedor = req.query.vendedor || null;
        const metrics = await sessionsService.getDashboardMetrics(range, { sucursal, vendedor });
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
        // Resolver filtro de sucursal según rol del usuario
        const role = req.user?.role || 'vendedor';
        const headerSucursal = req.user?.sucursal;
        let sucursal = null;
        if (role === 'vendedor' && headerSucursal) {
            // Vendedor: forzar su propia sucursal, ignorar query param
            sucursal = headerSucursal;
        } else if (role !== 'vendedor' && req.query.sucursal) {
            // Admin: respetar filtro de query si viene
            sucursal = req.query.sucursal;
        }
        const pending = await sessionsService.getAllPendingSessions(sucursal || null);

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
        // Resolver filtro de sucursal según rol del usuario
        const role = req.user?.role || 'vendedor';
        const headerSucursal = req.user?.sucursal;
        let sucursal = null;
        if (role === 'vendedor' && headerSucursal) {
            // Vendedor: forzar su propia sucursal, ignorar query param
            sucursal = headerSucursal;
        } else if (role !== 'vendedor' && req.query.sucursal) {
            // Admin: respetar filtro de query si viene
            sucursal = req.query.sucursal;
        }
        const history = await sessionsService.getHistoricalSessions(sucursal || null);
        res.status(200).json(history);
    } catch (error) {
        console.error('Error obteniendo historial:', error);
        res.status(500).json({ error: 'Error interno' });
    }
});

/**
 * Reclamar lock pesimista sobre una cotización.
 * POST /api/dashboard/cotizaciones/:phone/claim
 * Body: { vendedor: string }
 * Respuestas: 200 { success:true, lock_token, lock_vendedor, lock_expires_at }
 *             409 { success:false, lock_vendedor, lock_expires_at }
 */
router.post('/cotizaciones/:phone/claim', async (req, res) => {
    try {
        const { phone } = req.params;
        const { vendedor } = req.body;
        if (!phone || !vendedor) {
            return res.status(400).json({ error: 'Faltan campos: phone, vendedor' });
        }
        const result = await sessionsService.claimSession(phone, vendedor);
        if (!result.success) {
            return res.status(409).json(result);
        }
        return res.status(200).json(result);
    } catch (error) {
        console.error('[Lock] Error en claim:', error);
        return res.status(500).json({ error: 'Error interno al reclamar lock' });
    }
});

/**
 * Liberar lock pesimista.
 * POST /api/dashboard/cotizaciones/:phone/release
 * Body: { lock_token: string }
 */
router.post('/cotizaciones/:phone/release', async (req, res) => {
    try {
        const { phone } = req.params;
        const { lock_token } = req.body;
        if (!phone || !lock_token) {
            return res.status(400).json({ error: 'Faltan campos: phone, lock_token' });
        }
        const result = await sessionsService.releaseSession(phone, lock_token);
        return res.status(200).json(result);
    } catch (error) {
        console.error('[Lock] Error en release:', error);
        return res.status(500).json({ error: 'Error interno al liberar lock' });
    }
});

/**
 * Enviar respuesta final al cliente y cerrar sesión
 */
router.post('/cotizaciones/responder', async (req, res) => {
    try {
        const { phone, items, vehiculos, note, horario_entrega, vendedor_nombre, rectificacion, abono_minimo } = req.body;

        if (!phone || (!items && !vehiculos)) {
            return res.status(400).json({ error: 'Faltan campos obligatorios' });
        }

        // ── Guard ventana 24h ─────────────────────────────────────────────
        // Si el último mensaje entrante del cliente fue hace >23h50min, la
        // ventana de WhatsApp está prácticamente cerrada y Meta entrega el
        // mensaje "exitosamente" sin que llegue al cliente. Bloqueamos el
        // envío de la cotización formal (texto libre) y guiamos al vendedor a
        // enviar la plantilla retomar_cotizacion primero para reabrir la
        // conversación.
        try {
            const { rows: ult } = await db.query(
                `SELECT created_at FROM mensajes
                 WHERE phone = $1 AND direccion = 'entrante'
                 ORDER BY created_at DESC LIMIT 1`,
                [phone]
            );
            const ultEntranteMs = ult.length > 0 ? new Date(ult[0].created_at).getTime() : 0;
            const MARGEN_MS = 23 * 60 * 60 * 1000 + 50 * 60 * 1000; // 23h50m
            if (ultEntranteMs === 0 || (Date.now() - ultEntranteMs) > MARGEN_MS) {
                const horas = ultEntranteMs > 0 ? Math.round((Date.now() - ultEntranteMs) / 3600000) : null;
                console.warn(`[Ventana] 🚫 Cotización rechazada para ${phone} (último entrante hace ${horas ?? '∞'}h). Sugiriendo HSM retomar_cotizacion.`);
                return res.status(409).json({
                    error: 'ventana_cerrada',
                    detalle: 'La ventana de WhatsApp (24h) está cerrada. El cliente NO recibirá la cotización como mensaje libre.',
                    accion_sugerida: 'envia_plantilla_retomar',
                    plantilla_id: 'retomar_cotizacion',
                    horas_offline: horas,
                });
            }
        } catch (ventErr) {
            console.error('[Ventana] ⚠️ Error chequeando ventana 24h (se permite el envío como fallback):', ventErr.message);
        }

        // Cancelar cualquier debounce pendiente: evita que la IA responda con contexto
        // viejo después de que el vendedor envíe la cotización formal.
        cancelDebounce(phone);

        // Si es rectificación, mantenemos el quote_id base y agregamos sufijo -V2/-V3.
        // Esto preserva trazabilidad y deja claro al cliente que reemplaza la anterior.
        let quoteId;
        if (rectificacion) {
            const sessionPrev = await sessionsService.getSession(phone).catch(() => null);
            const prevId = sessionPrev?.entidades?.quote_id;
            if (prevId) {
                const versionMatch = prevId.match(/-V(\d+)$/);
                if (versionMatch) {
                    const nextV = parseInt(versionMatch[1], 10) + 1;
                    quoteId = prevId.replace(/-V\d+$/, `-V${nextV}`);
                } else {
                    quoteId = `${prevId}-V2`;
                }
            } else {
                quoteId = `JFNN-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
            }
        } else {
            quoteId = `JFNN-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        }
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
                return `📦 ${cant}x ${item.nombre} | $${priceStr} c/u`;
            }

            // Código del producto es INTERNO — no se envía al cliente.
            return `✔️ ${cant}x ${item.nombre} | $${priceStr || 0} c/u${cant > 1 ? ` (Total: $${(parseInt(item.precio) * cant).toLocaleString('es-CL')})` : ''}`;
        };

        if (vehiculos && vehiculos.length > 0) {
            // Ocultar del mensaje al cliente los vehículos SIN repuestos cotizados (cuando
            // el cliente preguntó por varios autos pero solo se cotizó uno). Evita listar
            // un vehículo vacío que confunde. La sesión conserva todos los vehículos.
            const vehiculosConRepuestos = vehiculos.filter(
                v => Array.isArray(v.repuestos_solicitados)
                  && v.repuestos_solicitados.some(r => (r?.nombre || '').trim())
            );
            detailsText = vehiculosConRepuestos.map(v => {
                let vehiculoHeader = `🚗 *${v.marca_modelo || 'Vehículo'} ${v.ano || ''}*\n`;
                let vehiculoDetails = (v.repuestos_solicitados || []).map(parseItem).join('\n');
                return vehiculoHeader + vehiculoDetails;
            }).join('\n\n');
        } else if (items) {
            detailsText = items.map(parseItem).join('\n');
        }

        // Conteo de items por disponibilidad — usado para el cierre contextual del mensaje
        const todosItemsFlat = (items || []).concat(
            (vehiculos || []).flatMap(v => v.repuestos_solicitados || [])
        );
        const totalItems = todosItemsFlat.length;
        const itemsSinStock = todosItemsFlat.filter(i => i.disponibilidad === 'SIN_STOCK').length;
        const itemsPorEncargo = todosItemsFlat.filter(i => i.disponibilidad === 'POR_ENCARGO').length;
        const itemsDisponibles = todosItemsFlat.filter(i => (i.disponibilidad || 'DISPONIBLE') === 'DISPONIBLE').length;
        const todosSinStock = totalItems > 0 && itemsSinStock === totalItems;
        const hayEncargoEnItems = itemsPorEncargo > 0;

        const notaEncargo = hayEncargoEnItems
            ? `\n\n📦 *Sobre los productos marcados con 📦:* No están en stock local. Para confirmarlos, los solicitamos a nuestra bodega central, lo que requiere un abono parcial por transferencia. El saldo lo pagas cuando llegan al local. ⏳`
            : '';

        // Mensaje formal LIMPIO — sin pregunta al final. La pregunta + recordatorio del
        // código van en un SEGUNDO mensaje separado para reducir confusión del cliente y
        // reforzar el uso del número de cotización al ir presencialmente.
        const headerMsg = rectificacion
            ? `⚠️ *COTIZACIÓN RECTIFICADA - JFNN*\nEsta cotización REEMPLAZA la anterior. Por favor ignora la versión previa.\n\n`
            : `*COTIZACIÓN FORMAL - JFNN*\n`;

        // Si todo está agotado, agregamos un cierre informativo (NO es pregunta).
        const cierreInformativo = todosSinStock
            ? `\n\nLamentablemente no tenemos stock de ninguno de los items solicitados en este momento y no podemos encargarlos. Te recomendamos buscar en otros proveedores. Si necesitas algo más adelante, no dudes en escribirnos.`
            : '';

        const message = `${headerMsg}` +
            `📄 ID: ${quoteId}\n\n` +
            `Estimado cliente, revisamos el stock de lo solicitado:\n\n` +
            `${detailsText}` +
            `${notaEncargo}\n\n` +
            (total > 0 ? `*TOTAL APROXIMADO: $${total.toLocaleString('es-CL')}*\n\n` : '') +
            `${horario_entrega ? `📦 Logística: ${horario_entrega}\n\n` : ''}` +
            `${note ? `📝 Nota del asesor: ${note}\n\n` : ''}` +
            `--- \n` +
            `🏢 Origen: Venta Online / WhatsApp\n` +
            `👤 Atentamente: ${vendedor_nombre || 'Asesor JFNN'}` +
            cierreInformativo;

        await whatsappService.sendSellerMessage(phone, message, {
            autorNombre: vendedor_nombre || 'Asesor JFNN'
        });

        // SEGUNDO MENSAJE: pregunta de confirmación + recordatorio del número de cotización.
        // Solo si hay items disponibles o por encargo. Si TODO está agotado, no preguntamos.
        if (!todosSinStock) {
            let preguntaConfirmacion;
            if (itemsPorEncargo > 0 && itemsDisponibles > 0) {
                preguntaConfirmacion = `¿Deseas confirmar la compra de los productos disponibles ✔️ y/o el encargo de los marcados con 📦?`;
            } else if (itemsPorEncargo > 0 && itemsDisponibles === 0) {
                preguntaConfirmacion = `Los productos solicitados solo están disponibles por encargo 📦. ¿Deseas confirmar el encargo con el abono correspondiente?`;
            } else if (itemsSinStock > 0 && itemsDisponibles > 0) {
                preguntaConfirmacion = `Algunos items están agotados. ¿Deseas confirmar la compra de los disponibles?`;
            } else {
                preguntaConfirmacion = `¿Deseas confirmar la compra?`;
            }
            const recordatorioCodigo =
                `\n\n📌 *Recuerda:* para facilitar tu atención presencial, menciona tu número de cotización *${quoteId}* al llegar al local. 🙌`;
            await new Promise(r => setTimeout(r, 1200));
            // Tolerar fallo del 2do mensaje: el cliente YA recibió la cotización formal.
            // Si reventamos aquí, el vendedor reintenta y se genera otro quote_id → cliente
            // recibe duplicado (caso real 2026-06-12: JFNN-CF4020 + JFNN-A68DE6 al mismo
            // número durante outage de Meta). Mejor seguir persistiendo y loguear warning.
            try {
                await whatsappService.sendSellerMessage(phone, preguntaConfirmacion + recordatorioCodigo, {
                    autorNombre: vendedor_nombre || 'Asesor JFNN'
                });
            } catch (segMsgErr) {
                console.warn(`[Cotizaciones] ⚠️ Cotización formal ${quoteId} enviada a ${phone}, pero pregunta de confirmación falló (${segMsgErr.message}). Persistiendo sesión igual para evitar duplicado en reintento.`);
                res.locals.warning_pregunta_confirmacion = true;
            }
        }

        // Actualizar sesión: Guardar ID de cotización, total, horario, precios y pasar al flujo de cierre
        const sessionUpdateParams = {
            quote_id: quoteId,
            total_cotizacion: total,
            horario_entrega: horario_entrega || null
        };
        // Persistir el vendedor que cotiza para atribución de la venta al cerrar
        // (fallback cuando no hay lock activo en archiveSession).
        if (vendedor_nombre && vendedor_nombre.trim()) {
            sessionUpdateParams.vendedor_nombre = vendedor_nombre.trim();
        }
        if (vehiculos && vehiculos.length > 0) {
            sessionUpdateParams.vehiculos = vehiculos;
        } else {
            sessionUpdateParams.repuestos_solicitados = items;
        }

        await sessionsService.patchSellerData(phone, sessionUpdateParams);
        await sessionsService.setEstado(phone, 'CONFIRMANDO_COMPRA');

        // Al re-enviar la cotización formal (items nuevos ya con precio), limpiar el flag.
        const cleanupUpdate = {
            items_nuevos_sin_precio: false,
            items_nuevos_count: 0,
        };
        // Persistir abono_minimo definido manualmente por el vendedor (CLP int o null).
        const abonoNum = Number.parseInt(abono_minimo, 10);
        if (Number.isFinite(abonoNum) && abonoNum > 0) {
            cleanupUpdate.abono_minimo = abonoNum;
        } else if (abono_minimo === null || abono_minimo === 0 || abono_minimo === '') {
            cleanupUpdate.abono_minimo = null;
        }
        await sessionsService.updateEntidades(phone, cleanupUpdate);

        // ─── Persistir cotización en tabla `cotizaciones` (snapshot, validez 5 días) ───
        // Permite que el agente y el vendedor recuperen cotizaciones sin parsear el chat.
        try {
            const sessionPost = await sessionsService.getSession(phone).catch(() => null);
            const flatRepuestos = items || (vehiculos || []).flatMap(v => v.repuestos_solicitados || []);
            const totalAprox = flatRepuestos.reduce((acc, r) => acc + ((parseInt(r.precio) || 0) * (parseInt(r.cantidad) || 1)), 0);
            const tieneEncargo = flatRepuestos.some(r => r && r.disponibilidad === 'POR_ENCARGO');
            await cotizacionesService.upsertCotizacion({
                quote_id: quoteId,
                phone,
                nombre_cliente: sessionPost?.entidades?.nombre_cliente || null,
                sucursal: sessionPost?.sucursal || null,
                vendedor_nombre: vendedor_nombre || sessionPost?.entidades?.vendedor_nombre || null,
                repuestos: items || [],
                vehiculos: vehiculos || [],
                total_aproximado: totalAprox,
                tiene_encargo: tieneEncargo,
                abono_minimo: cleanupUpdate.abono_minimo,
            });
        } catch (cotErr) {
            console.error('[Cotizaciones] ⚠️ No se pudo persistir snapshot en tabla (flujo continúa):', cotErr.message);
        }

        // Auto-archivar cuando todos los items están sin stock — el cliente no recibirá
        // pregunta de confirmación, así que la sesión nunca avanzaría sola.
        if (todosSinStock) {
            console.log(`[Cotizaciones] 🔴 Todos los items SIN_STOCK para ${phone} — archivando sesión.`);
            await sessionsService.archiveSession(phone).catch(err =>
                console.error(`[Cotizaciones] ❌ Error al auto-archivar SIN_STOCK ${phone}:`, err.message)
            );
        }

        const payload = { success: true, quoteId };
        if (res.locals.warning_pregunta_confirmacion) {
            payload.warning = 'pregunta_confirmacion_no_enviada';
        }
        res.status(200).json(payload);
    } catch (error) {
        console.error('Error respondiendo al cliente:', error);
        const metaStatus = error?.response?.status;
        const metaCode = error?.response?.data?.error?.code;
        const body = { error: 'Error al enviar mensaje' };
        if (metaStatus) body.meta_status = metaStatus;
        if (metaCode) body.meta_code = metaCode;
        if (metaStatus >= 500) {
            body.detalle = 'WhatsApp (Meta) respondió con error temporal tras reintentos. Espera 1-2 min y reintenta.';
        }
        res.status(500).json(body);
    }
});

/**
 * POST /api/dashboard/conversaciones/:phone/imagen
 * Envía una imagen del vendedor al cliente.
 * Body: { imagen_base64, mime_type, caption?, vendedor_nombre? }
 * Sube a Supabase Storage, envía vía Meta (image link), persiste en mensajes.
 */
router.post('/conversaciones/:phone/imagen', async (req, res) => {
    try {
        const { phone } = req.params;
        const { imagen_base64, mime_type, caption, vendedor_nombre } = req.body;
        if (!imagen_base64 || !mime_type) {
            return res.status(400).json({ error: 'Faltan campos: imagen_base64, mime_type' });
        }
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime_type)) {
            return res.status(400).json({ error: 'Tipo de imagen no soportado. Usa JPEG, PNG o WebP.' });
        }

        cancelDebounce(phone);

        // Decodificar base64 (data URL o raw)
        const b64 = imagen_base64.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(b64, 'base64');
        if (buffer.length > 10 * 1024 * 1024) {
            return res.status(400).json({ error: 'Imagen demasiado grande (max 10MB)' });
        }

        // Subir a Storage
        const objectPath = await storageService.uploadVendorImage(phone, buffer, mime_type);
        if (!objectPath) return res.status(500).json({ error: 'Error subiendo imagen al storage' });

        const signedUrl = await storageService.getSignedUrl(objectPath, 86400);
        if (!signedUrl) return res.status(500).json({ error: 'Error generando URL firmada' });

        // Enviar al cliente vía Meta
        await whatsappService.sendImageMessage(phone, signedUrl, caption || null);

        // Persistir en mensajes
        const session = await sessionsService.getSession(phone).catch(() => null);
        await mensajesService.registrarSaliente({
            phone,
            tipo: 'image',
            contenido: caption || null,
            mediaUrl: objectPath,
            mediaMime: mime_type,
            autor: 'vendedor',
            autorNombre: vendedor_nombre || 'Sistema JFNN',
            sucursal: session?.sucursal || 'Melipilla',
        });

        res.json({ success: true });
    } catch (error) {
        if (error.code === 'WHATSAPP_WINDOW_CLOSED') {
            return res.status(403).json({ error: 'Ventana de 24h cerrada. Usa una plantilla HSM primero.', code: 'WINDOW_CLOSED' });
        }
        console.error('[Dashboard] Error enviando imagen:', error.message);
        res.status(500).json({ error: 'Error al enviar imagen', detalle: error.message });
    }
});

/**
 * POST /api/dashboard/sessions/:phone/cancelar-debounce
 * Cancela cualquier respuesta IA pendiente en el buffer (debounce).
 * Útil cuando el vendedor quiere asegurarse de que la IA no responda antes de él.
 */
router.post('/sessions/:phone/cancelar-debounce', async (req, res) => {
    try {
        const { phone } = req.params;
        const cancelado = cancelDebounce(phone);
        res.json({ success: true, habia_pendiente: cancelado });
    } catch (error) {
        console.error('[Dashboard] Error cancelando debounce:', error);
        res.status(500).json({ error: 'Error cancelando' });
    }
});

/**
 * POST /api/dashboard/cotizaciones/pedir-info-cliente
 * El vendedor escribe en lenguaje natural lo que necesita saber del cliente.
 * Gemini lo reformula como pregunta natural y se envía como mensaje del agente IA.
 * La IA queda activa para procesar la respuesta. Cancela debounce pendiente.
 * Body: { phone, instruccion, vendedor_nombre? }
 */
router.post('/cotizaciones/pedir-info-cliente', async (req, res) => {
    try {
        const { phone, instruccion } = req.body;
        if (!phone || !instruccion || !instruccion.trim()) {
            return res.status(400).json({ error: 'Faltan campos: phone, instruccion' });
        }

        cancelDebounce(phone);

        const session = await sessionsService.getSession(phone).catch(() => null);
        if (!session) return res.status(404).json({ error: 'Sesión no encontrada' });

        const pregunta = await geminiService.formularPreguntaAlCliente(instruccion.trim(), session);
        if (!pregunta) return res.status(500).json({ error: 'No se pudo formular la pregunta' });

        // Enviar como mensaje del agente IA (mantiene voz del bot, no rompe el flujo).
        await whatsappService.sendAgentMessage(phone, pregunta);

        res.json({ success: true, pregunta_enviada: pregunta });
    } catch (error) {
        console.error('[Dashboard] Error pidiendo info al cliente:', error);
        res.status(500).json({ error: 'Error procesando solicitud' });
    }
});

/**
 * POST /api/dashboard/cotizaciones/ajustar-venta-final
 * Ajusta los items finales vendidos en el local (sin enviar mensaje al cliente).
 * Usado cuando el cliente llega al local y compra cosas adicionales o cambia marcas.
 * Body: { phone, items? | vehiculos?, vendedor_nombre? }
 * El total se recalcula y se marca entidades.venta_ajustada_en_local = true.
 * No cambia el estado de la sesión.
 */
router.post('/cotizaciones/ajustar-venta-final', async (req, res) => {
    try {
        const { phone, items, vehiculos } = req.body;
        if (!phone || (!items && !vehiculos)) {
            return res.status(400).json({ error: 'Faltan campos: phone + items o vehiculos' });
        }

        // Recalcular total con los items finalmente vendidos
        const parsePrecio = (p) => (p ? parseInt(String(p).replace(/[^\d]/g, '')) || 0 : 0);
        let total = 0;
        if (vehiculos && vehiculos.length > 0) {
            vehiculos.forEach(v => (v.repuestos_solicitados || []).forEach(r => {
                if ((r.disponibilidad || 'DISPONIBLE') !== 'SIN_STOCK') {
                    total += parsePrecio(r.precio) * (r.cantidad || 1);
                }
            }));
        } else if (items) {
            items.forEach(r => {
                if ((r.disponibilidad || 'DISPONIBLE') !== 'SIN_STOCK') {
                    total += parsePrecio(r.precio) * (r.cantidad || 1);
                }
            });
        }

        const update = {
            total_cotizacion: total,
            venta_ajustada_en_local: true
        };
        if (vehiculos && vehiculos.length > 0) update.vehiculos = vehiculos;
        else if (items) update.repuestos_solicitados = items;

        await sessionsService.patchSellerData(phone, update);

        res.json({ success: true, total });
    } catch (error) {
        console.error('[Dashboard] Error ajustando venta final:', error);
        res.status(500).json({ error: 'Error ajustando venta' });
    }
});

/**
 * POST /api/dashboard/sessions/:phone/marcar
 * Marca una conversación para seguimiento del vendedor (tipo "pin").
 * Body: { vendedor_nombre, nota? }
 */
router.post('/sessions/:phone/marcar', async (req, res) => {
    try {
        const { phone } = req.params;
        const { vendedor_nombre, nota } = req.body;
        const marca = {
            vendedor: vendedor_nombre || 'Sistema',
            momento: new Date().toISOString(),
            nota: nota && nota.trim() ? nota.trim().slice(0, 200) : null
        };
        await sessionsService.updateEntidades(phone, { marca });
        res.json({ success: true, marca });
    } catch (error) {
        console.error('[Dashboard] Error marcando conversación:', error);
        res.status(500).json({ error: 'Error al marcar' });
    }
});

/**
 * POST /api/dashboard/sessions/:phone/desmarcar
 */
router.post('/sessions/:phone/desmarcar', async (req, res) => {
    try {
        const { phone } = req.params;
        // updateEntidades ignora null por el merge "no sobreescribir" — SQL directo
        await db.query(
            `UPDATE user_sessions SET entidades = jsonb_set(entidades, '{marca}', 'null'::jsonb) WHERE phone = $1`,
            [phone]
        );
        sessionsService.invalidateSessionCache?.(phone);
        res.json({ success: true });
    } catch (error) {
        console.error('[Dashboard] Error desmarcando:', error);
        res.status(500).json({ error: 'Error al desmarcar' });
    }
});

/**
 * POST /api/dashboard/sessions/:phone/consulta-resuelta
 * Marca una consulta pendiente como resuelta (el vendedor ya respondió al cliente).
 * Limpia consulta_pendiente y reanuda la IA.
 */
router.post('/sessions/:phone/consulta-resuelta', async (req, res) => {
    try {
        const { phone } = req.params;
        // updateEntidades ignora valores null por el merge "no sobreescribir" — usamos SQL
        // directo para forzar el clear de consulta_pendiente y agente_pausado.
        await db.query(
            `UPDATE user_sessions
             SET entidades = jsonb_set(
                 jsonb_set(entidades, '{consulta_pendiente}', 'null'::jsonb),
                 '{agente_pausado}', 'false'::jsonb
             ),
             ultimo_mensaje = ultimo_mensaje
             WHERE phone = $1`,
            [phone]
        );
        // Invalidar cache para que el siguiente getSession traiga los datos frescos
        sessionsService.invalidateSessionCache?.(phone);
        res.json({ success: true });
    } catch (error) {
        console.error('[Dashboard] Error resolviendo consulta:', error);
        res.status(500).json({ error: 'Error al resolver consulta' });
    }
});

/**
 * POST /api/dashboard/cotizaciones/anular
 * Anula una cotización ya enviada al cliente. Limpia items, manda mensaje de disculpa,
 * vuelve la sesión a ESPERANDO_VENDEDOR, pausa la IA y cancela cualquier debounce.
 */
router.post('/cotizaciones/anular', async (req, res) => {
    try {
        const { phone, motivo, vendedor_nombre } = req.body;
        if (!phone) return res.status(400).json({ error: 'Falta phone' });

        cancelDebounce(phone);

        const session = await sessionsService.getSession(phone).catch(() => null);
        const nombreCliente = session?.entidades?.nombre_cliente || '';
        const quoteIdPrev = session?.entidades?.quote_id || '';

        const motivoMsg = motivo && motivo.trim()
            ? `\n\nMotivo: ${motivo.trim()}`
            : '';
        const message = `⚠️ *Disculpas${nombreCliente ? ', ' + nombreCliente : ''}*\n\n` +
            `Hubo una inconsistencia con la cotización anterior${quoteIdPrev ? ' (' + quoteIdPrev + ')' : ''}.${motivoMsg}\n\n` +
            `Por favor ignora ese mensaje. En unos minutos te enviamos una nueva cotización corregida.\n\n` +
            `Gracias por tu paciencia. 🙏`;

        await whatsappService.sendSellerMessage(phone, message, {
            autorNombre: vendedor_nombre || 'Asesor JFNN'
        });

        // Limpiar datos de cotización en entidades y volver a ESPERANDO_VENDEDOR
        await sessionsService.patchSellerData(phone, {
            quote_id: null,
            total_cotizacion: null,
            horario_entrega: null,
            repuestos_solicitados: [],
            vehiculos: session?.entidades?.vehiculos
                ? session.entidades.vehiculos.map(v => ({ ...v, repuestos_solicitados: [] }))
                : []
        });
        await sessionsService.setEstado(phone, 'ESPERANDO_VENDEDOR');
        await sessionsService.setAgentePausado(phone, true);

        res.status(200).json({ success: true, mensajeEnviado: true });
    } catch (error) {
        console.error('Error anulando cotización:', error);
        res.status(500).json({ error: 'Error al anular cotización' });
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
        const { phone, estado, notify, mensaje_logistica, numero_seguimiento, lock_token, vendedor_nombre, motivo } = req.body;

        if (!phone || !estado) {
            return res.status(400).json({ error: 'Faltan campos obligatorios' });
        }

        // Archivar/Descartar EXIGE una causa (trazabilidad: los vendedores archivan por una razón).
        if (estado === 'ARCHIVADO' && (!motivo || !String(motivo).trim())) {
            return res.status(400).json({ error: 'Debes indicar el motivo del archivado.' });
        }

        // Validar lock pesimista si viene lock_token
        if (lock_token) {
            const lockCheck = await sessionsService.validateLock(phone, lock_token);
            if (!lockCheck.valid && lockCheck.reason === 'mismatched_token' && lockCheck.lock_vendedor) {
                // Hay un lock activo de otro vendedor — rechazar
                return res.status(409).json({
                    error: 'locked_by_other',
                    lock_vendedor: lockCheck.lock_vendedor
                });
            }
            // Si el token está vencido o no hay lock, se permite pasar (sesiones legacy)
        }

        // Persistir vendedor_nombre en user_sessions si viene en el body (para REQ-03)
        if (vendedor_nombre) {
            await db.query(
                `UPDATE user_sessions SET lock_vendedor = COALESCE(lock_vendedor, $1) WHERE phone = $2`,
                [vendedor_nombre, phone]
            );
        }

        // Idempotencia: si el estado ya es el solicitado, no hacemos nada.
        // Why: un doble-click del vendedor o un retry de red estaba disparando notificaciones duplicadas
        // al cliente (2x "pago verificado" + 2x reseña Google observados en producción 2026-04-24).
        const sessionBefore = await sessionsService.getSession(phone);
        if (sessionBefore?.estado === estado) {
            return res.status(200).json({ success: true, estado, idempotent: true });
        }

        // Si viene numero_seguimiento, actualizar entidades
        if (numero_seguimiento) {
            const entidades = sessionBefore?.entidades || {};
            entidades.numero_seguimiento = numero_seguimiento;
            await sessionsService.updateEntidades(phone, entidades);
        }

        const session = await sessionsService.setEstado(phone, estado);

        // Auditoría: registrar QUIÉN cambió el estado (especialmente archivar).
        auditService.registrarAccion({
            req,
            action: estado === 'ARCHIVADO' ? 'archivar' : 'cambiar_estado',
            targetPhone: phone,
            targetQuoteId: sessionBefore?.entidades?.quote_id || null,
            estadoAnterior: sessionBefore?.estado || null,
            estadoNuevo: estado,
            motivo: motivo || null,
        });

        // Archivado manual: dejar un registro trazable en `pedidos` (estado_final='ARCHIVADO')
        // con el motivo, para que aparezca en Historial > Archivados y no se "pierda".
        if (estado === 'ARCHIVADO' && sessionBefore) {
            try {
                const e = sessionBefore.entidades || {};
                await db.query(
                    `INSERT INTO pedidos (phone, quote_id, estado_final, marca_modelo, ano, patente, vin,
                     repuestos, total_cotizacion, metodo_pago, metodo_entrega, direccion_envio,
                     tipo_documento, datos_factura, comprobante_url, datos_comprobante, entidades_completas,
                     mensajes_ia_total, mensajes_vendedor_total, sucursal, vendedor_nombre, created_at, archivado_en)
                     VALUES ($1,$2,'ARCHIVADO',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,NOW())`,
                    [
                        phone, e.quote_id || null, e.marca_modelo || null, (e.ano || '').toString().slice(0,10) || null,
                        e.patente || null, e.vin || null, JSON.stringify(e.repuestos_solicitados || []), 0,
                        e.metodo_pago || null, e.metodo_entrega || null, e.direccion_envio || null,
                        e.tipo_documento || null, JSON.stringify(e.datos_factura || {}), e.comprobante_url || null,
                        JSON.stringify({ motivo_archivado: motivo || null }), JSON.stringify(e),
                        sessionBefore.mensajes_ia || 0, sessionBefore.mensajes_vendedor || 0,
                        sessionBefore.sucursal || 'Melipilla', vendedor_nombre || null, sessionBefore.created_at || null
                    ]
                );
            } catch (archErr) {
                console.error(`[Archivar] ⚠️ No se pudo crear pedido trazable para ${phone}:`, archErr.message);
            }
        }

        if (notify) {
            let message = "";

            if (estado === 'ESPERANDO_RETIRO') {
                // Vendedor confirma logística de retiro (online + retiro). Mensaje para que vaya a buscar.
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
            } else if (estado === 'DESPACHADO') {
                // Envío a domicilio: estado FINAL. El vendedor entregó el pedido al courier.
                const seguimientoLinea = numero_seguimiento && numero_seguimiento.trim()
                    ? `📮 *Número de seguimiento:* ${numero_seguimiento.trim()}\n\n`
                    : '';
                const cuerpo = (mensaje_logistica && mensaje_logistica.trim())
                    ? `📦 *Información de despacho:*\n${mensaje_logistica.trim()}\n\n`
                    : `📦 Su pedido fue despachado y va en camino.\n\n`;
                message =
                    `✅ *¡Su pedido fue despachado!* Gracias por su preferencia.\n\n` +
                    cuerpo +
                    seguimientoLinea +
                    `¡Muchas gracias por preferir *Repuestos JFNN*! 🙌`;
            }
            // ENTREGADO sin mensaje_logistica: el cliente ya fue notificado (venía de ESPERANDO_RETIRO)
            // o está físicamente en el local (cash+retiro). No enviamos mensaje — solo reseña.

            // Control de omisión de notificaciones para Soporte o Fuera de Horario (Auditoría/Pesquisa)
            const atencion = await scheduleService.getEstadoAtencion();
            const esSoporte = req.user?.role === 'soporte';
            const fueraDeHorario = !atencion.abierto;
            const omitirNotificaciones = esSoporte || fueraDeHorario;

            if (omitirNotificaciones) {
                console.log(`[Cierre] 🤫 Omitiendo mensaje de agradecimiento y reseña para ${phone} (Causa: ${esSoporte ? 'Soporte' : 'Fuera de Horario'}).`);
            }

            if (message && !omitirNotificaciones) {
                await whatsappService.sendSellerMessage(phone, message);
                await sessionsService.incrementMessageCounter(phone, 'vendedor');
            }

            // HU-6: Solicitud de reseña en Google Maps al cierre + archivado del pedido para KPIs.
            // Ambos estados terminales: ENTREGADO (retiro) y DESPACHADO (envío a domicilio).
            if (estado === 'ENTREGADO' || estado === 'DESPACHADO') {
                if (!omitirNotificaciones) {
                    setTimeout(() => {
                        whatsappService.sendGoogleReviewRequest(phone).catch(err => {
                            console.error('Error enviando solicitud de reseña Google:', err);
                        });
                    }, 5000);
                }
                
                // Archivar la sesión a la tabla pedidos para que sume a KPIs (con delay
                // para no interferir con la reseña ni con un re-engage temprano del cliente).
                // SIEMPRE se archiva para registrar KPIs de venta.
                setTimeout(() => {
                    sessionsService.archiveSession(phone).catch(err => {
                        console.error(`[Archive] Error archivando sesión ${phone} tras ${estado}:`, err);
                    });
                }, 60000);
            }
        }

        res.status(200).json({
            success: true,
            estado: session.estado,
            vendedor_cotizo: session.entidades?.vendedor_nombre || null,
        });
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
        await whatsappService.sendSellerMessage(phone, msg);
        await sessionsService.incrementMessageCounter(phone, 'vendedor');

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

        const formatted = await Promise.all(sessions.map(async s => {
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

            // Firmar el comprobante para que el admin pueda verlo (bucket privado).
            // Si ya es URL absoluta (http) o un path local (/uploads), se deja como está.
            let comprobanteUrl = e.comprobante_url || null;
            if (comprobanteUrl && !/^https?:\/\//.test(comprobanteUrl) && !comprobanteUrl.startsWith('/')) {
                const signed = await storageService.getSignedUrl(comprobanteUrl, 86400);
                if (signed) comprobanteUrl = signed;
            }

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
                comprobante_url: comprobanteUrl,
                pago_pendiente: e.pago_pendiente || null,
            };
        }));

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

        // Auditoría: registrar quién verificó/rechazó el pago.
        auditService.registrarAccion({
            req, action: 'verificar_pago', targetPhone: phone,
            targetQuoteId: session.entidades?.quote_id || null,
            estadoAnterior: session.estado, motivo: nota_admin || null,
            detalle: { accion, monto_corregido: monto_corregido ?? null },
        });

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

            await whatsappService.sendSellerMessage(phone, mensajeRechazo);
            await sessionsService.incrementMessageCounter(phone, 'vendedor');

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
                        
        await whatsappService.sendSellerMessage(phone, mensaje);
        await sessionsService.incrementMessageCounter(phone, 'vendedor');

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

        // Inyectar dirección de sucursal si aplica
        const sucursal = e.sucursal_retiro || session.sucursal;
        const direccionBlock = sucursal ? `\n\n${getDireccionSucursal(sucursal)}` : '';

        let mensaje;
        let nuevoEstado;

        if (saldoPendiente > 0) {
            nuevoEstado = 'ESPERANDO_SALDO';
            mensaje = `🎉 *¡Buena noticia! Sus repuestos ya llegaron a nuestro local.*${direccionBlock}\n\n` +
                      `Para proceder con la entrega o despacho, necesitamos que por favor realice el pago del *saldo pendiente*.\n\n` +
                      `🧾 *Resumen:*\n` +
                      `- Total Cotización: ${formatMoney(totalCotizacion)}\n` +
                      `- Abono Registrado: ${formatMoney(montoAbono)}\n` +
                      `- **Saldo a Pagar: ${formatMoney(saldoPendiente)}**\n\n` +
                      `Por favor, envíenos el *comprobante de transferencia* del saldo pendiente por aquí mismo para validar y hacer la entrega.`;
        } else {
            nuevoEstado = 'PAGO_VERIFICADO'; // Ya pagó todo
             mensaje = `🎉 *¡Buena noticia! Sus repuestos ya llegaron a nuestro local.*${direccionBlock}\n\n` +
                      `Su pedido está completamente pagado. En breve gestionaremos la logística de entrega.`;
        }
        
        await sessionsService.setEstado(phone, nuevoEstado);
        await whatsappService.sendSellerMessage(phone, mensaje);
        await sessionsService.incrementMessageCounter(phone, 'vendedor');

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

/**
 * PATCH /api/dashboard/contactos/:phone/nombre
 * Asigna/actualiza el nombre de un contacto. Persiste en `clientes` (upsert por
 * phone) y, si existe sesión activa, también actualiza entidades.nombre_cliente
 * para que la bandeja y el chat reflejen el cambio sin esperar al próximo turno.
 *
 * Body: { nombre: string }
 */
router.patch('/contactos/:phone/nombre', async (req, res) => {
    try {
        const { phone } = req.params;
        const nombre = (req.body?.nombre || '').toString().trim();

        if (!phone || !/^\d{10,15}$/.test(phone)) {
            return res.status(400).json({ error: 'phone inválido (esperado dígitos sin formato).' });
        }
        if (!nombre) {
            return res.status(400).json({ error: 'nombre vacío.' });
        }
        if (nombre.length > 100) {
            return res.status(400).json({ error: 'nombre demasiado largo (máx 100).' });
        }

        // Upsert en clientes (perfil persistente entre sesiones).
        await db.query(
            `INSERT INTO clientes (phone, nombre, created_at, updated_at)
             VALUES ($1, $2, NOW(), NOW())
             ON CONFLICT (phone) DO UPDATE
               SET nombre = EXCLUDED.nombre,
                   updated_at = NOW()`,
            [phone, nombre]
        );

        // Si hay sesión activa, actualizar entidades.nombre_cliente.
        let sesionActualizada = false;
        try {
            const session = await sessionsService.getSession(phone).catch(() => null);
            if (session) {
                await sessionsService.updateEntidades(phone, { nombre_cliente: nombre });
                sesionActualizada = true;
            }
        } catch (sessErr) {
            console.warn('[Contactos] Sesión no actualizable (continúa OK clientes):', sessErr.message);
        }

        res.status(200).json({ success: true, phone, nombre, sesion_actualizada: sesionActualizada });
    } catch (error) {
        console.error('[Contactos] Error en PATCH /contactos/:phone/nombre:', error);
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
 * [HU-8 + MEJORA #2] Solicitar VIN manualmente desde el dashboard
 * POST /api/dashboard/solicitar-vin
 * Ahora ACTIVA el flag bloqueante en la sesión para que el AI insista automáticamente.
 */
router.post('/solicitar-vin', async (req, res) => {
    try {
        const { phone, itemName } = req.body;
        if (!phone) {
            return res.status(400).json({ error: 'El campo "phone" es obligatorio.' });
        }

        // MEJORA #2: Activar modo bloqueante ANTES de enviar el mensaje
        await sessionsService.updateEntidades(phone, { solicitud_manual_vin: true });

        const mensaje = itemName
            ? `Hola, para identificar con exactitud el repuesto "${itemName}", ¿podría enviarnos el VIN (número de chasis) de su vehículo, por favor?`
            : `Hola, para verificar la compatibilidad exacta de los repuestos, ¿podría enviarnos el VIN (número de chasis) de su vehículo, por favor?`;

        await whatsappService.sendSellerMessage(phone, mensaje);
        await sessionsService.incrementMessageCounter(phone, 'vendedor');

        res.status(200).json({ success: true, mensaje: 'Solicitud de VIN enviada. Flag bloqueante activado.' });
    } catch (error) {
        console.error('Error enviando solicitud de VIN:', error);
        res.status(500).json({ error: 'Error interno al enviar solicitud de VIN.' });
    }
});

/**
 * [MEJORA #2] Solicitar PATENTE manualmente desde el dashboard
 * POST /api/dashboard/solicitar-patente
 * Activa el flag bloqueante solicitud_manual_patente en la sesión.
 */
router.post('/solicitar-patente', async (req, res) => {
    try {
        const { phone, itemName } = req.body;
        if (!phone) {
            return res.status(400).json({ error: 'El campo "phone" es obligatorio.' });
        }

        // MEJORA #2: Activar modo bloqueante ANTES de enviar el mensaje
        await sessionsService.updateEntidades(phone, { solicitud_manual_patente: true });

        const mensaje = itemName
            ? `Hola, para verificar la compatibilidad exacta del repuesto "${itemName}", ¿podría enviarnos la patente de su vehículo, por favor?`
            : `Hola, para verificar la compatibilidad exacta de los repuestos, ¿podría enviarnos la patente de su vehículo, por favor?`;

        await whatsappService.sendSellerMessage(phone, mensaje);
        await sessionsService.incrementMessageCounter(phone, 'vendedor');

        res.status(200).json({ success: true, mensaje: 'Solicitud de patente enviada. Flag bloqueante activado.' });
    } catch (error) {
        console.error('Error enviando solicitud de patente:', error);
        res.status(500).json({ error: 'Error interno al enviar solicitud de patente.' });
    }
});

// ═══════════════════════════════════════════════════════════════
// FERIADOS — CRUD para gestión de feriados (Fix #5)
// ═══════════════════════════════════════════════════════════════
const scheduleService = require('../services/schedule.service');

router.get('/feriados', async (_req, res) => {
    try {
        const { rows } = await db.query('SELECT id, fecha, nombre, created_at FROM feriados ORDER BY fecha ASC');
        res.status(200).json({ total: rows.length, feriados: rows });
    } catch (err) {
        console.error('[Feriados] Error GET:', err);
        res.status(500).json({ error: 'Error al obtener feriados.' });
    }
});

router.post('/feriados', async (req, res) => {
    try {
        const { fecha, nombre } = req.body;
        if (!fecha || !nombre) return res.status(400).json({ error: 'fecha y nombre son requeridos.' });
        const { rows } = await db.query(
            'INSERT INTO feriados (fecha, nombre) VALUES ($1, $2) ON CONFLICT (fecha) DO UPDATE SET nombre = EXCLUDED.nombre RETURNING *',
            [fecha, nombre.trim()]
        );
        scheduleService.invalidateCache();
        console.log(`[Feriados] ✅ Agregado: ${fecha} — ${nombre}`);
        res.status(201).json({ success: true, feriado: rows[0] });
    } catch (err) {
        console.error('[Feriados] Error POST:', err);
        res.status(500).json({ error: 'Error al guardar feriado.' });
    }
});

router.delete('/feriados/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { rowCount } = await db.query('DELETE FROM feriados WHERE id = $1', [id]);
        if (!rowCount) return res.status(404).json({ error: 'Feriado no encontrado.' });
        scheduleService.invalidateCache();
        console.log(`[Feriados] 🗑 Eliminado id=${id}`);
        res.status(200).json({ success: true });
    } catch (err) {
        console.error('[Feriados] Error DELETE:', err);
        res.status(500).json({ error: 'Error al eliminar feriado.' });
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

// ═══════════════════════════════════════════════════════════════
// VENDEDORES — CRUD de equipo por sucursal
// TODO: restringir a admin cuando haya middleware de roles
// ═══════════════════════════════════════════════════════════════

/**
 * GET /api/dashboard/vendedores
 * Query params:
 *   sucursal         (opcional) — filtra activos de esa sucursal
 *   incluir_inactivos ('1')    — devuelve todos (activos e inactivos)
 */
router.get('/vendedores', async (req, res) => {
    try {
        const { sucursal, incluir_inactivos } = req.query;

        let vendedores;
        if (incluir_inactivos === '1') {
            vendedores = await vendedoresService.listarTodos();
        } else if (sucursal) {
            if (!vendedoresService.SUCURSALES_VALIDAS.includes(sucursal)) {
                return res.status(400).json({ error: `Sucursal inválida. Debe ser: ${vendedoresService.SUCURSALES_VALIDAS.join(', ')}` });
            }
            vendedores = await vendedoresService.listarPorSucursal(sucursal);
        } else {
            vendedores = await vendedoresService.listarTodos();
        }

        res.status(200).json({ vendedores });
    } catch (error) {
        console.error('[dashboard.routes] Error GET /vendedores:', error);
        res.status(500).json({ error: 'Error interno al listar vendedores.' });
    }
});

/**
 * POST /api/dashboard/vendedores
 * Body: { nombre: string, sucursal: string }
 * Retorna 201 + vendedor creado
 */
router.post('/vendedores', requireSoporte, async (req, res) => {
    try {
        const { nombre, sucursal } = req.body;

        if (!nombre || !nombre.trim()) {
            return res.status(400).json({ error: 'El campo "nombre" es obligatorio.' });
        }
        if (!sucursal || !sucursal.trim()) {
            return res.status(400).json({ error: 'El campo "sucursal" es obligatorio.' });
        }

        const vendedor = await vendedoresService.crear({ nombre, sucursal });
        res.status(201).json({ vendedor });
    } catch (error) {
        if (error.message && error.message.startsWith('Sucursal inválida')) {
            return res.status(400).json({ error: error.message });
        }
        console.error('[dashboard.routes] Error POST /vendedores:', error);
        res.status(500).json({ error: 'Error interno al crear vendedor.' });
    }
});

/**
 * PATCH /api/dashboard/vendedores/:id
 * Body: { activo: boolean }
 * Retorna el vendedor actualizado o 404 si no existe
 */
router.patch('/vendedores/:id', requireSoporte, async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
            return res.status(400).json({ error: 'ID inválido.' });
        }

        const { activo } = req.body;
        if (typeof activo !== 'boolean') {
            return res.status(400).json({ error: 'El campo "activo" debe ser un booleano.' });
        }

        const vendedor = await vendedoresService.actualizarEstado(id, activo);
        if (!vendedor) {
            return res.status(404).json({ error: `Vendedor id=${id} no encontrado.` });
        }

        res.status(200).json({ vendedor });
    } catch (error) {
        console.error('[dashboard.routes] Error PATCH /vendedores/:id:', error);
        res.status(500).json({ error: 'Error interno al actualizar vendedor.' });
    }
});

/**
 * DELETE /api/dashboard/vendedores/:id
 * Soft delete: pone activo=false en lugar de borrar la fila.
 * Retorna 200 { ok: true } o 404
 */
router.delete('/vendedores/:id', requireSoporte, async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
            return res.status(400).json({ error: 'ID inválido.' });
        }

        const vendedor = await vendedoresService.actualizarEstado(id, false);
        if (!vendedor) {
            return res.status(404).json({ error: `Vendedor id=${id} no encontrado.` });
        }

        res.status(200).json({ ok: true, vendedor });
    } catch (error) {
        console.error('[dashboard.routes] Error DELETE /vendedores/:id:', error);
        res.status(500).json({ error: 'Error interno al desactivar vendedor.' });
    }
});

/**
 * BUG-POST07: Vendedor confirma que el cliente pagó el saldo presencialmente al retirar.
 * POST /api/dashboard/cotizaciones/:phone/saldo-pagado-local
 * Body: { vendedor_nombre? } (opcional)
 */
router.post('/cotizaciones/:phone/saldo-pagado-local', async (req, res) => {
    try {
        const { phone } = req.params;
        const { vendedor_nombre } = req.body || {};

        const session = await sessionsService.getSession(phone);
        if (!session) {
            return res.status(404).json({ error: 'Sesión no encontrada' });
        }
        if (session.estado !== 'ESPERANDO_SALDO') {
            return res.status(409).json({
                error: `Solo se puede confirmar saldo en local cuando estado === ESPERANDO_SALDO. Estado actual: '${session.estado}'.`
            });
        }

        // Persistir vendedor_nombre si vino
        if (vendedor_nombre) {
            await db.query(
                `UPDATE user_sessions SET vendedor_nombre = COALESCE(vendedor_nombre, $1) WHERE phone = $2`,
                [vendedor_nombre, phone]
            );
        }

        // Saldo pagado en local = cliente está físicamente con el producto → cerrar ciclo directo
        await sessionsService.setEstado(phone, 'ENTREGADO');

        const mensaje = `✅ *¡Recibimos el pago del saldo y la entrega del producto!* Su pedido está completo.\n\n` +
                        `¡Muchas gracias por preferir *Repuestos JFNN*! 🙌`;

        await whatsappService.sendSellerMessage(phone, mensaje);
        await sessionsService.incrementMessageCounter(phone, 'vendedor');

        // Solicitud de reseña Google con delay (mismo patrón que /cotizaciones/estado en ENTREGADO)
        setTimeout(() => {
            whatsappService.sendGoogleReviewRequest(phone).catch(err => {
                console.error('Error enviando solicitud de reseña Google:', err);
            });
        }, 5000);

        console.log(`[Dashboard] 💵 Saldo pagado en local + entrega cerrada para ${phone}${vendedor_nombre ? ` por ${vendedor_nombre}` : ''}`);

        const sessionFinal = await sessionsService.getSession(phone).catch(() => null);
        res.status(200).json({
            success: true,
            estado: 'ENTREGADO',
            phone,
            vendedor_cotizo: sessionFinal?.entidades?.vendedor_nombre || null,
        });
    } catch (error) {
        console.error('[Dashboard] Error en saldo-pagado-local:', error);
        res.status(500).json({ error: 'Error interno' });
    }
});

/**
 * REQ-07: Obtener métricas del agente (conversión y eficiencia).
 * GET /api/dashboard/metrics/agent
 */
router.get('/metrics/agent', async (req, res) => {
    try {
        // 1. Total de sesiones
        const totalResult = await db.query('SELECT COUNT(*) as count FROM user_sessions');
        const totalSesiones = parseInt(totalResult.rows[0].count, 10);

        if (totalSesiones === 0) {
            return res.status(200).json({
                success: true,
                metrics: {
                    total_sesiones: 0,
                    conversion_rate: 0,
                    eficiencia_ia: 0,
                    funnel: {},
                    mensajes: { ia: 0, vendedor: 0 }
                }
            });
        }

        // 2. Embudo (Funnel) por estado
        const funnelResult = await db.query('SELECT estado, COUNT(*) as count FROM user_sessions GROUP BY estado');
        const funnel = {};
        funnelResult.rows.forEach(row => {
            funnel[row.estado] = parseInt(row.count, 10);
        });

        // 3. Eficiencia (Mensajes IA vs Vendedor)
        const msgsResult = await db.query('SELECT SUM(mensajes_ia) as ia, SUM(mensajes_vendedor) as vendedor FROM user_sessions');
        const totalIA = parseInt(msgsResult.rows[0].ia || 0, 10);
        const totalVendedor = parseInt(msgsResult.rows[0].vendedor || 0, 10);
        const totalMensajes = totalIA + totalVendedor;
        const eficienciaIA = totalMensajes > 0 ? (totalIA / totalMensajes) * 100 : 0;

        // 4. Conversión (Sesiones en ABONO_VERIFICADO o ENTREGADO)
        const convResult = await db.query(
            `SELECT COUNT(*) as count FROM user_sessions WHERE estado IN ('ABONO_VERIFICADO', 'ENTREGADO')`
        );
        const exitosas = parseInt(convResult.rows[0].count, 10);
        const conversionRate = (exitosas / totalSesiones) * 100;

        res.status(200).json({
            success: true,
            metrics: {
                total_sesiones: totalSesiones,
                conversion_rate: parseFloat(conversionRate.toFixed(2)),
                eficiencia_ia: parseFloat(eficienciaIA.toFixed(2)),
                funnel,
                mensajes: {
                    ia: totalIA,
                    vendedor: totalVendedor,
                    total: totalMensajes
                }
            }
        });
    } catch (error) {
        console.error('[Dashboard] Error en /metrics/agent:', error);
        res.status(500).json({ error: 'Error interno al calcular métricas' });
    }
});

// ═══════════════════════════════════════════════════════════════
// REQ-04 Fase 3 — Endpoints de Conversaciones
// ═══════════════════════════════════════════════════════════════

/**
 * GET /api/dashboard/conversaciones
 * Lista conversaciones activas agrupadas por phone.
 * Query: ?sucursal=Melipilla (opcional, filtro por sucursal)
 */
router.get('/conversaciones', async (req, res) => {
    try {
        const sucursal = req.query.sucursal || null;
        const q = req.query.q || null;
        // listarConversacionesActivas ya hace JOIN con user_sessions y devuelve todo.
        // Antes hacíamos N+1 queries (305 getSession adicionales) → lentitud.
        // Con `q` busca por número, nombre del cliente o palabra clave en mensajes.
        const conversaciones = await mensajesService.listarConversacionesActivas({ sucursal, q });

        const formatted = conversaciones.map(conv => ({
            phone: conv.phone,
            sucursal: conv.sucursal || null,
            estado: conv.estado || null,
            nombre_cliente: conv.nombre_cliente || null,
            marca_modelo: conv.marca_modelo || null,
            ultimo_mensaje_at: conv.ultimo_mensaje_at,
            ultimo_contenido: conv.ultimo_contenido,
            total_entrantes: parseInt(conv.total_entrantes, 10) || 0,
            agente_pausado: conv.agente_pausado === true,
            consulta_pendiente: conv.consulta_pendiente || null,
            pesquisa_pendiente: conv.pesquisa_pendiente || null,
            es_cliente_nuevo: conv.es_cliente_nuevo === true,
            marca: conv.marca || null,
        }));

        res.json(formatted);
    } catch (error) {
        console.error('[Dashboard] Error en /conversaciones:', error);
        res.status(500).json({ error: 'Error listando conversaciones' });
    }
});

/**
 * GET /api/dashboard/conversaciones/:phone
 * Timeline de mensajes de una conversación específica.
 * Query: ?limit=50&before=ISO_TIMESTAMP (paginación scroll infinito)
 */
router.get('/conversaciones/:phone', async (req, res) => {
    try {
        const { phone } = req.params;
        const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
        const before = req.query.before || null;

        const mensajes = await mensajesService.listarPorPhone(phone, { limit, before });

        const enriched = await Promise.all(mensajes.map(async (msg) => {
            let signedUrl = null;
            if (msg.media_url) {
                signedUrl = await storageService.getSignedUrl(msg.media_url);
            }
            return {
                id: msg.id,
                direccion: msg.direccion,
                tipo: msg.tipo,
                contenido: msg.contenido,
                media_url: signedUrl,
                media_mime: msg.media_mime,
                transcripcion: msg.transcripcion,
                autor: msg.autor,
                autor_nombre: msg.autor_nombre,
                created_at: msg.created_at,
                // Para mostrar botón "🔄 Reintentar" cuando media_url falló pero hay media_id recuperable
                media_recuperable: !signedUrl && !!msg.media_id && (msg.tipo === 'image' || msg.tipo === 'audio'),
            };
        }));

        let session = null;
        try {
            session = await sessionsService.getSession(phone);
        } catch (_) { /* no session */ }

        const { rows: ventanaRows } = await db.query(
            `SELECT created_at FROM mensajes WHERE phone = $1 AND direccion = 'entrante' ORDER BY created_at DESC LIMIT 1`,
            [phone]
        );
        const ultimoEntrante = ventanaRows.length > 0 ? new Date(ventanaRows[0].created_at).getTime() : 0;

        const ventana24h = ultimoEntrante > 0
            ? { ultimo_entrante_at: new Date(ultimoEntrante).toISOString(), expira_at: new Date(ultimoEntrante + 24 * 60 * 60 * 1000).toISOString() }
            : null;

        // Fallback: si la sesión actual no tiene nombre, usar el conocido en clientes.
        let nombreCliente = session?.entidades?.nombre_cliente || null;
        if (!nombreCliente) {
            try {
                const cli = await db.query('SELECT nombre FROM clientes WHERE phone = $1 LIMIT 1', [phone]);
                nombreCliente = cli.rows[0]?.nombre || null;
            } catch { /* no-op */ }
        }

        res.json({
            phone,
            estado: session?.estado || null,
            nombre_cliente: nombreCliente,
            sucursal: session?.sucursal || null,
            agente_pausado: session?.entidades?.agente_pausado || false,
            consulta_pendiente: session?.entidades?.consulta_pendiente || null,
            marca: session?.entidades?.marca || null,
            // Datos del vehículo + repuestos para que el chat panel pueda lanzar
            // el SellerActionForm directamente (cotización formal desde el chat).
            entidades: session?.entidades || null,
            ventana_24h: ventana24h,
            mensajes: enriched,
        });
    } catch (error) {
        console.error('[Dashboard] Error en /conversaciones/:phone:', error);
        res.status(500).json({ error: 'Error listando mensajes' });
    }
});

/**
 * POST /api/dashboard/conversaciones/:phone/mensaje
 * Enviar mensaje libre del vendedor desde el chat + persistir.
 */
router.post('/conversaciones/:phone/mensaje', async (req, res) => {
    try {
        const { phone } = req.params;
        const { texto, vendedor_nombre } = req.body;

        if (!texto || !texto.trim()) {
            return res.status(400).json({ error: 'Falta texto del mensaje' });
        }

        // Cancelar debounce pendiente: evita que la IA responda con contexto viejo
        // después del mensaje manual del vendedor.
        cancelDebounce(phone);

        await whatsappService.sendSellerMessage(phone, texto.trim(), {
            autorNombre: vendedor_nombre || 'Sistema JFNN'
        });

        res.json({ success: true });
    } catch (error) {
        if (error.code === 'WHATSAPP_WINDOW_CLOSED') {
            return res.status(403).json({ error: 'Ventana de 24h cerrada. Usa una plantilla HSM.', code: 'WINDOW_CLOSED' });
        }
        console.error('[Dashboard] Error enviando mensaje vendedor:', error.message);
        res.status(500).json({ error: 'Error al enviar mensaje', detalle: error.message });
    }
});

/**
 * GET /api/dashboard/plantillas-hsm
 * Catálogo de plantillas HSM disponibles para re-engage.
 * Nota: requiere Business Verification de Meta para funcionar en producción.
 */
router.get('/plantillas-hsm', async (_req, res) => {
    // Etiquetas/descripciones amigables por nombre de plantilla (las que no estén aquí
    // se muestran con su nombre crudo).
    const LABELS = {
        retomar_cotizacion: { nombre: 'Retomar cotización', descripcion: 'Re-abrir conversación con el cliente' },
        cotizacion_lista: { nombre: 'Cotización lista', descripcion: 'Avisar que la cotización ya tiene precios' },
        comprobante_pendiente: { nombre: 'Comprobante pendiente', descripcion: 'Recordar envío de comprobante de pago' },
        pedido_listo: { nombre: 'Pedido listo para retiro', descripcion: 'Avisar que los repuestos están listos' },
        encargo_llegada: { nombre: 'Encargo llegó', descripcion: 'Avisar que el repuesto por encargo llegó' },
        seguimiento_postventa: { nombre: 'Seguimiento postventa', descripcion: 'Consultar satisfacción post-compra' },
    };
    // Fallback (si Meta no responde): lista mínima conocida, todas con 1 parámetro (nombre).
    const FALLBACK = Object.keys(LABELS).map(id => ({
        id, nombre: LABELS[id].nombre, descripcion: LABELS[id].descripcion, params: ['nombre'], language: 'es_CL',
    }));

    try {
        const aprobadas = await whatsappService.listApprovedTemplates();
        if (!aprobadas || aprobadas.length === 0) return res.json(FALLBACK);

        const plantillas = aprobadas
            .filter(t => t.name !== 'hello_world')
            .map(t => {
                // Derivar nombres de parámetros según cantidad de placeholders {{n}}.
                // El primero siempre es el nombre del cliente; el resto, genéricos.
                const params = Array.from({ length: t.numParams }, (_, i) => (i === 0 ? 'nombre' : `param${i + 1}`));
                const label = LABELS[t.name] || { nombre: t.name, descripcion: t.body?.slice(0, 60) || '' };
                return { id: t.name, nombre: label.nombre, descripcion: label.descripcion, params, language: t.language };
            });
        res.json(plantillas.length ? plantillas : FALLBACK);
    } catch {
        res.json(FALLBACK);
    }
});

/**
 * POST /api/dashboard/conversaciones/:phone/plantilla
 * Enviar una plantilla HSM desde el chat y persistir como mensaje saliente.
 */
router.post('/conversaciones/:phone/plantilla', async (req, res) => {
    try {
        const { phone } = req.params;
        const { plantilla_id, params: tplParams = {}, vendedor_nombre } = req.body;

        if (!plantilla_id) {
            return res.status(400).json({ error: 'Falta plantilla_id' });
        }

        // Resolver el idioma real de la plantilla desde Meta (cae a es_CL si no está).
        let languageCode = 'es_CL';
        try {
            const aprobadas = await whatsappService.listApprovedTemplates();
            const match = aprobadas.find(t => t.name === plantilla_id);
            if (match?.language) languageCode = match.language;
        } catch { /* usar default */ }

        // Parámetros POSICIONALES en orden (las plantillas usan {{1}}, {{2}}…).
        const bodyParams = Object.values(tplParams).map(text => ({ text: String(text) }));

        const response = await whatsappService.sendTemplateMessage(phone, plantilla_id, languageCode, bodyParams);

        const session = await sessionsService.getSession(phone).catch(() => null);

        await mensajesService.registrarSaliente({
            phone,
            tipo: 'text',
            contenido: `[Plantilla: ${plantilla_id}] ${Object.values(tplParams).join(', ')}`,
            autor: 'vendedor',
            autorNombre: vendedor_nombre || null,
            sucursal: session?.sucursal || null,
        });

        res.json({ success: true, messageId: response?.messages?.[0]?.id || 'sent' });
    } catch (error) {
        // Extraer detalle del error de Meta para debug en el dashboard
        const metaError = error.response?.data?.error;
        const detalle = metaError
            ? `Meta error ${metaError.code}: ${metaError.message}${metaError.error_user_msg ? ' — ' + metaError.error_user_msg : ''}`
            : error.message;
        console.error('[Dashboard] Error enviando plantilla desde chat:', detalle);
        res.status(500).json({ error: 'Error al enviar plantilla', detalle });
    }
});

/**
 * POST /api/dashboard/campaign/hsm-masivo
 * Envía una plantilla HSM aprobada a todos los phones de la tabla `clientes`
 * (con filtro opcional por sucursal). Útil para reactivar contactos que tienen
 * el número viejo cacheado tras un cambio de WABA.
 *
 * Body: {
 *   plantilla_id: 'actualizacion_numero_whatsapp' | 'retomar_cotizacion' | ...,
 *   sucursal?: 'Melipilla' | 'San Felipe',
 *   limit?: number (default 1000, max 5000)
 * }
 *
 * Devuelve: { enviados, errores, total, detalle: [...] }
 * Throttle: ~5 mensajes/segundo (Meta acepta más, pero conservador).
 */
router.post('/campaign/hsm-masivo', async (req, res) => {
    try {
        const { plantilla_id, sucursal, limit, reenviar_a_contactados, inactivos_desde } = req.body;
        if (!plantilla_id) return res.status(400).json({ error: 'Falta plantilla_id' });

        const maxLimit = Math.min(parseInt(limit, 10) || 1000, 5000);
        // Por defecto NO reenviar a quienes ya recibieron la campaña (idempotente).
        // Solo se reenvía si el admin lo pide explícitamente.
        const incluirYaContactados = reenviar_a_contactados === true;
        // Opcional: excluir clientes que escribieron desde esta fecha (ya tienen contacto activo,
        // su caché de WhatsApp ya funciona — no necesitan la reactivación).
        const inactivosDesde = inactivos_desde && /^\d{4}-\d{2}-\d{2}/.test(inactivos_desde) ? inactivos_desde : null;

        // Obtener phones de la tabla `clientes`, opcionalmente filtrados por sucursal
        // (los clientes no tienen sucursal directa, derivamos de su última sesión/pedido).
        const params = [];
        let sucursalJoin = '';
        let sucursalWhere = '';
        if (sucursal) {
            params.push(sucursal);
            // Buscar sucursal en pedidos, user_sessions Y mensajes (los importados del
            // backup solo tienen sucursal en mensajes, no en pedidos/sessions).
            sucursalJoin = `
                LEFT JOIN LATERAL (
                    SELECT sucursal FROM pedidos p
                    WHERE p.phone = c.phone AND p.sucursal = $${params.length}
                    LIMIT 1
                ) pp ON TRUE
                LEFT JOIN LATERAL (
                    SELECT sucursal FROM user_sessions s
                    WHERE s.phone = c.phone AND s.sucursal = $${params.length}
                    LIMIT 1
                ) ss ON TRUE
                LEFT JOIN LATERAL (
                    SELECT sucursal FROM mensajes mm
                    WHERE mm.phone = c.phone AND mm.sucursal = $${params.length}
                    LIMIT 1
                ) ms ON TRUE
            `;
            sucursalWhere = `AND (pp.sucursal IS NOT NULL OR ss.sucursal IS NOT NULL OR ms.sucursal IS NOT NULL)`;
        }
        // Excluir clientes que YA recibieron la campaña (a menos que se pida reenviar)
        const noContactadosWhere = incluirYaContactados ? '' : 'AND c.campana_reactivacion_at IS NULL';

        // Excluir clientes que escribieron desde la fecha indicada (ya activos, no necesitan reactivación)
        let inactivosWhere = '';
        if (inactivosDesde) {
            params.push(inactivosDesde);
            inactivosWhere = `AND NOT EXISTS (
                SELECT 1 FROM mensajes m
                WHERE m.phone = c.phone AND m.direccion = 'entrante' AND m.created_at >= $${params.length}::timestamptz
            )`;
        }

        params.push(maxLimit);
        const { rows: clientes } = await db.query(
            `SELECT DISTINCT c.phone, c.nombre
             FROM clientes c
             ${sucursalJoin}
             WHERE c.phone IS NOT NULL ${sucursalWhere} ${noContactadosWhere} ${inactivosWhere}
             ORDER BY c.phone
             LIMIT $${params.length}`,
            params
        );

        console.log(`[Campaña HSM] Iniciando envío de '${plantilla_id}' a ${clientes.length} clientes${sucursal ? ' (' + sucursal + ')' : ''}`);

        // Plantillas y sus param schemas (debe coincidir con el catálogo y lo aprobado en Meta).
        const langMap = {
            retomar_cotizacion: 'es_CL',
            cotizacion_lista: 'es_CL',
            comprobante_pendiente: 'es_CL',
            pedido_listo: 'es_CL',
            encargo_llegada: 'es_CL',
            seguimiento_postventa: 'es_CL',
            actualizacion_numero_whatsapp: 'es_CL'
        };
        const language = langMap[plantilla_id] || 'es_CL';

        // Throttle de ~5 msg/seg
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        let enviados = 0;
        let errores = 0;
        const detalle = [];

        // Formatea el phone chileno legible para usar como saludo cuando no hay nombre
        const formatPhoneSaludo = (p) => {
            if (!p) return '';
            // 56912345678 → +56 9 1234 5678
            if (p.length === 11 && p.startsWith('56')) {
                return ` +56 ${p[2]} ${p.slice(3, 7)} ${p.slice(7)}`;
            }
            return ` ${p}`;
        };

        for (const c of clientes) {
            try {
                // Param 1 = nombre. Si no hay nombre, usar el número formateado (nunca vacío,
                // Meta rechaza params vacíos en algunas plantillas).
                const nombreParam = c.nombre ? ` ${c.nombre.split(' ')[0]}` : formatPhoneSaludo(c.phone);
                const bodyParams = [{ name: '1', text: nombreParam }];
                await whatsappService.sendTemplateMessage(c.phone, plantilla_id, language, bodyParams);

                // Persistir en mensajes para tracking
                try {
                    await mensajesService.registrarSaliente({
                        phone: c.phone,
                        tipo: 'text',
                        contenido: `[Plantilla HSM: ${plantilla_id}] (campaña masiva)`,
                        autor: 'vendedor',
                        autorNombre: 'Sistema (Campaña)',
                        sucursal: sucursal || 'Melipilla',
                    });
                } catch (_) { /* no bloquea */ }

                // Marcar cliente como contactado para no reenviarle en próximas tandas
                try {
                    await db.query('UPDATE clientes SET campana_reactivacion_at = NOW() WHERE phone = $1', [c.phone]);
                } catch (_) { /* no bloquea */ }

                enviados++;
                detalle.push({ phone: c.phone, nombre: c.nombre, status: 'ok' });
                await sleep(200); // ~5 msg/seg
            } catch (err) {
                errores++;
                detalle.push({
                    phone: c.phone,
                    nombre: c.nombre,
                    status: 'error',
                    error: err.response?.data?.error?.message || err.message
                });
            }
        }

        console.log(`[Campaña HSM] Finalizada: ${enviados} OK, ${errores} errores`);
        res.json({ total: clientes.length, enviados, errores, detalle });
    } catch (error) {
        console.error('[Dashboard] Error en campaña HSM:', error);
        res.status(500).json({ error: 'Error en campaña', detalle: error.message });
    }
});

/**
 * POST /api/dashboard/mensajes/:id/reprocesar-media
 * Re-descarga una imagen desde Meta (usando media_id guardado) y la sube a Storage.
 * Para recuperar imágenes que quedaron con media_url null por timeout de Storage.
 */
router.post('/mensajes/:id/reprocesar-media', async (req, res) => {
    try {
        const { id } = req.params;
        const { rows } = await db.query('SELECT id, phone, media_id, media_url, tipo FROM mensajes WHERE id = $1', [id]);
        const msg = rows[0];
        if (!msg) return res.status(404).json({ error: 'Mensaje no encontrado' });
        if (msg.media_url) return res.json({ success: true, ya_tenia: true, media_url: msg.media_url });
        if (!msg.media_id) return res.status(400).json({ error: 'Este mensaje no tiene media_id (mensaje antiguo, no recuperable)' });
        if (!['image', 'audio'].includes(msg.tipo)) {
            return res.status(400).json({ error: `Tipo no soportado para reprocesar: ${msg.tipo}` });
        }

        // Re-descargar de Meta
        const mediaData = await whatsappService.downloadMedia(msg.media_id);
        if (!mediaData) {
            return res.status(502).json({ error: 'No se pudo descargar de Meta. El media_id puede haber expirado (>14 días).' });
        }

        // Subir a Storage (función específica según tipo)
        let objectPath = null;
        try {
            if (msg.tipo === 'audio') {
                objectPath = await storageService.uploadAudio(msg.phone, mediaData.buffer, mediaData.mimeType);
            } else {
                objectPath = await storageService.uploadPartImage(msg.phone, mediaData.buffer, mediaData.mimeType);
            }
        } catch (uploadErr) {
            console.error('[Dashboard] Upload falló en reprocesar-media:', uploadErr.message);
        }
        if (!objectPath) {
            return res.status(502).json({ error: 'Falló la subida a Storage. Reintenta en un momento.' });
        }

        await db.query('UPDATE mensajes SET media_url = $1, media_mime = $2 WHERE id = $3', [objectPath, mediaData.mimeType, id]);
        const signedUrl = await storageService.getSignedUrl(objectPath, 86400);
        res.json({ success: true, media_url: signedUrl, tipo: msg.tipo });
    } catch (error) {
        console.error('[Dashboard] Error reprocesando media:', error.message);
        res.status(500).json({ error: 'Error reprocesando media', detalle: error.message });
    }
});

// ═══════════════════════════════════════════════════════════════
// Cotizaciones persistentes — listado + detalle + archivar/cerrar manual
// ═══════════════════════════════════════════════════════════════

/**
 * GET /api/dashboard/cotizaciones-store
 * Listado de cotizaciones persistidas. Filtros opcionales por query string:
 *   ?estado=ACTIVA|ARCHIVADA|EXPIRADA|CERRADA  ?phone=XXX  ?sucursal=XXX
 *   ?vendedor=XXX  ?limit=100
 */
router.get('/cotizaciones-store', async (req, res) => {
    try {
        const data = await cotizacionesService.listar({
            estado: req.query.estado || undefined,
            phone: req.query.phone || undefined,
            sucursal: req.query.sucursal || undefined,
            vendedor: req.query.vendedor || undefined,
            limit: Math.min(parseInt(req.query.limit, 10) || 100, 500),
        });
        res.status(200).json({ cotizaciones: data });
    } catch (error) {
        console.error('Error en GET /cotizaciones-store:', error);
        res.status(500).json({ error: 'Error interno' });
    }
});

/**
 * GET /api/dashboard/cotizaciones-store/:quoteId
 */
router.get('/cotizaciones-store/:quoteId', async (req, res) => {
    try {
        const cot = await cotizacionesService.getByQuoteId(req.params.quoteId);
        if (!cot) return res.status(404).json({ error: 'No encontrada' });
        res.status(200).json(cot);
    } catch (error) {
        console.error('Error en GET /cotizaciones-store/:quoteId:', error);
        res.status(500).json({ error: 'Error interno' });
    }
});

/**
 * PATCH /api/dashboard/cotizaciones-store/:quoteId/estado
 * Body: { estado: 'ACTIVA'|'ARCHIVADA'|'EXPIRADA'|'CERRADA' }
 */
router.patch('/cotizaciones-store/:quoteId/estado', async (req, res) => {
    try {
        const { estado } = req.body || {};
        if (!estado) return res.status(400).json({ error: 'Falta estado' });
        const updated = await cotizacionesService.setEstado(req.params.quoteId, estado);
        if (!updated) return res.status(404).json({ error: 'No encontrada' });
        res.status(200).json(updated);
    } catch (error) {
        console.error('Error en PATCH /cotizaciones-store/:quoteId/estado:', error);
        res.status(400).json({ error: error.message || 'Error interno' });
    }
});

module.exports = router;
