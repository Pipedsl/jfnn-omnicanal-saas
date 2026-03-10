# 🧪 Guía de Pruebas Manuales End-to-End (E2E)

Esta guía te permitirá validar el flujo completo desde que un cliente escribe por WhatsApp hasta que el vendedor cierra la venta en el Dashboard.

## 1. Preparación Técnica (Realizada por Antigravity)

He habilitado un túnel seguro que conecta tu computadora con internet:
*   **URL Pública Backend:** `https://nonextrinsically-caritative-gilberte.ngrok-free.dev`
*   **Endpoint de Webhook:** `https://nonextrinsically-caritative-gilberte.ngrok-free.dev/api/whatsapp/webhook`
*   **Token de Verificación:** `jfnn_seguro_2026`

## 2. Configuración en Meta Developers

Para que WhatsApp pueda enviarle mensajes a tu bot, debes configurar la URL en el panel de Meta:
1.  Entra a [business.facebook.com](https://developers.facebook.com/).
2.  Ve a tu Aplicación -> **WhatsApp** -> **Configuración**.
3.  En la sección de **Webhook**:
    *   **URL de devolución de llamada:** Copia la URL de arriba (terminada en `/api/whatsapp/webhook`).
    *   **Identificador de verificación:** `jfnn_seguro_2026`
4.  Haz clic en **Verificar y Guardar**.
5.  En **Suscripciones de Webhook**, asegúrate de que el campo `messages` esté activado.

---

## 3. Escenario de Prueba (Paso a Paso)

### Fase A: El Cliente (Tú en WhatsApp)
1.  Escribe al número de prueba de JFNN: *"Hola, necesito una bomba de agua para un Toyota Yaris 2019"*.
2.  **El Bot responderá:** Se presentará como asesor mecánico y te preguntará por la patente o VIN.
3.  Dile la patente o invéntala: *"Es ABCD-12"*.
4.  **El Bot responderá:** *"Perfecto, ya tengo los datos. Un asesor revisará el stock y te enviará la cotización por aquí mismo."* (El bot entra en estado `ESPERANDO_VENDEDOR`).

### Fase B: El Vendedor (Tú en el Dashboard)
1.  Abre tu navegador en `http://localhost:3000`.
2.  Verás que aparece la tarjeta de tu chat.
3.  Haz clic en **"Responder"**:
    *   Asigna un precio (ej: `$45.000`).
    *   Marca como **"Disponible"**.
    *   Añade una nota: *"Calidad original, un año de garantía."*
4.  Haz clic en **"Enviar Cotización"**.

### Fase C: El Cierre AI (De vuelta en WhatsApp)
1.  Recibirás la cotización formal por WhatsApp con el ID de cuota.
2.  Responde: *"Me interesa, ¿como coordino el pago?"*
3.  **El Bot retomará el control** (Estado `CONFIRMANDO_COMPRA`):
    *   Te preguntará si prefieres transferencia o efectivo.
    *   Te preguntará si quieres envío o retiro.
    *   Te preguntará si necesitas Boleta o Factura.
4.  **Finalización**: Si eliges factura, dale los datos de empresa. El bot te agradecerá y cerrará el ciclo.

---

## 4. Gestión de Venta (Dashboard)
Una vez el bot termine el perfilado de pago, en el Dashboard verás nuevos botones en tu tarjeta de cliente:
*   **Verificar Pago**: Haz clic cuando simules el pago.
*   **Marcar Entregado**: Cuando el producto "salga" a despacho.
*   **Archivar**: Para limpiar la pantalla una vez terminada la venta.

---

> [!TIP]
> Si el bot deja de responder, revisa la terminal del backend. Si ves un error de "Quotas" de Gemini, recuerda que estamos usando el modelo `Flash-Lite` para ahorrar créditos.
