/**
 * Utilidad para imprimir un resumen estructurado (Shadow Quote) en la terminal.
 * Ayuda al vendedor a copiar los datos rápidamente para Layla.cl u otros sistemas.
 */

const printShadowQuote = (phone, entidades) => {
    console.log("\n" + "=".repeat(50));
    console.log("🚀 SHADOW QUOTE - FICHA TÉCNICA GENERADA");
    console.log("=".repeat(50));
    console.log(`📱 Cliente: ${phone}`);
    console.log(`🚗 Vehículo: ${entidades.marca_modelo || 'No detectado'}`);
    console.log(`📅 Año: ${entidades.ano || 'No detectado'}`);
    console.log(`🛠️ Motor: ${entidades.motor || 'No detectado'} | Combustible: ${entidades.combustible || 'No detectado'}`);
    console.log(`🆔 Patente: ${entidades.patente || 'No detectada'}`);
    console.log(`🔢 VIN: ${entidades.vin || 'No detectado'}`);
    console.log(`📦 Repuestos: ${JSON.stringify(entidades.repuestos_solicitados || [], null, 2)}`);
    console.log("=".repeat(50));
    console.log("MODO: ESPERANDO VENDEDOR");
    console.log("=".repeat(50) + "\n");
};

module.exports = {
    printShadowQuote
};
