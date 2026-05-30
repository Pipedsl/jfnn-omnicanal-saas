# Plan de implementación — Llamadas por WhatsApp en JFNN

**Estado:** Borrador para decisión del CTO
**Última actualización:** 30 may 2026

---

## 1. Contexto

Muchos clientes de Repuestos JFNN — sobre todo el segmento "tradicional" (mecánicos
mayores, dueños de talleres pequeños) — están **acostumbrados a LLAMAR** antes que
chatear. Hoy el flujo omnicanal está construido 100% sobre **chat** (bot IA + cotización
del vendedor desde dashboard), porque el número productivo está en **WhatsApp Cloud API**
(no en la app móvil).

La limitación técnica clave:

> **Un número en Cloud API no puede usarse en WhatsApp Business app al mismo tiempo.**
> No se puede contestar una llamada de WhatsApp en un celular físico sin un intermediario.

Por lo tanto, no existe forma "directa" de contestar llamadas de WhatsApp con el número
actual en un teléfono físico estándar. Hay 3 caminos alternativos.

---

## 2. Opciones evaluadas

### Opción 1 — Teléfono fijo del local 📞 (sin infraestructura adicional)
- Promocionar el **teléfono fijo de la tienda** como número de llamadas.
- WhatsApp queda para chat (bot + vendedores).
- Publicidad/web/Google Business: 2 contactos:
  - 💬 WhatsApp chat: +56 9 5955 6843
  - 📞 Llamadas: 02 XXX XXXX (fijo del local)
- **Costo:** 0.
- **Pros:** cero cambio técnico, usa lo que ya existe.
- **Contras:** el cliente no marca "el botón verde" de WhatsApp; tiene que recordar el
  fijo.

### Opción 2 — Segundo celular con WhatsApp Business app 📱
- Chip nuevo (~$3.000 una vez) + un celular usado.
- Se instala **WhatsApp Business app** (gratis, no Cloud API).
- Ese número SÍ recibe llamadas WhatsApp en el celular físico.
- En el local: 2 contactos:
  - 💬 WhatsApp chat (bot): +56 9 5955 6843
  - 📞 WhatsApp llamadas (humano): +56 9 YYY YYY
- **Costo:** ~$3.000 una vez + plan SIM básico ~$5.000/mes.
- **Pros:** el cliente sigue dentro del ecosistema WhatsApp; "el botón verde" funciona.
- **Contras:** dos números separados (puede confundir al cliente nuevo).

### Opción 3 — Auto-respuesta inteligente (sobre el número actual) 🤖
- Activar el toggle "Permitir llamadas de voz" en Meta.
- Cliente marca llamada → suena → no contesta (sin infra de audio).
- Backend recibe webhook `call_terminated` y **auto-responde por WhatsApp** con el
  agente IA: *"¡Hola! Vimos tu llamada, contanos qué repuesto buscas y te cotizamos…"*.
- Convierte la INTENCIÓN de llamar en chat sin perder al cliente.
- **Costo:** 0 (solo desarrollo).
- **Pros:** el cliente presiona el botón verde y recibe respuesta inmediata; cero infra
  extra; queda registrada en `mensajes` la llamada perdida para trazabilidad.
- **Contras:** el cliente que SOLO quiere voz se siente frustrado al recibir texto.

### Opción 4 (descartada hoy) — Integración SIP/Twilio
- Permite contestar la llamada en una softphone real.
- **Costo:** $30–80 USD/mes + 1–2 semanas de desarrollo.
- **Descartada** salvo que el volumen justifique (>30 llamadas/día reales).

---

## 3. Recomendación

**Combinar Opción 1 + Opción 3** (sin costo extra).

- Si JFNN tiene fijo en la tienda → publicarlo en TODOS los canales (web, Google Business,
  Instagram, plantillas HSM del bot). Atiende al cliente "telefónico puro".
- Implementar el flujo **Opción 3** en backend → captura las llamadas que se hagan al
  número de WhatsApp y las reconduce al chat con el agente IA.

Si más adelante el volumen aumenta y los vendedores piden contestar de verdad → migrar a
Opción 4.

---

## 4. Plan de implementación (Opción 3 — auto-respuesta inteligente)

### Fase A — Configuración en Meta (sin código)

1. Meta Business Manager → WhatsApp Manager → Números → **+56 9 5955 6843** →
   Configuración de llamadas.
2. **Activar "Permitir llamadas de voz"** (toggle gris arriba).
3. **Activar "Permitir devolución de llamadas"** (callback).
4. **Configurar horario de llamadas**: L-V 9:00–13:45 / 15:00–18:00 · Sáb 9:30–13:00 ·
   Dom y feriados cerrado.
5. **Detener temporalmente** ya configurado en feriados especiales (manual).
6. **Suscribirse al webhook** `calls` (en la App Meta → Webhooks → WhatsApp Business
   Account → suscribir field `calls`).

