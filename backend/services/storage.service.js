const supabase = require('../config/supabase');

/**
 * Servicio de almacenamiento para subir archivos multimedia a Supabase Storage.
 * Utilizado para guardar comprobantes de pago enviados por clientes vía WhatsApp.
 */

/**
 * Sube un buffer de imagen al bucket 'comprobantes' de Supabase Storage.
 * @param {string} phone - Número de teléfono del cliente (usado como prefijo del nombre del archivo)
 * @param {Buffer} imageBuffer - Buffer binario de la imagen
 * @param {string} mimeType - Tipo MIME de la imagen (ej: 'image/jpeg')
 * @returns {Promise<string|null>} URL pública del archivo subido, o null en caso de error
 */
const uploadVoucher = async (phone, imageBuffer, mimeType) => {
    try {
        const extension = mimeType?.split('/')?.[1] || 'jpeg';
        const sanitizedPhone = phone.replace(/[^0-9]/g, '');
        const fileName = `${sanitizedPhone}_${Date.now()}.${extension}`;
        const filePath = `vouchers/${fileName}`;

        // 1. Subir a Supabase Storage en el bucket 'comprobantes'
        const { error: uploadError } = await supabase.storage
            .from('comprobantes')
            .upload(filePath, imageBuffer, {
                contentType: mimeType,
                upsert: false
            });

        if (uploadError) {
            console.error('[Storage] ❌ Error subiendo voucher a Supabase:', uploadError.message);
            return null;
        }

        // 2. Construir la URL pública del archivo recién subido
        const { data: urlData } = supabase.storage
            .from('comprobantes')
            .getPublicUrl(filePath);

        const publicUrl = urlData?.publicUrl;
        console.log(`[Storage] ✅ Voucher subido exitosamente: ${publicUrl}`);
        return publicUrl;

    } catch (err) {
        console.error('[Storage] ❌ Excepción inesperada en uploadVoucher:', err.message);
        return null;
    }
};

module.exports = {
    uploadVoucher
};
