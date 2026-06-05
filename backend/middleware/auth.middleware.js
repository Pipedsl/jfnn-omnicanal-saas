'use strict';

const { jwtVerify } = require('jose');
const { isObservador } = require('../utils/observadores');

const JWT_SECRET = new TextEncoder().encode(
    process.env.AUTH_SECRET || 'jfnn-secret-fallback-change-in-prod'
);

const verifyJWT = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
        return res.status(401).json({ error: 'Token requerido' });
    }

    try {
        const { payload } = await jwtVerify(token, JWT_SECRET);
        req.user = {
            role: payload.role || 'vendedor',
            sucursal: payload.sucursal || null,
        };
        next();
    } catch {
        return res.status(401).json({ error: 'Token inválido o expirado' });
    }
};

const requireAdmin = (req, res, next) => {
    // Soporte es superset de admin: también pasa.
    if (req.user?.role !== 'admin' && req.user?.role !== 'soporte') {
        return res.status(403).json({ error: 'Acceso solo para admin' });
    }
    next();
};

const requireSoporte = (req, res, next) => {
    if (req.user?.role !== 'soporte') {
        return res.status(403).json({ error: 'Acceso solo para soporte' });
    }
    next();
};

/**
 * Bloquea mutations (POST/PATCH/PUT/DELETE) cuando la identidad declarada en
 * el body o headers corresponde a un vendedor observador (lista OBSERVADORES).
 * Las rutas GET pasan sin filtro — el observador puede LEER todo.
 *
 * Identidad declarada: campo `vendedor_nombre` en body, o header
 * `X-Vendedor-Nombre`, o cookie `jfnn_vendedor_nombre`. Cualquiera basta.
 */
const requireNotObserver = (req, res, next) => {
    const method = (req.method || '').toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();

    const nombre = (req.body?.vendedor_nombre)
        || req.headers['x-vendedor-nombre']
        || req.cookies?.jfnn_vendedor_nombre
        || null;

    if (isObservador(nombre)) {
        console.warn(`[Observador] 🚫 ${method} ${req.originalUrl} rechazado para "${nombre}" (solo lectura).`);
        return res.status(403).json({
            error: 'Modo solo lectura',
            detalle: 'Este vendedor está en entrenamiento. No puede ejecutar acciones de escritura.',
        });
    }
    next();
};

module.exports = { verifyJWT, requireAdmin, requireSoporte, requireNotObserver };
