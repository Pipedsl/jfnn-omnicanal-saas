require('dotenv').config();
const supabase = require('./config/supabase');

async function fixSession() {
    const { data, error } = await supabase
        .from('user_sessions')
        .update({ estado: 'PAGO_VERIFICADO' })
        .eq('phone', '56974792499')
        .select();

    if (error) {
        console.error('Error fixing session:', error);
    } else {
        console.log('✅ Sesión devuelta a PAGO_VERIFICADO para mostrar botones.');
        console.table(data);
    }
    process.exit();
}

fixSession();
