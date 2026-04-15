/**
 * Replay de chats reales de WhatsApp contra gemini.service local.
 *
 * - Parsea archivos `_chat.txt` exportados desde WhatsApp.
 * - Separa turnos: "cliente" (cualquier participante que NO sea "JFNN MELIPILLA")
 *   vs "vendedor" (JFNN MELIPILLA).
 * - Por cada turno del cliente llama a generateResponse() y compara con la
 *   respuesta humana real del vendedor que aparece a continuación.
 * - NO escribe en BD ni llama al webhook: todo en memoria.
 *
 * Uso:
 *   node backend/scripts/test_chats_replay.js [rutaChat1] [rutaChat2] ...
 *   node backend/scripts/test_chats_replay.js --all
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const { generateResponse } = require('../services/gemini.service');

const VENDEDOR = 'JFNN MELIPILLA';
const AUTO_RESP = /gracias por comunicarte con jfnn/i;
const ENCRYPT_NOTICE = /mensajes y las llamadas están cifrados/i;
const ATTACH_RE = /<adjunto:\s*([^>]+)>/i;

// Regex del formato WhatsApp export:
// [DD-MM-YY, H:MM:SS a.m./p.m.] ~Nombre: mensaje
// También soporta sin tilde/segundos en algunos exports.
const LINE_RE = /^\[(\d{1,2}-\d{1,2}-\d{2,4}),\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*(a\.?\s*m\.?|p\.?\s*m\.?)\]\s*([^:]+?):\s?(.*)$/i;

function parseChat(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8');
    // WhatsApp exports suelen traer U+200E (LRM) pegado a adjuntos/sistema
    const cleaned = raw.replace(/\u200e/g, '');
    const rawLines = cleaned.split(/\r?\n/);

    const entries = [];
    for (const line of rawLines) {
        const m = line.match(LINE_RE);
        if (m) {
            const [, fecha, hora, ampm, autor, msg] = m;
            entries.push({
                fecha,
                hora: `${hora} ${ampm}`,
                autor: autor.trim().replace(/^~\s?/, ''),
                text: msg.trim()
            });
        } else if (entries.length > 0 && line.trim()) {
            // Continuación de mensaje multilinea
            entries[entries.length - 1].text += '\n' + line.trim();
        }
    }
    return entries;
}

function isSystemLine(e) {
    if (!e.text) return true;
    if (ENCRYPT_NOTICE.test(e.text)) return true;
    if (AUTO_RESP.test(e.text)) return true;
    return false;
}

function isVendedor(e) {
    return e.autor.toUpperCase().includes('JFNN');
}

/**
 * Agrupa turnos consecutivos del mismo actor.
 * Devuelve [{ actor: 'cliente'|'vendedor', mensajes: [string], adjuntos: [string] }]
 */
function buildTurns(entries) {
    const turns = [];
    for (const e of entries) {
        if (isSystemLine(e)) continue;
        const actor = isVendedor(e) ? 'vendedor' : 'cliente';
        const attach = e.text.match(ATTACH_RE);
        const cleanText = attach ? `[ADJUNTO: ${attach[1]}]` : e.text;

        if (turns.length && turns[turns.length - 1].actor === actor) {
            turns[turns.length - 1].mensajes.push(cleanText);
        } else {
            turns.push({ actor, mensajes: [cleanText] });
        }
    }
    return turns;
}

/**
 * Merge simple de entidades recibidas de Gemini sobre una sesión mock.
 * Réplica mínima de lo esencial de sessions.service.mergeEntidades para no
 * depender de la capa de BD.
 */
function mergeEntidades(session, nuevas) {
    if (!nuevas) return session;
    const ent = session.entidades;
    for (const k of Object.keys(nuevas)) {
        const v = nuevas[k];
        if (v === null || v === undefined) continue;
        if (k === 'repuestos_solicitados' && Array.isArray(v)) {
            const existentes = ent.repuestos_solicitados || [];
            const nombres = new Set(existentes.map(r => (r.nombre || '').toLowerCase()));
            for (const nr of v) {
                if (!nr || !nr.nombre) continue;
                if (!nombres.has(nr.nombre.toLowerCase())) {
                    existentes.push({
                        nombre: nr.nombre,
                        cantidad: nr.cantidad || 1,
                        precio: null,
                        estado: 'pendiente'
                    });
                }
            }
            ent.repuestos_solicitados = existentes;
        } else if (k === 'vehiculos' && Array.isArray(v)) {
            ent.vehiculos = v;
        } else if (k === 'datos_factura' && typeof v === 'object') {
            ent.datos_factura = { ...(ent.datos_factura || {}), ...v };
        } else {
            ent[k] = v;
        }
    }
    return session;
}

