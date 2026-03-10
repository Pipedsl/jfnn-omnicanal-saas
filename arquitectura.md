# 🏗️ Arquitectura Técnica y Flujo de Trabajo
**Proyecto:** JFNN Omnicanal SaaS | **Rol:** Blueprint Técnico

---

## 1. Stack Tecnológico General
*   **Backend:** Node.js, Express, Integración Meta Graph API (WhatsApp).
*   **Frontend (Dashboard):** Next.js (App Router), TailwindCSS, TypeScript.
*   **Inteligencia Artificial:** Google Gemini SDK (`gemini-3.1-flash-lite`, `gemini-2.5-flash`).
*   **Base de Datos:** PostgreSQL (vía Supabase).

## 2. Flujo Lógico y Máquina de Estados (El Bucle E2E)
El ciclo de vida de un lead se maneja bajo estrictos estados de sesión (ej. `sessions.service.js`):

1.  **PERFILANDO**: Bot hace preguntas diagnóstico/técnicas y extrae requerimientos.
2.  **ESPERANDO_VENDEDOR**: Bot pausa. Dashboard levanta alerta. Humano ingresa precios, disponibilidad (stock/encargo).
3.  **COTIZADO**: Backend dispara cotización formal en texto hacia WhatsApp.
4.  **CONFIRMANDO_COMPRA**: Bot retoma control. Resuelve dudas finales (FAQs), acuerda despacho y método de pago.
5.  **PAGO_VERIFICADO**: Dashboard marca el ingreso del dinero (transferencia validada por IA o efectivo).
6.  **ENTREGADO / CICLO_COMPLETO**: Producto retirado/enviado. Bot manda link solicitando Reseña en Google.

## 3. Estrategia de IA: Calibración, Contexto y Modelos

### 3.1 Inyección de Conocimiento (RAG Local)
*   **Knowledge Base (Reglas Duras):** Archivo/Configuración `knowledge-base.md` con horarios, sucursales y políticas. Evita alucinaciones del bot sobre la empresa.
*   **Few-Shot Prompting (Tono Semiformal):** Ingesta de chats reales de vendedores (extraídos en `/whatsapp/`) para calibrar temperatura y empatía en las respuestas del Agente.

### 3.2 Selección Dinámica de Modelos (Cost-Efficiency)
Para garantizar rapidez y bajo costo (~$10-20/mes), el backend cambia el modelo en tiempo real:
*   Enrutamiento de texto simple (Perfilamiento/Cierre) ➔ `gemini-3.1-flash-lite-preview` (Rápido, económico).
*   Procesamiento Multimodal (Análisis de repuestos rotos o comprobantes) ➔ `gemini-2.5-flash` (Visión avanzada).

### 3.3 Soporte Multimodal (Manejo de Imágenes)
El webhook detecta `message.type === 'image'`. Se descargan del servidor de WhatsApp y se envían a Gemini Flash para:
1. Identificar piezas dañadas enviadas por el cliente.
2. Leer montos y confirmaciones de comprobantes de transferencia bancaria.

## 4. Diagnóstico y Estado Actual de Desarrollo

### ✅ Lo que ya está construido (Fase 1 y 2 Parcial)
*   Integración bidireccional WhatsApp ↔ Backend.
*   Orquestador de Prompting, extracción de JSON (entidades) y máquina de estados volátil (RAM).
*   Dashboard Básico: Grilla de Cotizaciones, formulario de respuesta humana (precios, stock).
*   Manejo de sub-estados para quiebres de stock.

### 🔴 Sprint Actual: Flujo End-to-End y Base de Conocimiento (SPRINT 6)
*   **Inyección de Conocimiento:** Crear `knowledge-base.md` (FAQs) y preparar inyección **Few-Shot** usando los chats reales como guía de estilo Semiformal.
*   **Bucle de Cierre:** Ampliar la lógica del estado `CONFIRMANDO_COMPRA` en `gemini.service.js` para que el agente negocie pago, envío o retiro sin perder el hilo. Capturar intención de compra real.
*   **Feedback Loops:** Modificar el endpoint de cambio de estados para inyectar un mensaje de Petición de Reseñas de Google al cerrar exitosamente el ciclo.

### 🟡 Próximos Sprints Técnicos (Pendientes)
*   **Persistencia Real:** Migrar el estado de sesión y el historial de cotizaciones de la memoria RAM a tablas relacionales en **PostgreSQL (Supabase)**.
*   **Comprobantes:** Extracción final del Flow Multimodal para transferencias de pago.
