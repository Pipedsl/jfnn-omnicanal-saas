# Plan B — Meta rechaza la verificación de negocio

**Autor:** CTO
**Fecha:** 2026-05-18
**Estado:** Documento estratégico — pendiente decisión Felipe
**Contexto:** Verificación de Meta para COMERCIAL E INDUSTRIAL JFNN SPA (RUT 77.073.837-7) enviada el 11-may-2026, en revisión. Si es rechazada, este documento define las rutas alternativas.

---

## 1. Resumen ejecutivo

**Si Meta rechaza, no es game over.** Desde 2025 Meta introdujo un nivel de **Limited Access** en Cloud API que permite operar **sin Business Verification** hasta **250 conversaciones únicas en 24 hs** y **2 números** por WABA. Para el volumen actual de JFNN (estimado <2000 conversaciones/mes, ~65/día), **esto cubre el 100% de las necesidades**. Recomendación: onboarding vía **Embedded Signup con un BSP Tech Provider (360dialog o Twilio)**, mantener el número actual migrándolo oficialmente, y posponer Business Verification a un sprint posterior cuando el volumen lo justifique. Costo estimado: **USD ~60–90/mes** + per-message (~USD 5–15/mes a este volumen). El backend actual sirve sin reescribir; solo cambian credenciales `.env`.

---

## 2. Opciones viables

### Opción A — Cloud API directa de Meta en modo "Limited Access" (sin verificación)

**Descripción técnica:** Meta permite conectar Cloud API directamente sin pasar Business Verification, con tier "Limited Access": 250 conversaciones únicas iniciadas por negocio cada 24 hs + máximo 2 números por WABA. Mensajes entrantes (service window) no cuentan al límite. JFNN inicia ~30 conversaciones/día → margen amplísimo.

**¿Mantiene el número actual?** Sí. Hay que **borrar la cuenta de WhatsApp Business app del número** antes de migrarlo a API (excepto si Chile entra en programa de coexistencia, que hoy NO está habilitado para Chile). Backup de chats local primero.

**¿1 número o 2 sucursales?** Para JFNN recomiendo **mantener 1 número compartido** (status quo) por dos razones:
- (a) El backend hoy asume 1 número → 0 refactor.
- (b) Cambiar números obliga a re-educar clientes que ya tienen el número guardado.
- Si en el futuro se quiere 1 número por sucursal: Cloud API soporta hasta 2 números por WABA en modo Limited (perfecto: Melipilla + San Felipe) — pero requiere ruteo en backend (header `phone_number_id` del webhook → derivar sucursal). Estimación: 1 día de dev + tests.

**¿Sirve el código actual?** Sí, sin reescribir. `backend/services/whatsapp.service.js` ya está hecho para Cloud API. Solo setear `WHATSAPP_PHONE_NUMBER_ID` y `WHATSAPP_TOKEN` en Railway.

**Pasos:**
1. Backup de chats WhatsApp Business app del número actual.
2. Crear app en Meta for Developers → WhatsApp product.
3. Crear WABA bajo cuenta Meta de Felipe (sin Business Verification — Limited Access se concede auto).
4. Enviar OTP al número actual → desactiva WhatsApp Business app automáticamente al confirmar.
5. Generar token permanente (System User token).
6. Setear `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TOKEN`, `WHATSAPP_VERIFY_TOKEN` en Railway env.
7. Configurar webhook URL en Meta apuntando a Railway: `https://<backend>/api/whatsapp/webhook`.
8. Probar con número de prueba antes de cortar app oficial.
9. Validar end-to-end (Gemini, dashboard, cotización, POR_ENCARGO).

**Precios 2026 (Chile, vía Meta directa):**
- Setup: **USD 0** (Cloud API es gratis).
- Mensual fijo: **USD 0** (Meta no cobra suscripción).
- Per-message: Marketing ~**USD 0.07–0.10** / Utility **USD 0.01–0.03** / Service (respuestas dentro de ventana 24h iniciada por cliente) **GRATIS**. Como JFNN siempre responde a clientes que escribieron primero → casi todo cae en service window → **~USD 0–5/mes** estimado.
- Hosting webhook: ya en Railway.

**Pros:** Gratis. Sin BSP intermediario. Service window cubre el 99% de los mensajes JFNN.
**Contras:** Onboarding técnico más manual (no hay Embedded Signup directo sin BSP). Si volumen sube >250/día hay que verificar igual.
**Tiempo activación:** 2–4 horas si todo sale bien.

