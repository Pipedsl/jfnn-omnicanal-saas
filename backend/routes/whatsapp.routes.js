const express = require('express');
const router = express.Router();
const whatsappController = require('../controllers/whatsapp.controller');

/**
 * Endpoints del Webhook de WhatsApp
 * GET: Validación de Meta
 * POST: Recepción de mensajes
 */
router.get('/webhook', whatsappController.verifyWebhook);
router.post('/webhook', whatsappController.receiveMessage);

module.exports = router;
