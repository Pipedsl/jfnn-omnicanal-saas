# Plan de Pruebas v2: Flujo Completo & Correcciones de Feedback

Este plan permite validar que las mejoras de visibilidad, la persistencia en rectificación y el bug de los totales han sido resueltos satisfactoriamente.

---

## 📋 Escenario de Prueba: "El Cliente Detallista"

**Datos del Vehículo:**
- **Marca/Modelo:** Toyota Corolla
- **Año:** 2021
- **Patente:** ABCD-12 (o VIN inventado)
- **Repuestos:** Filtro de Aceite y Filtro de Aire.

---

## 🚀 Paso a Paso del Test

### Fase 1: Perfilamiento y Cotización (WhatsApp)
1.  **Mensaje Inicial:** Envía: *"Hola, necesito filtro de aceite y de aire para mi Toyota Corolla 2021, patente ABCD-12. Es para envío a domicilio."*
2.  **Interacción:** Responde a Gemini si pide más datos.
3.  **Dashboard:** Abre el Dashboard.
    - **Verificación:** ¿Aparece el `ID-TEMP-XXXX` en la tarjeta? ¿Dice "Pendiente" en la dirección de envío?

### Fase 2: Respuesta del Vendedor y Rectificación (Dashboard)
1.  **Responder:** Click en "Responder al Cliente".
2.  **Error Intencional:** Ingresa precios equivocados (ej: $1 para ambos) y un código Layla. Envía la respuesta.
3.  **Rectificar (CLAVE):** 
    - En la tarjeta (ahora en estado "Confirmando compra"), haz click en **"Corregir Precios / Stock"**.
    - **Verificación:** ¿Se mantienen el $1 y el código que pusiste antes? (Persistence Fix).
    - **Corrección:** Cambia los precios a valores reales (ej: $8.500 y $12.400). Pon un código Layla válido. Envía.
4.  **WhatsApp del Cliente:** Verifica que el mensaje llegue con los precios corregidos.

### Fase 3: Datos de Envío y Pago (WhatsApp)
1.  **Dirección:** Como cliente, envía: *"Mi dirección es Av. Providencia 123, Depto 405, Santiago"*.
2.  **Dashboard:** Verifica en la tarjeta si la dirección se actualizó y es visible permanentemente.
3.  **Confirmar:** Di *"Me parece bien, ¿cómo pago?"*.
4.  **Comprobante:** Envía una imagen de comprobante (puedes usar una foto cualquiera o una captura de transferencia).

### Fase 4: Verificación de Pago (Dashboard Administrador)
1.  **Navegación:** Ve a la sección **"Verificación de Pagos"**.
2.  **Detalle del Pago:** Haz click en la nueva solicitud.
3.  **Verificación (CLAVE):**
    - ¿Aparece el **Total Cotización** correcto (la suma de tus precios)?
    - ¿Aparece el **Análisis de Productos** abajo con los nombres y precios individuales? (Product Breakdown Fix).
    - ¿Es visible la **Dirección** de envío en este panel?
4.  **Acción:** Haz click en **"APROBAR PAGO"**.

### Fase 5: Notificación de Logística (Dashboard Vendedor)
1.  **Modal de Logística:** Al dar click en aprobar (o al volver a la card principal), se abrirá el panel de logística.
2.  **Selección:** Selecciona el template **"🏠 Envío"**.
3.  **Personalización:** Agrega: *"Se enviará hoy mismo antes de las 18:00 hrs"*.
4.  **Finalizar:** Dale a **"Confirmar y Notificar"**.

---

## ✅ Resultados Esperados
- [ ] El vendedor no pierde datos al rectificar precios.
- [ ] La dirección es visible antes y durante la verificación.
- [ ] El monto total en la página de verificación coincide con la suma de los productos (No más $0).
- [ ] El cliente recibe el mensaje final con su horario de despacho.

---

## 🛠️ Apéndice Técnico: Cambios Recientes (Fase 2)

Para los desarrolladores que den seguimiento a este proyecto, estos son los cambios técnicos clave implementados para resolver los problemas de la Fase 1:

### 1. Persistencia en Formulario de Respuesta (`SellerActionForm.tsx`)
- **Problema:** Los precios ingresados se borraban al intentar rectificar una cotización.
- **Solución:** Se modificó el `useEffect` de hidratación para que detecte si los `items` recibidos ya tienen `precio` o `codigo`. Ahora el formulario se inicializa con los valores existentes en la base de datos en lugar de campos vacíos.

### 2. Visibilidad e Identificación (`QuoteCard.tsx`)
- **ID de Cotización:** Se implementó una lógica de fallback: `entidades.quote_id || ID-TEMP-XXXX`. Esto asegura que siempre haya un identificador visible, incluso antes de que el vendedor asigne un folio formal.
- **Dirección de Envío:** Se desacopló la visibilidad de la dirección de su existencia en los datos. Ahora, si `metodo_entrega === 'domicilio'`, el campo es visible permanentemente. Si no hay dirección aún, muestra un aviso de "Pendiente".

### 3. Página de Verificación (`VerificacionPage.tsx` & Backend)
- **Cálculo de Totales:** Se movió la lógica de cálculo al backend (`dashboard.routes.js`) para asegurar que el `total_cotizacion` siempre sea la suma de los precios individuales de los repuestos, evitando el bug de "Total $0".
- **Transparencia:** Se agregó un desglose de productos y la dirección de despacho en el panel lateral de verificación para que el administrador tenga toda la información necesaria sin cambiar de pantalla.

### 4. Formateo Robusto de Moneda
- Se implementó una limpieza de strings en el frontend (`.replace(/[^\d]/g, "")`) antes de formatear precios. Esto evita errores visuales si Gemini o el backend devuelven precios con caracteres no numéricos o formatos inconsistentes.