---

### Opción B — BSP con Embedded Signup (360dialog)

**Descripción técnica:** 360dialog actúa como Tech Provider. El onboarding ocurre dentro de un flujo embebido — no requiere que JFNN tenga Business Verification propia para arrancar. Provee API compatible con Cloud API (drop-in).

**¿Mantiene número actual?** Sí, mismo procedimiento de migración OTP.
**¿1 o 2 números?** 360dialog cobra por número (channel fee). Con 1 número compartido sale más barato. Recomiendo 1 número.
**¿Sirve código actual?** Sí. 360dialog tiene API compatible con Cloud API + opción de pasar directo a Cloud API (relay). Cero refactor.

**Pasos:**
1. Registrarse en hub.360dialog.com.
2. Iniciar Embedded Signup → seleccionar Meta Business Manager existente (o crear nuevo).
3. Verificar número vía OTP (mismo proceso, borra WhatsApp app primero).
4. 360dialog provee `D360-API-KEY` → reemplaza token Meta en `whatsapp.service.js` (cambiar base URL a `waba-v2.360dialog.io`).
5. Webhook URL configurada en hub 360dialog (no en Meta directo).
6. Tests E2E.

**Precios 2026:**
- Setup: **USD 0**.
- Mensual: **EUR 49 (~USD 53 / ~CLP 50.000)** por número.
- Per-message: Meta fee pass-through sin markup (ventaja clave vs Twilio/Wati).
- Total estimado JFNN: **USD ~55/mes**.

**Pros:** Onboarding fácil (Embedded Signup), soporte en español, no requiere Business Verification para arrancar, sin markup por mensaje. Es el BSP más recomendado para PYMEs LATAM.
**Contras:** Pago en EUR (variable cambio). Soporte por email/Slack, no teléfono.
**Tiempo activación:** 1–3 días (verificación de cuenta 360dialog + OTP).

---

### Opción C — BSP con Embedded Signup (Twilio)

**Descripción técnica:** Twilio Tech Provider Program — onboarding embebido sin requerir Business Verification de JFNN. Conocido, infraestructura robusta, presencia oficial en LATAM.

**¿Mantiene número?** Sí.
**¿1 o 2 números?** Twilio cobra por mensaje, no fee por número → cualquiera escala bien. Recomiendo 1.
**¿Sirve código?** Sí, pero requiere **adaptador**: Twilio usa su propio SDK (Programmable Messaging), no es drop-in de Cloud API. Estimación: 4–6 hs de refactor en `whatsapp.service.js` para abstraer el cliente.

**Pasos:**
1. Crear cuenta Twilio.
2. Habilitar WhatsApp en Console → Senders → New WhatsApp Sender → Embedded Signup.
3. OTP al número, borrar WhatsApp app.
4. Setear `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` en Railway.
5. Refactor: `whatsapp.service.js` para usar SDK Twilio o adaptar webhook payload (formato distinto al de Meta).
6. Tests.

**Precios 2026:**
- Setup: **USD 0**.
- Mensual fijo: **USD 0** (pay-as-you-go).
- Per-message: Meta fee + **USD 0.005** markup Twilio (entrada y salida).
- Total estimado JFNN (~2000 msg/mes): **USD ~10–15/mes**.

**Pros:** Pay-as-you-go (excelente para arrancar). Documentación impecable. SLA empresarial.
**Contras:** Refactor de 4–6 hs del backend. Markup en mensajes entrantes (suma a volumen alto). Soporte solo en inglés.
**Tiempo activación:** 3–5 días (incluye refactor + tests).

---

### Opción D — Gupshup

**Descripción técnica:** BSP grande, fuerte en India y LATAM. Tech Provider con Embedded Signup.

**¿Sirve código?** Requiere adaptador (API propia).
**Precios:** USD 0.001 markup por mensaje, sin fee fijo en plan self-serve. Marketing tiene markup adicional 6% desde ene-2026.
**Pros:** Volumen alto barato.
**Contras:** Soporte más lento. Refactor backend igual a Twilio.
**Recomendación:** No prioritario para JFNN. Solo si 360dialog falla y se quiere comparar costos a volumen alto.

---

### Opción E — Wati