function buildInitialSession(phone = '+569TEST') {
    return {
        phone,
        estado: 'PERFILANDO',
        entidades: {
            nombre_cliente: null,
            email_cliente: null,
            rut_cliente: null,
            marca_modelo: null,
            ano: null,
            patente: null,
            vin: null,
            motor: null,
            combustible: null,
            vehiculos: [],
            repuestos_solicitados: [],
            metodo_pago: null,
            metodo_entrega: null,
            tipo_documento: null,
            datos_factura: { rut: null, razon_social: null, giro: null },
            quote_id: null
        }
    };
}

const C_RESET = '\x1b[0m';
const C_DIM = '\x1b[2m';
const C_CYAN = '\x1b[36m';
const C_GREEN = '\x1b[32m';
const C_YELLOW = '\x1b[33m';
const C_MAGENTA = '\x1b[35m';
const C_RED = '\x1b[31m';

function header(text) {
    const line = '═'.repeat(Math.max(60, text.length + 4));
    console.log(`\n${C_CYAN}${line}${C_RESET}`);
    console.log(`${C_CYAN}║ ${text}${C_RESET}`);
    console.log(`${C_CYAN}${line}${C_RESET}`);
}

async function replayChat(filePath, maxTurnos = Infinity, timeLimitMs = Infinity) {
    const deadline = timeLimitMs === Infinity ? Infinity : Date.now() + timeLimitMs;
    const entries = parseChat(filePath);
    const turns = buildTurns(entries);

    const displayName = path.basename(path.dirname(filePath)) === 'whatsapps'
        ? path.basename(filePath)
        : path.basename(path.dirname(filePath));

    header(`CHAT: ${displayName}`);
    console.log(`${C_DIM}Turnos totales: ${turns.length} (parseadas ${entries.length} líneas)${C_RESET}`);

    const session = buildInitialSession();
    let turnoIdx = 0;
    const resultados = [];

    for (let i = 0; i < turns.length; i++) {
        const turn = turns[i];
        if (turn.actor !== 'cliente') continue;
        if (turnoIdx >= maxTurnos) {
            console.log(`\n${C_DIM}(límite de ${maxTurnos} turnos alcanzado, se omite el resto)${C_RESET}`);
            break;
        }
        if (Date.now() > deadline) {
            console.log(`\n${C_DIM}(⏱ timeout de ${Math.round(timeLimitMs/1000)}s alcanzado, se omite el resto)${C_RESET}`);
            break;
        }

        turnoIdx++;
        const userText = turn.mensajes.join('\n');

        // Mostrar contexto: mensaje del cliente
        console.log(`\n${C_YELLOW}── Turno #${turnoIdx} ──${C_RESET}`);
        console.log(`${C_YELLOW}👤 CLIENTE:${C_RESET} ${userText}`);

        let aiResp;
        try {
            aiResp = await generateResponse(userText, session);
        } catch (err) {
            console.log(`${C_RED}💥 Error llamando generateResponse: ${err.message}${C_RESET}`);
            continue;
        }

        const aiMsg = aiResp.mensaje_cliente || '(sin respuesta)';
        console.log(`${C_GREEN}🤖 AI  JFNN:${C_RESET} ${aiMsg}`);

        // Respuesta real del vendedor (siguiente turno de vendedor)
        let vendedorReal = null;
        for (let j = i + 1; j < turns.length; j++) {
            if (turns[j].actor === 'vendedor') {
                vendedorReal = turns[j].mensajes.join(' ⏎ ');
                break;
            }
            if (turns[j].actor === 'cliente') break;
        }

        if (vendedorReal) {
            console.log(`${C_MAGENTA}🧔 REAL JFNN:${C_RESET} ${vendedorReal}`);
        } else {
            console.log(`${C_DIM}(sin respuesta real del vendedor en el chat)${C_RESET}`);
        }

        // Merge de entidades en la sesión mock para el siguiente turno
        mergeEntidades(session, aiResp.entidades || {});

        resultados.push({
            turno: turnoIdx,
            cliente: userText,
            ai: aiMsg,
            real: vendedorReal,
            accion: aiResp.accion || null,
            entidadesNuevas: aiResp.entidades || {}
        });
    }

    console.log(`\n${C_DIM}Estado final de la sesión mock:${C_RESET}`);
    console.log(JSON.stringify(session.entidades, null, 2));

    return { chat: displayName, turnos: resultados, estadoFinal: session.entidades };
}

