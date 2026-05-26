# Backlog de Proyecto: JFNN Omnicanal SaaS

Este backlog ha sido actualizado para reflejar el estado actual del proyecto tras el cierre del Sprint B (Workflow Por Encargo) y las validaciones E2E. Está estructurado para que el CTO pueda tomar decisiones de priorización.

---

## 🔴 Prioridad 0: Crítico / Bloqueantes (Para ejecución inmediata)

### [META-VERIF] Activar WhatsApp Business API — ✅ RESUELTO (canal activo sin verificación)
- **Estado:** ✅ **WhatsApp Cloud API operativo desde el 18 mayo 2026** en modo Live (tier Limited Access), **sin necesidad de Business Verification**.
- **Cómo:** Se ejecutó la Opción A del Plan B. Canal validado end-to-end con número de prueba (`+56 9 5082 8842`).
- **Contexto completo:** `docs/PLAN_OPCION_A_EJECUCION.md` (incluye datos de integración) + `docs/PLAN_B_META_RECHAZO.md`
- **Verificación de Meta:** sigue en revisión, pero **ya NO es bloqueante** — el negocio puede operar indefinidamente sin ella. El flujo customer-initiated de JFNN no toca el límite de 250 conv./24h.
- **Pendiente futuro (NO urgente):**
  1. Cuando Meta apruebe la verificación → migrar el **número productivo** de JFNN al canal (mismo flujo OTP, backup de chats antes, cambiar `WHATSAPP_PHONE_ID` en Railway).
  2. Auditar y limpiar las 4 WABAs duplicadas en el Business Manager.
  3. Configurar `META_APP_SECRET` en Railway (validación de firma del webhook — hoy en modo dev permisivo).

### [BUG-POST10] Botón "Abono Pagado en Local"
- **Objetivo:** Permitir al vendedor desestancar el flujo si el cliente decide pagar el abono en efectivo en la sucursal física.
- **Contexto:** Actualmente el sistema exige transferencia para el abono en flujo `POR_ENCARGO`. Si el cliente va a la tienda, el vendedor no tiene botón para avanzar el estado (gemelo de BUG-POST07 que ya se resolvió para el saldo).
- **Esfuerzo:** ~2 horas (Requiere endpoint + botón en UI).

---

## 🟡 Prioridad 1: Importante / Costos y Operación

### [REQ-07] Optimización de Tokens IA (Reducción de Costos)
- **Objetivo:** Reducir el consumo de tokens de Gemini para hacer el SaaS viable económicamente.
- **Tareas:**
    - **REQ-07.G:** Instrumentar métricas de tokens (Saber cuánto gastamos por sesión).
    - **REQ-07.E:** Auditar routing Flash/Pro (Puede recortar 50-60% del costo usando más Flash).
    - **REQ-07.C:** Prompt slimming (Recortar instrucciones redundantes).
    - **REQ-07.A:** Implementar Context Caching de Gemini.
- **Impacto:** Alto en la factura de Google Cloud.

### [REQ-03] Reporte de Comisiones por Vendedor
- **Objetivo:** Interfaz para que el admin vea cuántas ventas cerró cada vendedor.
- **Contexto:** Ya se guarda el `vendedor_nombre` en las sesiones y pedidos (gracias al multi-sucursal), falta el reporte en el dashboard.
- **Esfuerzo:** Medio.

### [REQ-08] Cliente Memory + Auto-derivación de Sucursal
- **Objetivo:** Que el sistema recuerde al cliente recurrente (vehículo, sucursal preferida) para no volver a preguntarle todo.
- **Impacto:** Alta mejora en UX.

### [REQ-09] Mejoras de Responsive y Accesibilidad (Mobile/Tablet) [COMPLETADO]
- **Objetivo:** Asegurar que los vendedores puedan trabajar cómodamente desde cualquier dispositivo (Teléfono, Tablet, Desktop).
- **Tareas:**
    - **Aumento de Tamaño de Tipografía:** Ajustar tamaños de fuente que están muy pequeños en el dashboard.
    - **Responsive Mobile:** Optimizar la interfaz para que los vendedores puedan trabajar en el teléfono igual.
    - **Responsive Tablet:** Asegurar que se vea bien en tablets y todos los tamaños posibles.
- **Impacto:** Alto para la adopción de la herramienta por parte de los vendedores.

---

## 🟢 Prioridad 2: Deseable / Deuda Técnica y UI

### [REQ-01] Métricas Mes/Año en `/admin/estadisticas`
- **Objetivo:** Dashboard visual de ventas y conversión.

### Fixes Menores de UI y Prompts (Mini-Sprint C sugerido)
- **[BUG-POST11]** Modal "Verificar Comprobante" no responsive (botón RECHAZAR se corta).
- **[BUG-POST08]** Firma de cotización usa "Asesor JFNN" en vez del nombre real del vendedor (Sergio, Feña, Kano).
- **[BUG-POST09]** Datos bancarios con abreviaturas confusas (Quitar "Cta. Cte." o formatear mejor).
- **[BUG-POST12]** Agente pregunta "¿te envío datos bancarios?" en vez de enviarlos directamente.

### [REQ-04] Conversaciones en Tiempo Real — ✅ COMPLETADO
- **Estado:** Implementado y desplegado (Fases 1-8 + auditoría OWASP).
- **Incluye:** Persistencia de mensajes, Supabase Storage, chat en vivo, respuesta libre vendedor, plantillas HSM, ventana 24h, nueva conversación.

### [REQ-10] Gestión de Perfil de Tienda desde Dashboard
- **Objetivo:** Que el admin/tenant pueda editar la información de su tienda directamente desde el dashboard, sin necesidad de usar la API de Meta manualmente. Los cambios se reflejan en el perfil de WhatsApp Business que ven los clientes.
- **Datos editables:**
    - Nombre del negocio
    - Descripción / "Acerca de"
    - Dirección del local
    - Horario de atención
    - Email de contacto
    - Sitio web
    - Foto de perfil / logo
    - Categoría del negocio (vertical)
- **Implementación:**
    - Backend: endpoint `GET/POST /api/dashboard/perfil-tienda` que wrappea la API de WhatsApp Business Profile (`/{PHONE_ID}/whatsapp_business_profile`)
    - Frontend: sección en Settings del dashboard con formulario editable + preview de cómo se ve en WhatsApp
    - Upload de foto de perfil via Resumable Upload API de Meta
- **Contexto técnico:** La API de Meta ya soporta todos estos campos (ver `docs/PLAN_IMPLEMENTACION_MELIPILLA.md` Fase 5). Hoy se configuran via curl.
- **Esfuerzo:** Medio (~4-6 horas).
- **Impacto:** Alto para autonomía del tenant — no depende del desarrollador para cambiar horarios o dirección.
