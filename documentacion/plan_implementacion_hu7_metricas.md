# Plan de Implementación: Entrenador IA (HU-7) y Módulo de Métricas (P0)

## Objetivos
Finalizar el Sprint con la implementación de las siguientes funcionalidades clave, siguiendo las directrices del Arquitecto Lead @arquitecto.lead:

1. **Módulo Analítico del Negocio (P0)**: Un panel visual en el Dashboard (DashboardMetrics) para medir ingresos, conversiones, tiempos de inactividad de la bandeja y métricas en tiempo real.
2. **Entrenador de IA con WhatsApp (HU-7) (P2)**: Una sección en la pantalla de "Ajustes" para cargar historiales de chats (TXT o Copy/Paste) y que Gemini aprenda las reglas de negocio, tono de conversación corporativa, precios históricos, actualizando su System Prompt en tiempo real.

---

## 1. Módulo Analítico del Negocio (Métricas)

### Backend (Node.js)
- **Endpoint Analítico**: `GET /api/dashboard/metrics` (en `dashboard.routes.js`).
- **Servicio de Datos**: Extensión de `sessions.service.js` con método `getDashboardMetrics()`.
- **Lógica SQL**:
  - `Ventas Hoy`: Sumatoria del campo `total_cotizacion` de las cotizaciones cuyo `estado_final` = `ENTREGADO` y que hayan sido archivadas hoy.
  - `Sesiones Activas (Live)`: Conteo actual global de registros en `user_sessions`.
  - `Tiempo Promedio de Espera`: Promedio de los extractos temporal entre `NOW()` y el `ultimo_mensaje` de sesiones con estado `ESPERANDO_VENDEDOR`. Ayuda al administrador a ver cuellos de botella por falta de precios.
  - `Tasa de Conversión`: (Pedidos Completados Hoy / Total Iniciados Hoy) expresado en porcentaje.

### Frontend (Next.js)
- **Componente**: `DashboardMetrics.tsx`.
- **Ubicación**: Se embebe antes del listado central de cotizaciones en `app/page.tsx` para generar impacto visual inmediato.
- **Diseño GUI**: KPI Cards (6 paneles) en grilla responsiva 3x2, usando `glassmorphism`, tipografía oscura/premium, micro texturas e iconos vectoriales (`lucide-react`) asignando un color para cada métrica (Verde/Dinero, Azul/Efectividad, etc).

---

## 2. Entrenador de IA vía Historial WhatsApp (HU-7)

### Backend (Node.js/Express)
- **Persistencia de Reglas**: 
  - Almacenar las directrices extraídas temporalmente en un archivo de sistema (ej. `knowledge-base.json`) para inicializaciones rápidas sin alterar severamente el esquema de base de datos SQL actual.
- **Servicio Gemini (`gemini.service.js`)**:
  - Añadir la función `trainAgentWithHistory(text)` utilizando Vertex/Gemini Flash de forma síncrona/streaming.
  - Generar un _Prompt de Meta-Inferencia_ (Prompting the model to write prompts). Instruiremos a Gemini: *"Como analista, lee esta conversación entre humano-cliente. Genera un arreglo de reglas de conducta para un LLM, detecta tono semántico, y extrae los precios unitarios detectados"*
- **Inyección Contextual**: 
  - Todo mensaje del prompt principal del bot en `handleWhatsappMessage` ahora importará el json del knowledge-base y añadirá: `[REGLAS HISTÓRICAS APRENDIDAS]: {reglas}`

### Frontend (Next.js)
- **Ruta de Interfaz**: `app/settings/page.tsx` (Sección "Brain / Entrenamiento").
- **UI Formulario de Carga**: 
  - Área "Drag & Drop" expansiva para inyectar logs .txt
  - Un Textarea ancho para `Paste Logs` directo.
  - Indicadores Loader de conexión asíncrona ("El Agente Gemini está leyendo tus chats...").
- **Sección de Inspección Cerebral**:
  - Un listado estilo "Chip" / "Reglas" debajo, detallando lo que el agente acaba de aprender (Ej. _Regla 1: Las bujías se cobran siempre a $5000_). Unidades y reglas borrables.

---

## Estrategia de Verificación y Testing

**Para Metricas (P0):**
1. Recargar el dashboard en vista por defecto. Comprobar que los KPIs no son "Nan" ni emiten errores React al cargar (se solucionó pre-formateando el parser con int validos).
2. Avanzar el ciclo de una cotización de "DUMMY" hasta "ENTREGADO". Click en "Archivar". Se deberá incrementar automáticamente "+1 Venta" en las métricas.

**Para Entrenador (P2):**
1. Cargar una conversación estructurada (ejemplo ficticio donde le damos precios enrevesados).
2. Validar que la card en Settings levante las "Reglas Estrictas" exitosamente.
3. Abordar el webhook desde otro celular (cliente nuevo), ver si la máquina obedece las recién inferidas normas (Testing Caja Negra en flujo Whatsapp natural).
