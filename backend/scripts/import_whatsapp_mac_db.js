#!/usr/bin/env node
'use strict';

/**
 * import_whatsapp_mac_db.js
 * Importa mensajes desde la base de datos SQLite de WhatsApp para Mac
 * (ChatStorage.sqlite) directamente a la tabla `mensajes` de PostgreSQL.
 *
 * Uso:
 *   node scripts/import_whatsapp_mac_db.js --sucursal Melipilla [--dry-run]
 *
 * La DB se lee de la ubicación estándar de WhatsApp para Mac:
 *   ~/Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite
 */

const path = require('path');
const os = require('os');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

let Database;
try {
    Database = require('better-sqlite3');
} catch {
    console.error('❌ Falta better-sqlite3. Instala con: npm install better-sqlite3');
    process.exit(1);
}

const db = require('../config/db');

const args = process.argv.slice(2);
const SUCURSAL = args.includes('--sucursal') ? args[args.indexOf('--sucursal') + 1] : 'Melipilla';
const DRY_RUN = args.includes('--dry-run');
const CUSTOM_PATH = args.includes('--db') ? args[args.indexOf('--db') + 1] : null;

const SQLITE_PATH = CUSTOM_PATH || path.join(
    os.homedir(),
    'Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite'
);

// Apple Core Data epoch: 2001-01-01T00:00:00Z
const APPLE_EPOCH = new Date('2001-01-01T00:00:00Z').getTime();

function appleTimestampToDate(ts) {
    if (!ts) return null;
    return new Date(APPLE_EPOCH + ts * 1000);
}

function extractPhone(jid) {
    if (!jid) return null;
    // Format: 569XXXXXXXX@s.whatsapp.net
    const match = jid.match(/^(\d+)@s\.whatsapp\.net$/);
    return match ? match[1] : null;
}

async function main() {
    console.log(`\n📱 Importando desde WhatsApp Mac DB`);
    console.log(`📁 SQLite: ${SQLITE_PATH}`);
    console.log(`🏪 Sucursal: ${SUCURSAL}`);
    if (DRY_RUN) console.log('🔍 MODO DRY RUN\n');

    const sqlite = new Database(SQLITE_PATH, { readonly: true });

    // Query all text messages with their chat session info
    const messages = sqlite.prepare(`
        SELECT
            m.ZISFROMME,
            m.ZTEXT,
            m.ZMESSAGEDATE,
            m.ZPUSHNAME,
            m.ZMESSAGETYPE,
            m.ZSTANZAID,
            c.ZCONTACTJID
        FROM ZWAMESSAGE m
        JOIN ZWACHATSESSION c ON m.ZCHATSESSION = c.Z_PK
        WHERE c.ZCONTACTJID LIKE '%@s.whatsapp.net'
        ORDER BY m.ZMESSAGEDATE ASC
    `).all();

    console.log(`📝 Total mensajes encontrados: ${messages.length}`);

    // Filter out messages without phone
    const valid = messages.filter(m => extractPhone(m.ZCONTACTJID));
    console.log(`📝 Mensajes con número válido: ${valid.length}`);

    // Count unique phones
    const phones = new Set(valid.map(m => extractPhone(m.ZCONTACTJID)));
    console.log(`👥 Conversaciones únicas: ${phones.size}`);

    const withText = valid.filter(m => m.ZTEXT);
    const withoutText = valid.filter(m => !m.ZTEXT);
    const incoming = valid.filter(m => m.ZISFROMME === 0);
    const outgoing = valid.filter(m => m.ZISFROMME === 1);
    console.log(`   ↙️  Entrantes: ${incoming.length}`);
    console.log(`   ↗️  Salientes: ${outgoing.length}`);
    console.log(`   💬 Con texto: ${withText.length}`);
    console.log(`   📎 Sin texto (media): ${withoutText.length}`);

    if (DRY_RUN) {
        console.log('\n--- Preview (primeros 10 mensajes con texto) ---');
        withText.slice(0, 10).forEach((m, i) => {
            const phone = extractPhone(m.ZCONTACTJID);
            const date = appleTimestampToDate(m.ZMESSAGEDATE);
            const dir = m.ZISFROMME ? 'SAL' : 'ENT';
            console.log(`  [${i + 1}] ${date?.toISOString()} | ${dir} | ${phone} | ${(m.ZTEXT || '').slice(0, 80)}`);
        });

        console.log('\n--- Conversaciones ---');
        const phoneCounts = {};
        valid.forEach(m => {
            const p = extractPhone(m.ZCONTACTJID);
            phoneCounts[p] = (phoneCounts[p] || 0) + 1;
        });
        Object.entries(phoneCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 20)
            .forEach(([p, count]) => console.log(`  +${p}: ${count} mensajes`));

        console.log(`\n✅ Dry run completado. Ejecuta sin --dry-run para insertar.`);
        sqlite.close();
        return;
    }

    let inserted = 0;
    let skipped = 0;

    for (const msg of valid) {
        const phone = extractPhone(msg.ZCONTACTJID);
        const date = appleTimestampToDate(msg.ZMESSAGEDATE);
        const direccion = msg.ZISFROMME ? 'saliente' : 'entrante';
        const autor = msg.ZISFROMME ? 'vendedor' : 'cliente';
        const tipo = msg.ZTEXT ? 'text' : 'image';
        const contenido = msg.ZTEXT || null;

        try {
            // Skip if stanzaId already exists (dedup)
            if (msg.ZSTANZAID) {
                const dup = await db.query(
                    'SELECT id FROM mensajes WHERE wa_message_id = $1 LIMIT 1',
                    [msg.ZSTANZAID]
                );
                if (dup.rows.length > 0) {
                    skipped++;
                    continue;
                }
            }

            await db.query(
                `INSERT INTO mensajes
                    (phone, direccion, tipo, contenido, autor, sucursal, wa_message_id, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [phone, direccion, tipo, contenido, autor, SUCURSAL, msg.ZSTANZAID || null, date]
            );
            inserted++;
        } catch (err) {
            console.error(`  ❌ Error: ${err.message}`);
            skipped++;
        }

        if (inserted % 500 === 0 && inserted > 0) {
            console.log(`  ... ${inserted} insertados`);
        }
    }

    console.log(`\n✅ Importación completada:`);
    console.log(`   Insertados: ${inserted}`);
    console.log(`   Duplicados/errores: ${skipped}`);
    console.log(`   Total procesados: ${valid.length}`);
    console.log(`   Conversaciones: ${phones.size}`);

    sqlite.close();
    await db.end();
}

main().catch(err => {
    console.error('❌ Error fatal:', err);
    process.exit(1);
});
