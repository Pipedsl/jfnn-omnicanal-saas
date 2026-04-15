/**
 * Mejora #7 — Reconstruye stats de clientes recurrentes a partir del histórico de `pedidos`.
 *
 * Recorre la tabla `pedidos` y por cada teléfono:
 *  - upsert en `clientes` con nombre/email/rut del último pedido (si existen)
 *  - total_compras = count(pedidos)
 *  - total_gastado = sum(total_cotizacion)
 *  - ultima_compra = max(archivado_en)
 *  - es_recurrente = total_compras >= 2
 *  - vehiculos_historicos = JSONB con combos únicos (marca_modelo, ano)
 *
 * Uso: node backend/scripts/seed_clientes_from_pedidos.js
 * Ejecutable localmente o en Railway (read-only si no hay pedidos nuevos).
 */

const db = require('../config/db');

async function run() {
    console.log('[Seed] 🌱 Iniciando reconstrucción de clientes desde pedidos...');

    const { rows: pedidos } = await db.query(`
        SELECT phone, marca_modelo, ano, patente, total_cotizacion, archivado_en,
               entidades_completas
        FROM pedidos
        ORDER BY phone, archivado_en ASC
    `);

    if (!pedidos.length) {
        console.log('[Seed] ℹ️  No hay pedidos archivados. Nada que seedear.');
        process.exit(0);
    }

    // Agrupar por phone
    const grupos = new Map();
    for (const p of pedidos) {
        if (!grupos.has(p.phone)) grupos.set(p.phone, []);
        grupos.get(p.phone).push(p);
    }

    let upserts = 0;
    for (const [phone, lista] of grupos.entries()) {
        const total_compras = lista.length;
        const total_gastado = lista.reduce((acc, p) => acc + (parseInt(p.total_cotizacion) || 0), 0);
        const ultima_compra = lista[lista.length - 1].archivado_en;
        const es_recurrente = total_compras >= 2;

        // Extraer nombre/email/rut del entidades_completas del pedido más reciente
        const ultimoEntidades = lista[lista.length - 1].entidades_completas || {};
        const nombre = ultimoEntidades.nombre_cliente || null;
        const email = ultimoEntidades.email_cliente || null;
        const rut = ultimoEntidades.rut_cliente || ultimoEntidades.datos_factura?.rut || null;

        // Dedup vehículos por (marca_modelo, ano)
        const vistos = new Set();
        const vehiculos_historicos = [];
        for (const p of lista) {
            const key = `${(p.marca_modelo || '').toLowerCase()}|${p.ano || ''}`;
            if (!vistos.has(key) && (p.marca_modelo || p.ano)) {
                vistos.add(key);
                vehiculos_historicos.push({
                    marca_modelo: p.marca_modelo || null,
                    ano: p.ano || null,
                    patente: p.patente || null,
                    ultima_compra: p.archivado_en
                });
            }
        }

        await db.query(`
            INSERT INTO clientes (phone, nombre, email, rut, total_compras, total_gastado,
                                  ultima_compra, vehiculos_historicos, es_recurrente, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
            ON CONFLICT (phone) DO UPDATE SET
                nombre = COALESCE(EXCLUDED.nombre, clientes.nombre),
                email = COALESCE(EXCLUDED.email, clientes.email),
                rut = COALESCE(EXCLUDED.rut, clientes.rut),
                total_compras = EXCLUDED.total_compras,
                total_gastado = EXCLUDED.total_gastado,
                ultima_compra = EXCLUDED.ultima_compra,
                vehiculos_historicos = EXCLUDED.vehiculos_historicos,
                es_recurrente = EXCLUDED.es_recurrente,
                updated_at = NOW()
        `, [phone, nombre, email, rut, total_compras, total_gastado,
            ultima_compra, JSON.stringify(vehiculos_historicos), es_recurrente]);

        upserts++;
        console.log(`[Seed] ✓ ${phone} — ${total_compras} compra(s), $${total_gastado}, recurrente=${es_recurrente}, ${vehiculos_historicos.length} vehículo(s)`);
    }

    console.log(`[Seed] ✅ Listo. ${upserts} cliente(s) sincronizados.`);
    process.exit(0);
}

run().catch(err => {
    console.error('[Seed] ❌ Error:', err);
    process.exit(1);
});