async function main() {
    const args = process.argv.slice(2);
    const rootWhatsapps = path.join(__dirname, '..', '..', 'whatsapps');

    const maxArg = args.find(a => a.startsWith('--max-turnos='));
    const maxTurnos = maxArg ? parseInt(maxArg.split('=')[1], 10) : Infinity;

    const timeArg = args.find(a => a.startsWith('--time-limit-per-chat='));
    const timeLimitMs = timeArg ? parseInt(timeArg.split('=')[1], 10) * 1000 : Infinity;

    const deleteAfter = args.includes('--delete-after');
    const saveResultsArg = args.find(a => a.startsWith('--save-results='));
    const saveDir = saveResultsArg ? saveResultsArg.split('=')[1] : null;
    if (saveDir && !fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });

    let chatFiles = [];
    if (args.includes('--loose-chats')) {
        // Procesa cualquier _chat*.txt en la raíz de whatsapps/
        chatFiles = fs.readdirSync(rootWhatsapps)
            .filter(n => /^_chat.*\.txt$/i.test(n))
            .map(n => path.join(rootWhatsapps, n));
    } else if (args.includes('--all') || args.filter(a => !a.startsWith('--')).length === 0) {
        const candidates = [
            path.join(rootWhatsapps, '_chat.txt'),
            path.join(rootWhatsapps, 'WhatsApp Chat - +56 9 9656 5907', '_chat.txt'),
            path.join(rootWhatsapps, 'WhatsApp Chat - +56 9 4035 0723', '_chat.txt'),
            path.join(rootWhatsapps, 'WhatsApp Chat - Kike 🤟🤙😑 (Maestro)', '_chat.txt'),
            path.join(rootWhatsapps, 'WhatsApp Chat - Maestro (Michael)', '_chat.txt')
        ];
        chatFiles = candidates.filter(p => fs.existsSync(p));
    } else {
        chatFiles = args.filter(a => !a.startsWith('--'));
    }

    if (chatFiles.length === 0) {
        console.error('No se encontraron archivos _chat.txt para procesar');
        process.exit(1);
    }

    if (!process.env.GEMINI_API_KEY) {
        console.error('❌ Falta GEMINI_API_KEY en backend/.env');
        process.exit(1);
    }

    const reportes = [];
    let idx = 0;
    for (const f of chatFiles) {
        idx++;
        console.log(`\n${C_CYAN}[${idx}/${chatFiles.length}] ${path.basename(f)}${C_RESET}`);
        try {
            const r = await replayChat(f, maxTurnos, timeLimitMs);
            reportes.push(r);
            if (saveDir) {
                const base = path.basename(f).replace(/\.txt$/, '.json');
                fs.writeFileSync(path.join(saveDir, base), JSON.stringify(r, null, 2));
            }
            if (deleteAfter) {
                try {
                    fs.unlinkSync(f);
                    console.log(`${C_DIM}🗑 eliminado ${path.basename(f)}${C_RESET}`);
                } catch (e) {
                    console.error(`no pude eliminar ${f}: ${e.message}`);
                }
            }
        } catch (err) {
            console.error(`❌ Error procesando ${f}: ${err.message}`);
        }
    }

    // Resumen final
    header('RESUMEN GLOBAL');
    for (const rep of reportes) {
        console.log(`- ${rep.chat}: ${rep.turnos.length} turnos del cliente simulados`);
    }
}

main().catch(err => {
    console.error('💥 Fallo global:', err);
    process.exit(1);
});