### Fase B — Backend (Node.js, ~3-4 horas dev)

#### B1. Webhook handler
`whatsapp.controller.js` → agregar manejo del evento `calls` en `receiveMessage`:
```js
const callEvent = value?.calls?.[0];
if (callEvent) {
    return handleCallEvent(callEvent, customerPhone, res);
}
```

#### B2. Función `handleCallEvent(call, phone, res)`
- Detectar evento: `call.status` puede ser `RINGING`, `CONNECTED`, `TERMINATED`.
- Si `TERMINATED` con `reason` ∈ `['NO_ANSWER','BUSY','MISSED','UNAVAILABLE']`:
  - **Persistir** en `mensajes` con `tipo='call_missed'`, contenido `"Llamada perdida (HH:mm)"`.
  - Determinar estado de horario con `scheduleService.getEstadoAtencion()`.
  - **Si en horario**: enviar mensaje de la IA *"¡Hola! Vimos que llamaste. Estamos en
    chat — contanos qué repuesto buscas y te cotizamos en minutos 🙌"* (con
    `sendAgentMessage`, persistir como `agente_ia`).
  - **Si fuera de horario**: enviar `estadoAtencion.mensaje` (mismo que el determinista
    actual).
  - Si la sesión no existe aún → crearla con `getSession()` (la crea automáticamente).
- Si `CONNECTED`: log info (futuro: integración con softphone).
- Responder `200 EVENT_RECEIVED` rápido (igual que mensajes).

#### B3. Idempotencia
- Cada evento `calls` trae un `id`. Dedupe similar a `wa_message_id` (ignorar si ya está
  registrado en `mensajes`).

### Fase C — Frontend (dashboard, ~1-2 horas dev)

#### C1. Nuevo tipo de mensaje en el chat
`ConversacionesPanel.tsx`: agregar render para `tipo='call_missed'`:
```
📞 Llamada perdida — HH:mm
```
Estilo: ícono de teléfono en rojo/ámbar; centrado en el chat (visualmente distinto a
mensajes normales).

#### C2. Badge en la lista de conversaciones
- Si la última actividad fue una `call_missed`, marcar con ícono 📞 en la lista de
  bandeja para que el vendedor lo vea de un vistazo.

#### C3. (Opcional, futuro) Botón "Devolver llamada vía WhatsApp"
- En el chat, un botón que dispare la API de **Click-to-call de WhatsApp Business**
  (callback). Esto requiere la API de callbacks de Meta — pendiente de validar
  disponibilidad.

### Fase D — Mensajes contextuales (UX)

#### D1. Mensaje en horario
> "👋 ¡Hola! Acabamos de ver tu llamada. Estamos en chat — contanos qué repuesto buscas
> y te cotizamos al tiro. Si prefieres llamar, atendemos al **02 XXX XXXX** (si tienen
> fijo), L-V 9:00–18:00."

#### D2. Mensaje fuera de horario
Reutilizar `estadoAtencion.mensaje` ya existente (Capa 1 determinista, ya implementada).

#### D3. Plantillas HSM (>24h)
- Si la ventana de 24h está cerrada y un cliente llama → no podemos responder con texto
  libre.
- Usar la plantilla `retomar_cotizacion` (ya aprobada en Meta) como auto-respuesta.

---

## 5. Métricas a medir post-implementación

- **% de llamadas que se convierten en chat** (cliente respondió al auto-mensaje).
- **Llamadas perdidas por día** y horario más cargado.
- **Distribución día/hora** de llamadas (para decidir si invertir en Opción 4 a futuro).

Estas métricas se agregan al dashboard de soporte/admin.

---

## 6. Cronograma sugerido

| Fase | Esfuerzo | Quién |
|---|---|---|
| A — Meta config | 15 min | CTO en consola Meta |
| B — Backend webhook | 3-4h | Felipe (dev) |
| C — Frontend chat | 1-2h | Felipe (dev) |
| D — Mensajes y pruebas | 1h | Felipe + revisión CTO |
| **Total** | **~1 día** | |

---

## 7. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Cliente espera VOZ real, recibe texto → frustración | Mensaje cálido + opción del fijo si existe |
| Volumen alto de llamadas perdidas | Métricas en dashboard; si supera umbral → migrar a Opción 4 (SIP) |
| Auto-respuesta fuera de ventana 24h falla | Usar plantilla HSM aprobada (`retomar_cotizacion`) |
| Llamada en horario nocturno (madrugada) | Mensaje "fuera de horario" (Capa 1 ya implementada) |

---

## 8. Decisión pendiente del CTO

- [ ] ¿JFNN tiene teléfono fijo en sucursal Melipilla? (Si sí → publicar Opción 1)
- [ ] ¿Activamos la Opción 3 (auto-respuesta) ahora?
- [ ] ¿Volumen esperado de llamadas? (define si proyectar Opción 4 a futuro)

Tras la decisión, se ejecuta Fase A→D según cronograma.
