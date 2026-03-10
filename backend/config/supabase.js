const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("\u274c Faltan credenciales de Supabase en el archivo .env");
    // En test/CI no hacemos exit para no matar el worker de Jest.
    // En producción es responsabilidad del entorno tener el .env configurado.
    if (process.env.NODE_ENV !== 'test') {
        process.exit(1);
    }
}

/**
 * Cliente de Supabase configurado para un servidor Node.js de larga duración.
 * - persistSession: false → evita refrescos de token en background que causan ConnectTimeoutError.
 * - schema: 'public' → explícito para mayor claridad y compatibilidad.
 */
const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
        persistSession: false,
        autoRefreshToken: false,
    },
    db: {
        schema: 'public',
    },
});

console.log('[Supabase] ✅ Cliente inicializado correctamente.');

module.exports = supabase;
