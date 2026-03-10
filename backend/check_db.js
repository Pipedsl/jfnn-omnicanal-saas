require('dotenv').config();
const supabase = require('./config/supabase');

async function checkDatabase() {
    try {
        const { data, error } = await supabase
            .from('user_sessions')
            .select('*');

        if (error) {
            console.error('Error querying Supabase:', error);
        } else {
            console.log('--- Database Content ---');
            if (data.length === 0) {
                console.log('No sessions found in user_sessions table.');
            } else {
                console.table(data.map(d => ({
                    phone: d.phone,
                    estado: d.estado,
                    updated: d.ultimo_mensaje
                })));
            }
            console.log('Total sessions:', data.length);
        }
    } catch (e) {
        console.error('Crash:', e);
    }
    process.exit();
}

checkDatabase();
