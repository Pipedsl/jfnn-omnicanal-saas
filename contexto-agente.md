# 🚀 Visión de Producto y Roadmap Estratégico
**Proyecto:** Plataforma SaaS de Atención y Ventas por WhatsApp
**MVP / Tenant 0:** Repuestos Automotrices JFNN

---

## 1. Misión del Sistema
Desarrollar una plataforma SaaS que transforme la atención de WhatsApp de un proceso manual en un motor de ventas autónomo y escalable. 

El sistema dota a cada negocio (inquilino) de un **Agente de IA especializado** en su rubro. El agente resuelve dudas, perfila clientes, gestiona cotizaciones multi-ítem, y cierra la venta (logística y pago), todo supervisado desde un Dashboard Propietario.

## 2. Fases de Evolución del Producto

El proyecto se divide en fases estratégicas para asegurar una salida rápida a producción (Speed-to-Market) y una evolución controlada hacia un modelo SaaS B2B.

### Fase 1: Cimientos y MVP (El Cotizador Automatizado)
**Objetivo:** Validar que la IA puede perfilar un cliente y entregar una cotización formal mediante intervención mixta (Humano-IA).
*   **Épica 1 - Onboarding y Arquitectura Base:** Setup de WhatsApp API, monorepo, y conexión con la API de Gemini.
*   **Épica 2 - Inteligencia Conversacional:** Creación del "Cerebro IA". El bot actúa como experto (Ej: Mecánico) y extrae entidades clave (marca, año, repuestos). Implementación de memoria de sesión para no perder el contexto.

### Fase 2: Operación, Cierre de Venta y Fidelización (El Gestor Comercial)
**Objetivo:** Proveer al vendedor de una herramienta de gestión y permitir que la IA cierre la venta de inicio a fin.
*   **Épica 3 - Dashboard Operativo:** Interfaz para que el operador humano asigne precios, gestione quiebres de stock y envíe cotizaciones formales al cliente.
*   **Épica 4 - Flujo End-to-End y Fidelización:** Evolucionar al agente a un perfil de "Closer". La interacción abarca el seguimiento del pago, selección de despacho y solicitud de reviews en Google post-venta.

### Fase 3: Visión SaaS B2B y Escalabilidad (El Motor de Replicabilidad)
**Objetivo:** Transformar el MVP en un producto comercializable (SaaS) donde nuevos clientes puedan configurar sus propios agentes sin escribir código.
*   **Épica 5 - Entrenamiento Contextual y Bases de Conocimiento:** Interfaz (futura) para inyectar "Knowledge Base" (horarios, políticas) e historial de chats reales para calibración fina de tono (Few-Shot Prompting).
*   **Épica 6 - Core SaaS No-Code:** Panel de inquilinos para cambiar el rubro del bot, cargar catálogos y visualizar métricas globales (conversión, horas ahorradas).

## 3. Directrices de Experiencia de Usuario (Agent UX)
*   **Tono Semiformal:** El bot debe sonar como un vendedor empático y resolutivo. Ni muy robótico ("He registrado su solicitud"), ni excesivamente informal. (Se usará entrenamiento con chats reales).
*   **Agilidad:** Prompts optimizados para respuestas cortas y directas. Uso de delays simulados ("Escribiendo...") para sentirse natural.
*   **Manejo de Frustración:** Si el bot no entiende o el cliente requiere ayuda especial, derivación fluida al humano sin cortar el contexto.

## 4. Análisis de Costos y Rentabilidad

| Concepto | Tecnología Sugerida | Costo Mensual Estimado |
| :--- | :--- | :--- |
| **Mensajería** | WhatsApp Cloud API (Meta) | Gratis (dentro de ventana 24h). |
| **Cerebro IA** | Google Gemini API | ~$10 - $20 USD (Uso dinámico Flash/Flash-Lite). |
| **Base de Datos** | Supabase (PostgreSQL) | ~$25 USD (Incluye Vectores AI). |
| **Dashboard** | Hosting Vercel/VPS | ~$15 USD. |
| **TOTAL ESTIMADO** | | **~$50 - $60 USD / mes** |

> *Un costo operativo marginal comparado con la recuperación de leads que hoy se pierden por saturación del canal manual.*