**Descripción técnica:** BSP + plataforma propia. NO recomendado para JFNN porque trae dashboard propio que duplicaría el nuestro.
**Precios:** USD 99/mes (Growth) + 20% markup per-message.
**Veredicto:** Descartar — caro y redundante.

---

### Opción F — Re-intentar Business Verification con otro enfoque

**Descripción:** Si Meta rechazó, las causas típicas son:
- Documento de RUT/registro no legible o vencido.
- Dirección en Meta no coincide con la del registro.
- Email de dominio no verificado.
- Sitio web con problemas (404s, falta de info de empresa).

**Pasos:**
1. Revisar email de rechazo de Meta — siempre dice motivo.
2. Verificar correo `contacto@repuestosjfnn.cl` por código pendiente.
3. Confirmar que dirección en Meta = "LOS OLIVOS 10958, EL BOSQUE, RM" exactamente como en CCV.
4. Si rechaza por sitio: añadir página `/sobre-nosotros` con razón social, RUT, dirección, email, teléfono.
5. Re-submit con documentos adicionales: factura de servicio (luz/agua) a nombre de la SPA en la misma dirección.
6. Si rechaza 2 veces más: escalación vía soporte de un BSP (360dialog/Twilio pueden empujar el ticket).

**Pros:** Resuelve el problema de raíz, desbloquea todos los tiers.
**Contras:** Tiempo (2–4 semanas más). Sin garantía.

---

### Opción G — Seguir con WhatsApp Business app + bots no oficiales (whatsapp-web.js, Baileys, Evolution API) — ⚠️ **NO RECOMENDADO**

**Descripción:** Usar librerías que se conectan via WhatsApp Web/multi-device emulando un cliente.

**Riesgo:** **CRÍTICO — ban permanente del número.** Investigación 2026:
- Cuentas duran típicamente **2–8 semanas** antes de ban permanente.
- Meta detecta vía fingerprinting de protocolo, patrones de velocidad y análisis comportamental.
- Reconnect loops disparan detección.
- Viola ToS de Meta — sin recurso si baneen.
- Si banean el número, **se pierde para WhatsApp para siempre** (incluso para reactivar como cliente normal).

**Veredicto:** **NO TOCAR.** El número de JFNN tiene valor estratégico (clientes lo tienen guardado, sale en Google Business, está en el sitio). Un ban es daño irreversible al negocio. Esta opción se documenta SOLO para que conste por qué se descarta.

---

### Opción H — Seguir manualmente con WhatsApp Business app (sin automatización)

**Descripción:** Status quo absoluto. Vendedores atienden a mano. Sin Gemini, sin dashboard recibiendo mensajes.
**Pros:** Cero riesgo, cero costo.
**Contras:** Tira a la basura todo el proyecto. No es Plan B, es "no hacer nada".
**Veredicto:** Solo como fallback temporal mientras se ejecuta Opción A/B (1–2 semanas).

---

## 3. Matriz comparativa

| Opción | Mantiene número | 1 o 2 números | Reutiliza código | Costo mensual (~CLP) | Riesgo ban | Tiempo activación |
|---|---|---|---|---|---|---|
| **A. Cloud API directa Meta** | ✅ | 1 o 2 | ✅ 100% | ~CLP 0–5.000 | 0 | 2–4 hs |
| **B. 360dialog (BSP)** | ✅ | 1 (recom.) | ✅ 100% | ~CLP 50.000 + msg | 0 | 1–3 días |
| **C. Twilio (BSP)** | ✅ | 1 | ⚠️ refactor 4–6h | ~CLP 10.000–15.000 | 0 | 3–5 días |
| **D. Gupshup (BSP)** | ✅ | 1 | ⚠️ refactor | variable | 0 | 3–5 días |
| **E. Wati** | ✅ | 1 | ❌ duplica UI | ~CLP 95.000+ | 0 | 2–3 días |
| **F. Re-intentar verificación** | ✅ | 1 o 2 | ✅ | depende ruta final | 0 | 2–4 semanas |
| **G. Bots no oficiales** | ⚠️ | 1 | parcial | ~CLP 0 | **🔴 ALTO** | 1 día |
| **H. Manual** | ✅ | 1 | ❌ no se usa | CLP 0 | 0 | 0 |

---

## 4. Recomendación del CTO

