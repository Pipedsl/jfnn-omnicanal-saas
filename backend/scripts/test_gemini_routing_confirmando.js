/**
 * Test del routing Pro/Flash con 40 mensajes REALES en estado CONFIRMANDO_COMPRA.
 * Antes: 100% de estos iban a Pro (porque estado == 'CONFIRMANDO_COMPRA').
 * Ahora: solo van a Pro si tienen síntomas técnicos (regex).
 */

const sintomasTecnicos = /\b(calienta|recalienta|ruido|fall(a|o)|vibra|golpe|no enciende|no parte|no prende|humo|chirrido|temblor|p[eé]rdida|fuga|mancha)\b/i;

function elegirModelo(userText, hasAudio = false) {
    return (hasAudio || sintomasTecnicos.test(userText || '')) ? 'Pro' : 'Flash';
}

const mensajes = ["Okaaa","Y saber si hacen envíos a Limache","Buenas tardes","Std","Si las 4 completas porfavor","No para mi","WT 2424","Me falto agregar el capot","Hola termostato Kia Cerato 2010","Hola buen día","2013 1.6","Hola 👋","Anillos estándar \nMetales biela 0,50\nMetales bancada 0,50\nEmpaquetadura","Río 4","Hola, estoy contactando desde la página web https://repuestosjfnn.cl/","Para un Nissan v16 año 2008 twincam","2007","Tambien necesito la base que va atras del parachoques","Okey gracias","Hola buen día quisiera cotizar sensor TPS CHEVROLET CORSA EVOLUTION 1.8 año 2003... MAS ACEITE  FILTRO DE ACEITE Y REFRIGERANTE 50/50","Buenas tardes","Ok","Si solo eso","Hola buenos días","Y la masa ?","rodamiento de masa para corsa 1.7 2004","Chevrolet aveo \n-kit de empaquetaduras\n-silicona Victor reinz (negra)\n-termostato\n-coolant básico\n-aceite+filtro\n-bujías\n-pernos de culata\n-electro ventilador","Orlando","Quería  cositar unos repuestos para un nissan v16","tienen gomas de barra estabilizadora de corsa","Lado chofer","Cómo está??","Gracias por comunicarte con AP Automotriz. ¿Cómo podemos ayudarte?","Gracias","está bien","Hola riel de los inyectores del daewoo","gracias!","Hola buenas tardes oiga tienen por casualidad este repuesto","Es para los amortiguadores delanteros","Hola sensor tensor accesorios"];

let pro = 0, flash = 0;
const proCases = [], flashCases = [];

for (const m of mensajes) {
    const r = elegirModelo(m);
    if (r === 'Pro') { pro++; proCases.push(m); }
    else { flash++; flashCases.push(m); }
}

console.log(`\n📊 RESULTADO sobre ${mensajes.length} mensajes en CONFIRMANDO_COMPRA (BD JFNN, 14d)`);
console.log(`────────────────────────────────────────────────────────────────────`);
console.log(`Routing ANTES: 100% Pro (${mensajes.length}/${mensajes.length}) — todos por estado=CONFIRMANDO_COMPRA`);
console.log(`Routing AHORA: Pro=${pro} (${((pro/mensajes.length)*100).toFixed(1)}%), Flash=${flash} (${((flash/mensajes.length)*100).toFixed(1)}%)`);
console.log(`💰 Ahorro en este estado: ${flash}/${mensajes.length} mensajes pasan Pro→Flash`);
console.log();
console.log(`🟡 Casos que SIGUEN yendo a Pro (revisar):`);
if (proCases.length === 0) console.log(`  (ninguno)`);
else proCases.forEach((m, i) => console.log(`  ${(i+1).toString().padStart(2)}. "${m.replace(/\n/g, ' | ').slice(0, 90)}"`));
console.log();
