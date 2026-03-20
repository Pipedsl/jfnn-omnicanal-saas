/**
 * Cliente PostgreSQL local.
 * Reemplaza el cliente de Supabase para el entorno de desarrollo/testing local.
 * Usa un Pool de conexiones para manejar concurrencia eficientemente.
 */
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // Límite de conexiones: evita saturar PostgreSQL
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
    console.error('[DB] ❌ Error inesperado en pool de conexiones:', err.message);
});

pool.on('connect', () => {
    console.log('[DB] ✅ Nueva conexión establecida con PostgreSQL local.');
});

module.exports = pool;
