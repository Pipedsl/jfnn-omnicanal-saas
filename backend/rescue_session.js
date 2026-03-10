require('dotenv').config();
const supabase = require('./config/supabase');

async function rescueSession() {
    const { data, error } = await supabase
        .from('user_sessions')
        .update({ estado: 'CICLO_COMPLETO' })
        .eq('phone', '56974792499')
        .select();

    if (error) {
        console.error('Error rescuing session:', error);
    } else {
        console.log('✅ Sesión rescatada y movida a CICLO_COMPLETO');
        console.table(data);
    }
    process.exit();
}

rescueSession();
