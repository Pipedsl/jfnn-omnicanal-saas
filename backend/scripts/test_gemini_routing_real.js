/**
 * Test del routing Pro/Flash con 80 mensajes REALES de la BD JFNN (últimos 14 días).
 * Muestra distribución total + casos borderline.
 */

const sintomasTecnicos = /\b(calienta|recalienta|ruido|fall(a|o)|vibra|golpe|no enciende|no parte|no prende|humo|chirrido|temblor|p[eé]rdida|fuga|mancha)\b/i;

function elegirModelo(userText, hasAudio = false) {
    const safeText = userText || '';
    return (hasAudio || sintomasTecnicos.test(safeText)) ? 'Pro' : 'Flash';
}

function elegirModeloViejo(userText, hasAudio = false, state = 'PERFILANDO') {
    const safeText = userText || '';
    const isComplex = hasAudio
        || state === 'CONFIRMANDO_COMPRA'
        || (safeText.length > 100 || safeText.toLowerCase().includes('calienta') || safeText.toLowerCase().includes('ruido') || safeText.toLowerCase().includes('falla'));
    return isComplex ? 'Pro' : 'Flash';
}

const mensajes = [
    "Hola","Discos y pastillas delanteras","Radiador de calefacción necesito","Cotizamos con eso por favor","Sip","Gracias","Patente JFTX66 para las bujias que le consulte","Lo tiene disponible solo o tengo que llevarte todo el kit para cambiarlo","Solo con eso","Standar","Pastillas de freno delanteras y traceraa","??","Bueno mucha gracias","Motor Diesel","Directo en local","Hola buenos días","No tiene la respuesta","Hola 👋","Para un Chevrolet Optra 2010","Ya ok, voy hablar con el dueño del auto y veo cual le encargo","Si","Atienden día sábado?","27908869.7","Ando en busca de polea tensora correa alternador Chevrolet Astra GLS 2.0 8v 2006","Quisiera consultar si tienen el switch de las luces del Chevrolet Corsa 2004 1,6","Hola","mijo","Hola buenas tardes, Manguera tipo S para el Chevrolet Optra 1.6","Solo eso por ahora","Tendrá termostato","Buenos días","yaserro","Muchas gracias","Ok gracias","Empaquetaduras \nBomba agua\nBateria\nBomba aceite\nCorrea distribucion\nCorreas accesorios\nBujias\nCables bujias","busco espejo lateral derecho renault koleos 2.5 AT Dynamique","El rodamiento de empuje","Correas accesorios y kit distribución con bomba de agua para un elantra 1996 1.8","Chevrolet luv","Buenos tardes","ok mijo y el descuento","?","Gracias","Alternativos tiene o son originales","que procedencia es","Y la correa 6pk 1680","Buen dia","hola","ZC1654","Tendra bomba de agua para sail 1.4 2013","Cuánto sale una culata para spark 1.0","Tendria que ver los turnos y ver que día sabado podria ur","Tendrán estos repuestos y cuanto saldrían, para ir en la tarde","me equivoqué no era para ustedes","Ese es mi mumero de chasis es motor G4LC la versión mexicana del río 4","Y la bara de dirección la larga queva de la caja de dirección ala caja auxiliar es para la mis camioneta","Cañeria de agua de salida del radiador al motor","Ok","??","Solo eso","Sin","Diesel","No cotizar","Necesito empaquetadura tapa válvula\nBujias\nCable bujías para chevrolet aveo 2008","Buscó bandeja para la Nissan Terrano año 2010","El par","Con Factura a nombre de Roger Pérez porfa","2014","año 2009","El kit de embrague de preferencia luk o valeo","Las casueletas ya se las consulte","Gracias","Vale, ¡gracias!","Y el foco izquierdo del portalón trasero","Serán marca cadic por casualidad?","Solo eso","Solo eso","Radiador","Ya","Solo eso"
];

let pro = 0, flash = 0;
let proViejo = 0, flashViejo = 0;
const cambios = { proAFlash: [], flashAPro: [], igual: [] };

for (const m of mensajes) {
    const nuevo = elegirModelo(m);
    const viejo = elegirModeloViejo(m);
    if (nuevo === 'Pro') pro++; else flash++;
    if (viejo === 'Pro') proViejo++; else flashViejo++;
    if (viejo === 'Pro' && nuevo === 'Flash') cambios.proAFlash.push(m);
    else if (viejo === 'Flash' && nuevo === 'Pro') cambios.flashAPro.push(m);
    else cambios.igual.push(m);
}

console.log(`\n📊 RESULTADO sobre ${mensajes.length} mensajes REALES de la BD JFNN (últimos 14 días)`);
console.log(`────────────────────────────────────────────────────────────────────`);
console.log(`Routing ANTES de optimización:`);
console.log(`  Pro:   ${proViejo} (${((proViejo/mensajes.length)*100).toFixed(1)}%)`);
console.log(`  Flash: ${flashViejo} (${((flashViejo/mensajes.length)*100).toFixed(1)}%)`);
console.log(`\nRouting DESPUÉS de optimización:`);
console.log(`  Pro:   ${pro} (${((pro/mensajes.length)*100).toFixed(1)}%)`);
console.log(`  Flash: ${flash} (${((flash/mensajes.length)*100).toFixed(1)}%)`);
console.log(`\n💰 Ahorro: ${cambios.proAFlash.length}/${mensajes.length} mensajes pasaron Pro→Flash (${((cambios.proAFlash.length/mensajes.length)*100).toFixed(1)}% del tráfico).`);

console.log(`\n🟢 Casos que ANTES iban a Pro y AHORA van a Flash (${cambios.proAFlash.length}):`);
cambios.proAFlash.forEach((m, i) => console.log(`  ${(i+1).toString().padStart(2)}. "${m.replace(/\n/g, ' | ').slice(0, 90)}"`));

console.log(`\n🔴 Casos que ANTES iban a Flash y AHORA van a Pro (${cambios.flashAPro.length}):`);
if (cambios.flashAPro.length === 0) console.log(`  (ninguno)`);
else cambios.flashAPro.forEach((m, i) => console.log(`  ${(i+1).toString().padStart(2)}. "${m.replace(/\n/g, ' | ').slice(0, 90)}"`));

console.log(`\n🟡 Casos que VAN a Pro (revisar si son realmente complejos):`);
const proCases = mensajes.filter(m => elegirModelo(m) === 'Pro');
proCases.forEach((m, i) => console.log(`  ${(i+1).toString().padStart(2)}. "${m.replace(/\n/g, ' | ').slice(0, 90)}"`));
console.log();
