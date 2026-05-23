'use strict';

const { jwtVerify } = require('jose');

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
    if (req.user?.role !== 'admin') {
        return res.status(403).json({ error: 'Acceso solo para admin' });
    }
    next();
};

module.exports = { verifyJWT, requireAdmin };
