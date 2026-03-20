const fs = require('fs');
const path = require('path');

/**
 * @devops-cloud + @backend-node — BUG-1 (P0) Sprint 3
 * Servicio de almacenamiento LOCAL para comprobantes de pago.
 * Migrado desde Supabase Storage → disco local en /uploads/comprobantes/
 * Los archivos se sirven vía Express estático si se necesita visualización futura.
 */

// Directorio raíz de uploads (relativo al proceso, siempre apunta a backend/uploads)
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads', 'comprobantes');

// Crear el directorio si no existe al cargar el módulo
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    console.log(`[Storage] 📁 Directorio de comprobantes creado: ${UPLOADS_DIR}`);
}

/**
 * Guarda el buffer de imagen en disco local como comprobante de pago.
 * @param {string} phone - Número de teléfono del cliente
 * @param {Buffer} imageBuffer - Buffer binario de la imagen
 * @param {string} mimeType - Tipo MIME (ej: 'image/jpeg')
 * @returns {Promise<string|null>} Ruta relativa del archivo guardado, o null en caso de error
 */
const uploadVoucher = async (phone, imageBuffer, mimeType) => {
    try {
        const extension = mimeType?.split('/')?.[1]?.replace('jpeg', 'jpg') || 'jpg';
        const sanitizedPhone = phone.replace(/[^0-9]/g, '');
        const fileName = `${sanitizedPhone}_${Date.now()}.${extension}`;
        const fullPath = path.join(UPLOADS_DIR, fileName);

        // Guardar en disco local
        fs.writeFileSync(fullPath, imageBuffer);

        // Retornar ruta relativa (usada como URL local para el dashboard)
        const relativePath = `/uploads/comprobantes/${fileName}`;
        console.log(`[Storage] ✅ Voucher guardado localmente: ${relativePath}`);
        return relativePath;

    } catch (err) {
        console.error('[Storage] ❌ Error guardando voucher en disco:', err.message);
        return null;
    }
};

module.exports = {
    uploadVoucher
};
