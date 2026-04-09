# Plan de Pruebas Completo — Sprint 3: Mejoras de Flujo + Ventana 24h + Auto-Archivado

Este documento cubre las pruebas de validación de **todas** las funcionalidades implementadas en los Sprints 2.5 y 3.

---

## 🔧 Preparación del Entorno

1. Iniciar backend: `cd backend && npm run dev`
2. Iniciar dashboard: `cd dashboard && npm run dev`
3. Verificar en la terminal que aparezca:
   ```
   [AutoArchive] ⏰ Programado cada 4h (umbral: 48h de inactividad)
   ```
4. Tener disponible el número de WhatsApp del teléfono de pruebas.

---

## 📋 SECCIÓN A: Pruebas del Sprint 2.5 (Mejoras de Flujo)

### 🧪 A1: Focus en Input de Nombre (SellerActionForm)

**Objetivo**: Verificar que el vendedor puede escribir nombres completos sin perder el foco.

1. Crear una cotización vía WhatsApp hasta llegar a `ESPERANDO_VENDEDOR`.
2. Ir al Dashboard → abrir la cotización.
3. Hacer clic en **"Agregar Producto"** (+).
4. Escribir un nombre largo: `"Amortiguadores traseros Bilstein B4"`.
5. **✅ Esperado**: El texto se completa sin interrupciones, el cursor no salta ni se pierde.
6. **❌ Fallo si**: El input se cierra después de la primera letra.

---

### 🧪 A2: Rectificación de Cantidades (Merge sin Math.max)

**Objetivo**: Verificar que la cantidad del cliente prevalece al rectificar.

1. Enviar por WhatsApp: `"Necesito 4 amortiguadores delanteros para un Nissan V16 2010, patente ABCD12"`.
2. Esperar respuesta del bot (debería detectar 4 unidades).
3. Responder: `"Perdón, al final solo necesito el par, son 2"`.
4. **✅ Esperado**: En el Dashboard, la cantidad del ítem muestra **2** (no 4).
5. **❌ Fallo si**: La cantidad permanece en 4 o se incrementa.

---

### 🧪 A3: Obligatoriedad de Patente/VIN

**Objetivo**: Verificar que el bot NO avanza sin Patente o VIN.

1. Enviar: `"Hola, necesito cotizar pastillas de freno para un Toyota Corolla 2015"`.
2. El bot debería pedir la patente o VIN.
3. Responder con: `"No la tengo a mano, ¿puedo darte el dato después?"`.
4. **✅ Esperado**: El bot insiste cortésmente en obtener la patente o VIN. **NO escala a ESPERANDO_VENDEDOR**.
5. Responder con: `"Patente XYZW01"`.
6. **✅ Esperado**: El bot confirma los datos y procede a escalar al vendedor.

---

### 🧪 A4: Brevedad del Agente

**Objetivo**: Verificar que las respuestas de la IA son breves.

1. Revisar todas las respuestas del bot durante las pruebas A1-A3.
2. **✅ Esperado**: Cada mensaje es de máximo 2 líneas (sin contar emojis en línea aparte).
3. **❌ Fallo si**: El bot envía párrafos largos o bloques de texto extensos.

---

### 🧪 A5: Botón "Solicitar VIN" en Dashboard

**Objetivo**: Verificar que el vendedor puede pedir el VIN al cliente desde el Dashboard.

1. Tener una cotización en `ESPERANDO_VENDEDOR` sin VIN registrado.
2. En el Dashboard, buscar el botón **"Solicitar VIN"** debajo de un repuesto.
3. **Precondiciones**:
   - Si la cotización NO tiene Patente registrada → el botón debe estar **deshabilitado** con tooltip "Se requiere patente para solicitar VIN".
   - Si YA tiene VIN → el botón **NO aparece**.
4. Hacer clic en el botón (con patente presente).
5. **✅ Esperado**: 
   - El botón muestra "Enviando..." temporalmente.
   - Se recibe un mensaje en WhatsApp del tipo: `"Hola, para cotizar [Repuesto] necesitamos el número VIN de tu vehículo..."`.
   - Alerta de éxito en el Dashboard.

---

## 📋 SECCIÓN B: Pruebas del Sprint 3 (Ventana 24h & Archivado)

### 🧪 B1: Auto-Archivado Manual via API

**Objetivo**: Verificar que el endpoint de archivado funciona correctamente.

1. Crear una sesión de prueba (enviar un mensaje por WhatsApp para que se cree en DB).
2. Modificar manualmente el `ultimo_mensaje` de esa sesión para simular inactividad:
   ```sql
   UPDATE user_sessions 
   SET ultimo_mensaje = NOW() - INTERVAL '72 hours' 
   WHERE phone = '56912345678';
   ```
3. Ejecutar:
   ```bash
   curl -X POST http://localhost:4000/api/dashboard/auto-archive \
     -H "Content-Type: application/json" \
     -d '{"hours": 48}'
   ```
