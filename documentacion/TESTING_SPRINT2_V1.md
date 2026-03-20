# Plan de Pruebas - Sprint 2 y Flujo de Abonos (@arquitecto-lead)

Este plan de pruebas valida la correcta integración de las funcionalidades de **Modo Pausa, Captura de Nombre, Reseñas Google** y la corrección del **Flujo de Abonos**.

---

## 🧪 Caso de Prueba 1: Modo Pausa Vendedor (HU-3)
**Objetivo**: Validar que el vendedor puede silenciar al Agente IA para intervenir manualmente.

1.  **Preparación**: Inicia una conversación nueva con el bot desde WhatsApp.
2.  **Activación**: En el Dashboard, busca la `QuoteCard` de tu número y activa el switch **"🔇 Pausar Agente"**.
3.  **Verificación - Silencio**: Escribe cualquier mensaje al bot (ej: "¿Qué marca es el repuesto?"). 
    *   **Resultado Esperado**: El bot **NO debe responder** nada.
4.  **Desactivación**: En el Dashboard, desactiva el switch.
5.  **Verificación - Reactivación**: Escribe un nuevo mensaje.
    *   **Resultado Esperado**: El bot vuelve a responder con normalidad integrando el contexto anterior.

---

## 🧪 Caso de Prueba 2: Captura y Solicitud de Nombre (HU-4)
**Objetivo**: Validar que el sistema captura el nombre del cliente y lo usa en cierres presenciales.

1.  **Escenario A (Captura Silenciosa)**:
    *   Escribe: "Hola, soy [Tu Nombre], necesito pastillas para un Toyota Yaris".
    *   **Resultado Esperado**: En el Dashboard, la tarjeta del cliente debe actualizarse mostrando tu nombre en el título.
2.  **Escenario B (Solicitud en Cierre)**:
    *   Si el bot NO sabe tu nombre aún, avanza hasta el cierre y elige **"Pagar en Local"**.
    *   **Resultado Esperado**: El bot debe solicitarte el nombre amablemente: *"¿Podría confirmarme su nombre completo?"*.
3.  **Mensaje Final**: Una vez capturado el nombre, el bot debe enviar un mensaje de confirmación que diga:
    *   *"¡Muchas gracias, [Tu Nombre]! Su código de cotización es #JFNN-XXXX..."*

---

## 🧪 Caso de Prueba 3: Solicitud de Reseña Google (HU-6)
**Objetivo**: Validar el envío automático de la solicitud de feedback.

1.  **Escenario**: Finaliza una venta y marca el pedido como **ENTREGADO** desde el Dashboard.
2.  **Espera**: No envíes mensajes por 5-10 segundos.
3.  **Verificación**:
    *   **Resultado Esperado**: Debes recibir un WhatsApp automático: *"¡Muchas gracias por su compra...! Link a Google Maps: [URL]"*.
    *   Revisar que la URL sea la configurada en el `.env`.

---

## 🧪 Caso de Prueba 4: Flujo de Abonos y Saldo (Fix)
**Objetivo**: Validar que el flujo no se queda "estancado" al pagar el saldo restante.

1.  **Preparación**: Un pedido debe estar en estado `ENCARGO_SOLICITADO`.
2.  **Acción**: Presiona el botón verde **"🛬 Repuestos Llegaron (Cobrar Saldo)"**.
    *   **Resultado Esperado**: El estado cambia a `ESPERANDO_SALDO`.
3.  **Acción del Cliente**: Envía una foto de un comprobante de transferencia por el saldo restante.
4.  **Verificación**:
    *   **Resultado Esperado**: El bot debe responder confirmando recepción y el estado de la sesión debe cambiar automáticamente a **`ESPERANDO_APROBACION_ADMIN`** para que el administrador valide el pago final.
    *   **Importante**: El sistema NO debe quedarse mudo ni en estado `ESPERANDO_SALDO` tras recibir la foto.

---

**Nota para el Usuario**: Por favor, realiza estas pruebas en orden y confirma si los resultados son los esperados para proceder con el Sprint de "Mejoras IA" (HU-1 y HU-2).
