#!/usr/bin/env node
'use strict';

/**
 * import_whatsapp_export.js
 * Importa un archivo _chat.txt exportado desde WhatsApp Business
 * a la tabla `mensajes` de la base de datos.
 *
 * Uso:
 *   node scripts/import_whatsapp_export.js \
 *     --file ./export/_chat.txt \
 *     --phone 569XXXXXXXX \
 *     --sucursal Melipilla \
 *     --business-name "Repuestos JFNN"
 *
 * El script detecta automaticamente el formato de timestamp chileno
 * y clasifica mensajes como entrantes (cliente) o salientes (vendedor).
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const db = require('../config/db');

const args = process.argv.slice(2);
const getArg = (name) => {
    const idx = args.indexOf(`--${name}`);
    return idx >= 0 && args[idx + 1] ? args[idx + 1] : null;
};

const FILE = getArg('file');
const PHONE = getArg('phone');
const SUCURSAL = getArg('sucursal') || 'Melipilla';
const BUSINESS_NAME = getArg('business-name') || 'Repuestos JFNN';
const DRY_RUN = args.includes('--dry-run');

if (!FILE || !PHONE) {
    console.error('Uso: node import_whatsapp_export.js --file <path> --phone <569XXXXXXXX> [--sucursal Melipilla] [--business-name "Repuestos JFNN"] [--dry-run]');
    process.exit(1);
}

const normalizePhone = (p) => p.replace(/\D/g, '');

// Formatos de timestamp que WhatsApp usa segun el locale del telefono
// Chile: "15-01-26, 10:32" o "15/01/26, 10:32" o "15-01-2026, 10:32"
// US:    "1/15/26, 10:32 AM"
const LINE_REGEX = /^(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AaPp][Mm])?)\s+-\s+(.+?):\s+([\s\S]*)$/;

const SYSTEM_PATTERNS = [
    /^Messages and calls are end-to-end encrypted/i,
    /^Los mensajes y las llamadas est.n cifrados/i,
    /^Se cambió el código de seguridad/i,
    /^You changed this group/i,
    /^Cambiaste el asunto/i,
    /^‎/,  // Left-to-right mark (system messages)
    /^Este mensaje fue eliminado/i,
    /^This message was deleted/i,
    /^Missed .* call/i,
    /^Llamada .* perdida/i,
];

function parseTimestamp(dateStr, timeStr) {
    const dateParts = dateStr.split(/[\/\-]/);
    let day, month, year;

    // Detect format by analyzing the parts
    if (dateParts[0].length === 4) {
        // YYYY-MM-DD
        year = parseInt(dateParts[0]);
        month = parseInt(dateParts[1]) - 1;
        day = parseInt(dateParts[2]);
    } else {
        // DD/MM/YY or MM/DD/YY — assume Chilean format (DD/MM)
        day = parseInt(dateParts[0]);
        month = parseInt(dateParts[1]) - 1;
        year = parseInt(dateParts[2]);
    }

    if (year < 100) year += 2000;

    // Parse time
    let timePart = timeStr.trim();
    let hours, minutes;
    const ampmMatch = timePart.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])/);
    if (ampmMatch) {
        hours = parseInt(ampmMatch[1]);
        minutes = parseInt(ampmMatch[2]);
        const ampm = ampmMatch[4].toUpperCase();
        if (ampm === 'PM' && hours !== 12) hours += 12;
        if (ampm === 'AM' && hours === 12) hours = 0;
    } else {
        const parts = timePart.split(':');
        hours = parseInt(parts[0]);
        minutes = parseInt(parts[1]);
    }

    return new Date(year, month, day, hours, minutes);
}

function isSystemMessage(text) {
    return SYSTEM_PATTERNS.some(p => p.test(text));
}

function isBusinessMessage(sender) {
    const normalized = sender.toLowerCase().trim();
    const businessNormalized = BUSINESS_NAME.toLowerCase().trim();
    return normalized === businessNormalized || normalized.includes(businessNormalized);
}

function classifyMedia(text) {
    const lower = text.toLowerCase();
    if (lower.includes('<media omitted>') || lower.includes('<multimedia omitido>')) return 'image';
    if (lower.includes('.jpg') || lower.includes('.jpeg') || lower.includes('.png') || lower.includes('.webp')) return 'image';
    if (lower.includes('.opus') || lower.includes('.mp3') || lower.includes('.m4a') || lower.includes('.ogg')) return 'audio';
    if (lower.includes('.mp4') || lower.includes('.3gp') || lower.includes('.mov')) return 'video';
    if (lower.includes('.pdf') || lower.includes('.doc') || lower.includes('.docx')) return 'document';
    return null;
}

async function main() {
    const phone = normalizePhone(PHONE);
    console.log(`\n📱 Importando chats para: ${phone}`);
    console.log(`📁 Archivo: ${FILE}`);
    console.log(`🏪 Sucursal: ${SUCURSAL}`);
    console.log(`🏢 Nombre negocio: ${BUSINESS_NAME}`);
    if (DRY_RUN) console.log('🔍 MODO DRY RUN — no se insertara nada en la DB\n');

    const content = fs.readFileSync(FILE, 'utf-8');
    const lines = content.split('\n');

    const messages = [];
    let currentMsg = null;

    for (const line of lines) {
        const match = line.match(LINE_REGEX);
        if (match) {
            if (currentMsg) messages.push(currentMsg);
            const [, dateStr, timeStr, sender, text] = match;
            currentMsg = {
                timestamp: parseTimestamp(dateStr, timeStr),
                sender: sender.trim(),
                text: text.trim(),
            };
        } else if (currentMsg) {
            // Multi-line message continuation
            currentMsg.text += '\n' + line;
        }
    }
    if (currentMsg) messages.push(currentMsg);

    console.log(`📝 Total lineas parseadas: ${messages.length}`);

    // Filter out system messages
    const filtered = messages.filter(m => !isSystemMessage(m.text));
    console.log(`📝 Mensajes validos (sin sistema): ${filtered.length}`);

    const entrantes = filtered.filter(m => !isBusinessMessage(m.sender));
    const salientes = filtered.filter(m => isBusinessMessage(m.sender));
    console.log(`   ↙️  Entrantes (cliente): ${entrantes.length}`);
    console.log(`   ↗️  Salientes (negocio): ${salientes.length}`);

    if (DRY_RUN) {
        console.log('\n--- Primeros 10 mensajes (preview) ---');
        filtered.slice(0, 10).forEach((m, i) => {
            const dir = isBusinessMessage(m.sender) ? 'SAL' : 'ENT';
            const tipo = classifyMedia(m.text) || 'text';
            console.log(`  [${i + 1}] ${m.timestamp.toISOString()} | ${dir} | ${tipo} | ${m.sender}: ${m.text.slice(0, 80)}`);
        });
        console.log('\n✅ Dry run completado. Ejecuta sin --dry-run para insertar.');
        await db.end();
        return;
    }

    let inserted = 0;
    let skipped = 0;

    for (const msg of filtered) {
        const isBusiness = isBusinessMessage(msg.sender);
        const mediaType = classifyMedia(msg.text);
        const tipo = mediaType || 'text';
        const contenido = mediaType ? null : msg.text;
        const direccion = isBusiness ? 'saliente' : 'entrante';
        const autor = isBusiness ? 'vendedor' : 'cliente';
        const autorNombre = isBusiness ? null : msg.sender;

        try {
            await db.query(
                `INSERT INTO mensajes
                    (phone, direccion, tipo, contenido, autor, autor_nombre, sucursal, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [phone, direccion, tipo, contenido, autor, autorNombre, SUCURSAL, msg.timestamp]
            );
            inserted++;
        } catch (err) {
            console.error(`  ❌ Error insertando mensaje ${msg.timestamp.toISOString()}: ${err.message}`);
            skipped++;
        }
    }

    console.log(`\n✅ Importacion completada:`);
    console.log(`   Insertados: ${inserted}`);
    console.log(`   Errores: ${skipped}`);
    console.log(`   Total: ${filtered.length}`);

    await db.end();
}

main().catch(err => {
    console.error('❌ Error fatal:', err);
    process.exit(1);
});