4. **✅ Esperado**:
   - Respuesta con `archived: 1` y detalle de la sesión archivada.
   - En DB: `SELECT estado FROM user_sessions WHERE phone = '56912345678'` → `'ARCHIVADO'`.
   - En tabla `pedidos`: nuevo registro con `estado_final = 'ABANDONADO'`.

---

### 🧪 B2: Auto-Archivado Automático al Iniciar

**Objetivo**: Verificar que el cron se ejecuta al iniciar el servidor.

1. Tener al menos una sesión con >48h de inactividad en estado `PERFILANDO` o `ESPERANDO_VENDEDOR`.
2. Reiniciar el backend (`npm run dev`).
3. **✅ Esperado**: Después de ~30 segundos, verás en la terminal:
   ```
   [AutoArchive] 🔍 Encontradas N sesiones inactivas. Archivando...
   [AutoArchive] 📦 56912345678 archivado (era: PERFILANDO, inactivo desde: ...)
   [AutoArchive] ✅ N sesiones archivadas exitosamente.
   ```

---

### 🧪 B3: Re-enganche — Cliente Archivado Vuelve a Escribir

**Objetivo**: Verificar el flujo de retomar cotización abandonada.

1. Tener una sesión en estado `ARCHIVADO` con repuestos guardados (usar el resultado de B1).
2. Enviar un mensaje desde ese número de WhatsApp: `"Hola, buenas tardes"`.
3. **✅ Esperado**: El bot responde:
   ```
   ¡Hola de nuevo! 👋 Veo que tenías pendiente una cotización de [repuestos] para [vehículo]. 
   ¿Te gustaría continuarla o prefieres empezar una nueva?
   ```
4. **Escenario A — Continuar**: Responder `"Sí, la misma por favor"`.
   - **✅ Esperado**: 
     - Estado cambia a `PERFILANDO`.
     - Bot: `"¡Perfecto! Retomamos tu cotización de [X]. ¿Hay algo que quieras modificar?"`.
     - Dashboard: La sesión reaparece en cotizaciones activas con los datos anteriores preservados.

5. **Escenario B — Nueva cotización**: Responder `"No, necesito otra cosa"`.
   - **✅ Esperado**: La sesión se resetea y el bot inicia el flujo de perfilamiento desde cero.

---

### 🧪 B4: Plantillas HSM (Requiere configuración previa en Meta)

> ⚠️ **Nota**: Esta prueba solo es ejecutable si las plantillas ya fueron aprobadas por Meta. Si aún no están aprobadas, saltear esta prueba y verificar que:
> 1. La función `sendTemplateMessage` existe en `whatsapp.service.js`.
> 2. En desarrollo (mock mode), el intento de enviar una plantilla muestra: `⚠️ [MOCK HSM] Plantilla NO enviada realmente...`.

**Prueba con plantilla aprobada:**

1. Configurar en `.env`:
   ```
   WHATSAPP_TEMPLATE_COTIZACION=cotizacion_lista
   ```
2. Desde el Dashboard, intentar enviar una cotización a un cliente cuyo último mensaje fue hace >24h.
3. **✅ Esperado**: Si el `sendTextMessage` falla con error de ventana cerrada, el sistema debería registrar en logs:
   ```
   ❌ [WhatsApp] VENTANA DE 24H EXPIRADA para 569...
   ```
4. El vendedor debería ver una indicación de que la ventana está cerrada.

---

### 🧪 B5: Verificación de Estabilidad General

**Objetivo**: Asegurar que los cambios no rompen el flujo standard.

1. Completar un flujo E2E completo desde cero: Cotización → Precios → Compra → Pago → Entrega.
2. **✅ Esperado**: El flujo se completa sin errores ni regresiones.
3. Verificar que el Dashboard muestra correctamente:
   - Cotizaciones activas (sin las archivadas).
   - Historial (incluyendo las archivadas con estado `ABANDONADO`).

---

## 📊 Checklist Resumen

| # | Prueba | Estado |
|---|--------|--------|
| A1 | Focus en Input | ⬜ |
| A2 | Rectificación de Cantidades | ⬜ |
| A3 | Obligatoriedad Patente/VIN | ⬜ |
| A4 | Brevedad del Agente | ⬜ |
| A5 | Botón Solicitar VIN | ⬜ |
| B1 | Auto-Archivado Manual | ⬜ |
| B2 | Auto-Archivado Automático | ⬜ |
| B3 | Re-enganche Cliente | ⬜ |
| B4 | Plantillas HSM | ⬜ |
| B5 | Estabilidad General | ✅ |

---

*Marcar ✅ al pasar, ❌ al fallar. Registrar notas adicionales abajo si es necesario.*

### Notas del Tester:
<!-- Escribe observaciones aquí -->
