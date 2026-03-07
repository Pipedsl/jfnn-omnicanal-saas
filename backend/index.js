const express = require('express');
const cors = require('cors');
require('dotenv').config();

// Importar rutas
const whatsappRoutes = require('./routes/whatsapp.routes');

const app = express();
const port = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// Registro de rutas de WhatsApp
app.use('/api/whatsapp', whatsappRoutes);

app.get('/', (req, res) => {
    res.json({ message: 'JFNN Omnicanal API is running' });
});

app.listen(port, () => {
    console.log(`Server is running context: http://localhost:${port}`);
    console.log('WhatsApp Webhook endpoint: /api/whatsapp/webhook');
});
