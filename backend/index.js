const express = require('express');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// Importar rutas
const whatsappRoutes = require('./routes/whatsapp.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const { verifyJWT, requireNotObserver } = require('./middleware/auth.middleware');
const sessionsService = require('./services/sessions.service');
const { flushAllBuffers, recoverUnansweredSessions } = require('./controllers/whatsapp.controller');
const db = require('./config/db');

const app = express();
const port = process.env.PORT || 4000;

// Railway pone el servicio detrás de un reverse proxy y agrega X-Forwarded-For.
// Confiamos en 1 hop para que express-rate-limit use la IP real del cliente.
app.set('trust proxy', 1);

// Gzip compression para JSON responses. Reduce egress ~65% en payloads grandes
// (listados de conversaciones, mensajes, métricas). Express maneja Accept-Encoding
// automáticamente — si el cliente no soporta gzip, sirve sin comprimir.
app.use(compression({
    threshold: 1024, // solo comprimir respuestas > 1KB
    level: 6,        // balance velocidad/ratio (default)
}));

app.use(cors({
    origin: [
        'http://localhost:3000',
        'https://panel.repuestosjfnn.cl',
        process.env.DASHBOARD_URL || 'https://jfnn-omnicanal-saas.vercel.app',
    ],
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true
}));

const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
});
// Capturar rawBody para que el webhook de Meta pueda validar X-Hub-Signature-256.
app.use(express.json({
    limit: '15mb', // permitir imágenes en base64 (~10MB binary → ~14MB base64)
    verify: (req, _res, buf) => { req.rawBody = buf; }
}));

// Servir archivos estáticos (comprobantes de pago locales HUs)
const path = require('path');
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Registro de rutas
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/dashboard', apiLimiter, verifyJWT, requireNotObserver, dashboardRoutes);

// Reporte de errores de cliente del dashboard (público, sin JWT: el crash puede
// ocurrir con token expirado/ausente). Loguea a consola para verlo en Railway y poder
// diagnosticar el error real, que en prod llega minificado en el navegador.
const clientErrorLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });
app.post('/api/client-error', clientErrorLimiter, (req, res) => {
    try {
        const b = req.body || {};
        const safe = (v, n = 500) => (v == null ? '' : String(v).slice(0, n));
        console.error('[ClientError] ❌ ' + safe(b.message, 300));
        console.error('[ClientError]    url=' + safe(b.url, 200) + ' | scope=' + safe(b.scope, 40) + ' | digest=' + safe(b.digest, 80));
        console.error('[ClientError]    role=' + safe(b.role, 40) + ' | sucursal=' + safe(b.sucursal, 40) + ' | ua=' + safe(b.userAgent, 200));
        if (b.stack) console.error('[ClientError]    stack=' + safe(b.stack, 2000));
    } catch {
        // nunca fallar este endpoint
    }
    res.status(204).end();
});

// Health check básico para Railway (liveness — no toca la DB)
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), env: process.env.NODE_ENV });
});

app.get('/api/health/db', async (req, res) => {
    try {
        await db.query('SELECT 1');
        res.json({ status: 'ok' });
    } catch {
        res.status(503).json({ status: 'error' });
    }
});

app.get('/', (req, res) => {
    res.json({ message: 'JFNN Omnicanal API is running' });
});

const server = app.listen(port, () => {
    console.log(`Server is running context: http://localhost:${port}`);
    console.log('WhatsApp Webhook endpoint: /api/whatsapp/webhook');

    // ─── Recuperación de mensajes sin responder (buffer perdido en redeploy) ───
    // El buffer de debounce vive en memoria; un redeploy/crash lo pierde y el agente
    // nunca responde. Al iniciar, reprocesamos conversaciones cuyo último mensaje es
    // del cliente y quedó sin respuesta. Corre antes que el auto-archive.
    setTimeout(() => {
        recoverUnansweredSessions();
    }, 15_000);

    // ─── Barrido periódico de recuperación ─────────────────────────
    // Antes solo corría al arrancar → un cliente que quedaba sin respuesta a media
    // jornada (Gemini falló bajo carga, buffer perdido, etc.) esperaba hasta el
    // próximo redeploy y soporte lo resolvía a mano. Ahora corre cada pocos minutos:
    // cualquier conversación con último mensaje del cliente sin respuesta se reintenta
    // sola (la función ya filtra estado activo, no pausado y colchón de 90s).
    const RECOVERY_SWEEP_MS = parseInt(process.env.RECOVERY_SWEEP_MS || String(3 * 60 * 1000), 10);
    setInterval(() => { recoverUnansweredSessions(); }, RECOVERY_SWEEP_MS);
    console.log(`[Recovery] ⏰ Barrido periódico programado cada ${RECOVERY_SWEEP_MS / 1000}s.`);

    // ─── Auto-Archivado de Sesiones Abandonadas ────────────────
    // Grupos (configurable por env, defaults seguros):
    //   PERFILANDO/ESPERANDO_VENDEDOR: 48h → ABANDONADO
    //   CONFIRMANDO_COMPRA/ESPERANDO_COMPROBANTE: 120h (5d) → NO_RESPONDIO_CIERRE
    //   CICLO_COMPLETO: 120h (5d) → CIERRE_TIMEOUT
    // Snapshot completo va a `pedidos` con phone + quote_id + repuestos + entidades
    // para mantener trazabilidad de "qué pidieron los clientes" aunque se limpie
    // la bandeja del vendedor.
    const ARCHIVE_INTERVAL_MS = 4 * 60 * 60 * 1000; // Cada 4 horas
    setTimeout(() => { sessionsService.autoArchiveStaleSessions(); }, 30_000);
    setInterval(() => { sessionsService.autoArchiveStaleSessions(); }, ARCHIVE_INTERVAL_MS);
    console.log('[AutoArchive] ⏰ Programado cada 4h. Grupos: perfilado=48h, cotización=120h, cierre=120h (configurable por env).');

    // ─── Expiración automática de cotizaciones (validez 5 días) ────────
    // Cada 1h marcamos como EXPIRADA cualquier cotización ACTIVA cuya valida_hasta < NOW().
    const cotizacionesService = require('./services/cotizaciones.service');
    const EXPIRAR_INTERVAL_MS = 60 * 60 * 1000; // 1h
    setTimeout(() => { cotizacionesService.expirarAntiguas(); }, 45_000);
    setInterval(() => { cotizacionesService.expirarAntiguas(); }, EXPIRAR_INTERVAL_MS);
    console.log(`[Cotizaciones] ⏰ Expiración programada cada 1h (validez ${cotizacionesService.VALIDEZ_DIAS} días)`);
});

// ─── Graceful shutdown: vaciar buffers de debounce antes de morir ───
// Railway envía SIGTERM antes de detener el contenedor en cada redeploy. Procesamos los
// buffers pendientes (best-effort, con tope de tiempo) para no perder mensajes en vuelo.
let shuttingDown = false;
const gracefulShutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[Shutdown] ⚠️ ${signal} recibido. Cerrando con flush de buffers...`);
    server.close(() => console.log('[Shutdown] 🔌 Servidor HTTP dejó de aceptar conexiones.'));
    try {
        // Tope de 8s para no exceder el período de gracia de Railway.
        await Promise.race([
            flushAllBuffers(),
            new Promise((resolve) => setTimeout(resolve, 8000)),
        ]);
    } catch (err) {
        console.error('[Shutdown] ❌ Error en flush:', err.message);
    }
    console.log('[Shutdown] 👋 Saliendo.');
    process.exit(0);
};
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
