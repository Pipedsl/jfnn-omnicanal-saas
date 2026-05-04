require('dotenv').config();
const supabase = require('./config/supabase');

const phone = process.argv[2];
if (!phone || !/^\d{8,15}$/.test(phone)) {
    console.error('Uso: node rescue_session.js <phone>  (ej: 56912345678)');
    process.exit(1);
}

async function rescueSession() {
    const { data, error } = await supabase
        .from('user_sessions')
        .update({ estado: 'CICLO_COMPLETO' })
        .eq('phone', phone)
        .select();

    if (error) {
        console.error('Error rescuing session:', error);
    } else {
        console.log(`✅ Sesión ${phone} movida a CICLO_COMPLETO`);
        console.table(data);
    }
    process.exit();
}

rescueSession();