### Ruta principal — **Opción A (Cloud API directa Meta, Limited Access)**

**Por qué:**
- Costo casi cero (USD ~5/mes vs USD 55 de 360dialog).
- Backend ya está hecho para Cloud API → 0 refactor.
- 250 conversaciones/24h cubre 10x el volumen actual de JFNN.
- Service window (24 hs tras mensaje del cliente) → la mayoría de mensajes salen gratis.
- Mantiene número actual.
- No requiere Business Verification.

### Fallback inmediato — **Opción B (360dialog)**

Si Opción A falla (Meta no permite onboarding sin BSP por algún motivo regional, o el proceso técnico se atasca):
- Embedded Signup elimina fricción.
- Soporte en español.
- Mismo código backend.
- Costo asumible (~USD 55/mes) para PYME.

### Paralelo — **Opción F (re-intentar verificación)**

Mientras Opción A/B corre en producción, **re-trabajar la submission de Business Verification** en paralelo. Ventajas a futuro:
- Quita el límite de 250/24h (no es urgente hoy, sí cuando crezcan).
- Permite >2 números (útil si abren 3ª sucursal).
- Habilita "tilde verde" en perfil → trust signal para clientes.

### **Descartado:** G (bots no oficiales) — riesgo de ban irreversible. H (manual) — anula el proyecto.

### Estrategia de números (1 vs 2)

**Recomiendo 1 número compartido inicialmente** (status quo) y migrar a 2 (uno por sucursal) **solo si REQ-08 o feedback de vendedores lo justifica**. Razones:
- Backend hoy asume 1 número — refactor de ruteo es 1 día extra que no aporta valor inmediato.
- Clientes ya tienen el número guardado.
- Lock pesimista y atribución por vendedor ya resuelven la coordinación intra-sucursal.
- Métrica por sucursal ya funciona via `entidades.sucursal` derivada en backend.

---

## 5. Decisiones que necesita tomar Felipe

- [ ] **D1.** Confirmar si Meta ya respondió la verificación (revisar email `contacto@repuestosjfnn.cl` + Meta Business Manager).
- [ ] **D2.** Si rechazó: ¿lanzamos Opción A (Cloud API directa) o saltamos directo a Opción B (360dialog)? **Recomendación CTO: A primero, 1 día de timebox; si falla, B.**
- [ ] **D3.** ¿Autorizás borrar la cuenta de WhatsApp Business app del número actual? (Backup de chats primero — irreversible).
- [ ] **D4.** ¿1 número compartido o 2 (Melipilla/San Felipe)? **Recomendación CTO: 1 ahora, evaluar en 3 meses.**
- [ ] **D5.** ¿Re-intentamos Business Verification en paralelo o lo dejamos para más adelante? **Recomendación CTO: paralelo, prioridad media — no bloquea operación.**
- [ ] **D6.** Presupuesto mensual aprobado para BSP (en caso de Opción B): hasta **USD 60/mes** ≈ CLP 55.000.
- [ ] **D7.** ¿Quién maneja el Meta Business Manager — Felipe personal o cuenta empresa? Impacta tokens y propiedad de la WABA.

---

## Apéndice — Fuentes consultadas

- [Meta — Migrate Existing Number to Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api/get-started/migrate-existing-whatsapp-number-to-a-business-account/)
- [Meta — Pricing on WhatsApp Business Platform](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing)
- [Hyperleap — Limited Access Tier sin verificación 2026](https://hyperleap.ai/whatsapp-business-api/cloud-api)
- [360dialog — Pricing](https://360dialog.com/pricing) / [Embedded Signup Docs](https://docs.360dialog.com/docs/hub/embedded-signup)
- [Twilio — WhatsApp Pricing](https://www.twilio.com/en-us/whatsapp/pricing) / [Tech Provider Program](https://www.twilio.com/docs/whatsapp/isv/tech-provider-program/integration-guide)
- [Gupshup — Pricing changes Jan 2026](https://partner-docs.gupshup.io/changelog/december-2025)
- [Wati — Pricing](https://www.wati.io/pricing/)
- [Kraya AI — Ban risk Baileys / unofficial 2026](https://blog.kraya-ai.com/whatsapp-automation-ban-risk)
- [Chatarmin — WhatsApp API Pricing 2026](https://chatarmin.com/en/blog/whats-app-api-pricing)
