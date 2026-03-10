# Mapa de Arquitectura: JFNN Omnicanal SaaS

Este documento explica de forma profesional la relación entre los principales componentes del sistema y el flujo general de datos desde el usuario hasta los vendedores, estructurado en torno al ecosistema de Node.js (Backend), Next.js (Dashboard Frontend) y la integración de IA.

## Diagrama de Componentes de Alto Nivel

```mermaid
flowchart TD
    %% Entidades Externas
    C[Cliente WhatsApp] <-->|Mensajes/Audio/Imágenes| W[Gateway de WhatsApp\nEj. Baileys / WWebJS]
    V[Vendedor] <-->|Panel de Control HTTP/WS| UI[Dashboard (Next.js)]
   
    %% Backend Node.js
    subgraph Backend [Backend Central (Node.js)]
        W <--> WH[Controlador/Webhook\nWhatsApp]
        WH <--> SM[Manejador de Estados\nsessions.service.js]
        WH <--> AI[Motor de IA\ngemini.service.js]
        
        API[Rutas API REST\nroutes/dashboard.routes.js] <--> SM
    end

    %% Frontend Next.js
    subgraph Frontend [Frontend Dashboard (Next.js)]
        UI <--> |React Server Components / Fetch| API_CLIENT[Servicios API Frontend]
        API_CLIENT <--> API
    end

    %% Base de Datos (Supabase)
    DB[(Supabase PostgreSQL)]
    SM <-->|Lectura/Escritura Sesiones| DB
    API <-->|Consulta Historial/Pendientes| DB

    %% Servicios Externos IA
    AI <-->|Llamadas API| LLM(Google Gemini Pro/Flash)
```

## Relación Backend y Frontend

El sistema está dividido en dos grandes bloques que se comunican mediante servicios REST (y posiblemente WebSockets para actualizaciones en tiempo real).

### 1. El Backend Central (Node.js)
Actúa como el cerebro operativo de la empresa:
- **Puertos de Entrada:** Recibe mensajes desde WhatsApp a través de su integración (usualmente usando un cliente tipo Baileys).
- **Orquestación y Estado (`sessions.service.js`):** Gestiona el estado conversacional mediante una Máquina de Estados finita persistida en **Supabase**. Las sesiones transicionan desde el perfilamiento del cliente hasta el cierre y post-venta (`PERFILANDO` 👉 `CONFIRMANDO_COMPRA` 👉 `CICLO_COMPLETO`).
- **Lógica de Negocio y Clasificación (`gemini.service.js`):** Interviene los mensajes entrantes, extrae entidades (marca, modelo, repuestos solicitados) y devuelve respuestas con formato estructurado. Posee lógica para escalar a un modelo más capaz (Gemini Pro) cuando la inferencia requiere diagnóstico o decisiones complejas, o usar un modelo más rápido (Flash) para consultas estándar.
- **APIs del Dashboard:** Expone rutas (ej. en `routes/dashboard.routes.js`) para que el frontend pueda consultar las cotizaciones activas, historiales y permitir al vendedor intervenir en la conversación o actualizar estados manualmente.

### 2. El Frontend Dashboard (Next.js)
Es la interfaz para el personal (vendedores/administradores) de la empresa:
- Se conecta con el Backend a través de endpoints REST.
- Permite la visualización de las conversaciones que se encuentran en estados clave (ej. `ESPERANDO_VENDEDOR`).
- Facilita la carga de precios, generación de cotizaciones y revisión de comprobantes de pago.
- Impacta de regreso al Backend, forzando transiciones en la máquina de estados, para que posteriormente el Agente IA de WhatsApp retome el control o envíe mensajes transaccionales (como la entrega de cotizaciones).

## Flujo End-to-End (Contexto Sprint 6)

1. **Ingreso y Perfilamiento:** El usuario escribe en WhatsApp. El Backend detecta la sesión. Si es nueva, la inicia (`PERFILANDO`). La IA (Gemini) responde intentando capturar la marca, año de vehículo y el repuesto exacto solicitado.
2. **Escalamiento al Dashboard:** Cuando la IA obtiene la información necesaria, cambia la sesión a estado `ESPERANDO_VENDEDOR` y detiene momentáneamente el agente automático.
3. **Gestión del Vendedor:** En el Dashboard (Next.js), la cotización aparece disponible. El vendedor ajusta precios, marca disponibilidad y aprueba la cotización.
4. **Bucle de Cierre:** El Backend notifica al cliente que la cotización está lista. El cliente y el agente IA entran al estado `CONFIRMANDO_COMPRA`. La IA pide métodos de pago y despacho, recibiendo (si correponde) comprobantes de depósito.
5. **Aprobación de Venta:** El vendedor verifica el ingreso en el Dashboard y la logística (o retiro) de la pieza, llevando finalmente la sesión a `PAGO_VERIFICADO` o `ENTREGADO`.
