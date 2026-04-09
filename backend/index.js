const express = require('express');
const cors = require('cors');
require('dotenv').config();

// Importar rutas
const whatsappRoutes = require('./routes/whatsapp.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const sessionsService = require('./services/sessions.service');

const app = express();
const port = process.env.PORT || 4000;

app.use(cors({
    origin: [
        'http://localhost:3000',
        'https://panel.repuestosjfnn.cl',
        // Acepta cualquier subdominio de vercel.app durante el deploy
        /\.vercel\.app$/,
    ],
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true
}));
app.use(express.json());

// Servir archivos estáticos (comprobantes de pago locales HUs)
const path = require('path');
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Registro de rutas
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/dashboard', dashboardRoutes);

// Health check para Railway
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), env: process.env.NODE_ENV });
});

app.get('/', (req, res) => {
    res.json({ message: 'JFNN Omnicanal API is running' });
});

app.listen(port, () => {
    console.log(`Server is running context: http://localhost:${port}`);
    console.log('WhatsApp Webhook endpoint: /api/whatsapp/webhook');

    // ─── Auto-Archivado de Sesiones Abandonadas ────────────────
    const ARCHIVE_HOURS = parseInt(process.env.AUTO_ARCHIVE_HOURS) || 48;
    const ARCHIVE_INTERVAL_MS = 4 * 60 * 60 * 1000; // Cada 4 horas

    // Ejecutar una vez al iniciar (despues de 30s para dar tiempo a la DB)
    setTimeout(() => {
        sessionsService.autoArchiveStaleSessions(ARCHIVE_HOURS);
    }, 30_000);

    // Programar ejecución periódica
    setInterval(() => {
        sessionsService.autoArchiveStaleSessions(ARCHIVE_HOURS);
    }, ARCHIVE_INTERVAL_MS);

    console.log(`[AutoArchive] ⏰ Programado cada 4h (umbral: ${ARCHIVE_HOURS}h de inactividad)`);
});
