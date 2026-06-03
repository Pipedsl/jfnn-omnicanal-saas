/**
 * Test del routing Pro vs Flash post-optimización.
 * Reproduce la lógica de gemini.service.js línea ~146 y la verifica con casos reales.
 * No llama a Gemini ni a la BD — solo valida el criterio de selección de modelo.
 */

// Replica EXACTA de la lógica en gemini.service.js
const sintomasTecnicos = /\b(calienta|recalienta|ruido|fall(a|o)|vibra|golpe|no enciende|no parte|no prende|humo|chirrido|temblor|p[eé]rdida|fuga|mancha)\b/i;

function elegirModelo(userText, hasAudio = false) {
    const safeText = userText || '';
    const isComplex = hasAudio || sintomasTecnicos.test(safeText);
    return isComplex ? 'gemini-3.1-pro-preview' : 'gemini-3-flash-preview';
}

// Lógica vieja para comparar
function elegirModeloViejo(userText, hasAudio = false, state = 'PERFILANDO') {
    const safeText = userText || '';
    const isComplex = hasAudio
        || state === 'CONFIRMANDO_COMPRA'
        || (safeText.length > 100 || safeText.toLowerCase().includes('calienta') || safeText.toLowerCase().includes('ruido') || safeText.toLowerCase().includes('falla'));
    return isComplex ? 'gemini-3.1-pro-preview' : 'gemini-3-flash-preview';
}

const casos = [
    // Mensajes normales de cotización — DEBEN ir a Flash
    { texto: 'Hola, necesito un filtro de aceite para mi Toyota Hilux 4x4 año 2018 motor 2.4 diesel', estado: 'PERFILANDO', esperado: 'Flash' },
    { texto: 'Sí confirmo', estado: 'CONFIRMANDO_COMPRA', esperado: 'Flash' },
    { texto: 'Cómo pago?', estado: 'CONFIRMANDO_COMPRA', esperado: 'Flash' },
    { texto: 'Qué cuenta uso?', estado: 'CONFIRMANDO_COMPRA', esperado: 'Flash' },
    { texto: 'Voy a transferir, dame los datos por favor', estado: 'CONFIRMANDO_COMPRA', esperado: 'Flash' },
    { texto: 'Ok perfecto, espero la cotización gracias', estado: 'PERFILANDO', esperado: 'Flash' },
    { texto: 'Necesito pastillas de freno delanteras y traseras para Hyundai Tucson 2011 bencinero por favor', estado: 'PERFILANDO', esperado: 'Flash' },

    // Síntomas técnicos — DEBEN ir a Pro
    { texto: 'El motor se calienta cuando voy en subida', estado: 'PERFILANDO', esperado: 'Pro' },
    { texto: 'Hace un ruido raro al frenar', estado: 'PERFILANDO', esperado: 'Pro' },
    { texto: 'Me falla la transmisión a veces', estado: 'PERFILANDO', esperado: 'Pro' },
    { texto: 'Tiene una pérdida de aceite', estado: 'PERFILANDO', esperado: 'Pro' },
    { texto: 'El auto no enciende en las mañanas', estado: 'PERFILANDO', esperado: 'Pro' },
    { texto: 'Sale humo blanco del escape', estado: 'PERFILANDO', esperado: 'Pro' },
    { texto: 'Vibra el volante a alta velocidad', estado: 'PERFILANDO', esperado: 'Pro' },

    // Audio — DEBE ir a Pro
    { texto: '[audio transcrito]', estado: 'PERFILANDO', hasAudio: true, esperado: 'Pro' },
];

let ahorro = 0;
let pasaron = 0;
let fallaron = 0;

console.log('\n╔══════════════════════════════════════════════════════════════════════════════╗');
console.log('║  Test routing Pro/Flash — gemini-cost-optimization                           ║');
console.log('╠══════════════════════════════════════════════════════════════════════════════╣');

for (const c of casos) {
    const nuevo = elegirModelo(c.texto, c.hasAudio || false);
    const viejo = elegirModeloViejo(c.texto, c.hasAudio || false, c.estado);
    const esperadoFull = c.esperado === 'Pro' ? 'gemini-3.1-pro-preview' : 'gemini-3-flash-preview';
    const ok = nuevo === esperadoFull;
    const cambio = viejo !== nuevo ? (viejo.includes('pro') ? '🟢 Pro→Flash' : '🔴 Flash→Pro') : '  =';

    if (ok) pasaron++; else fallaron++;
    if (viejo.includes('pro') && nuevo.includes('flash')) ahorro++;

    const truncado = c.texto.length > 60 ? c.texto.slice(0, 57) + '...' : c.texto;
    console.log(`║ ${ok ? '✅' : '❌'} ${cambio.padEnd(14)} [${c.esperado.padEnd(5)}] "${truncado}"`);
}

console.log('╠══════════════════════════════════════════════════════════════════════════════╣');
console.log(`║  Resultado: ${pasaron}/${casos.length} pasaron, ${fallaron} fallaron`);
console.log(`║  Casos que ANTES iban a Pro y AHORA van a Flash (ahorro): ${ahorro}/${casos.length}`);
console.log('╚══════════════════════════════════════════════════════════════════════════════╝\n');

process.exit(fallaron === 0 ? 0 : 1);
