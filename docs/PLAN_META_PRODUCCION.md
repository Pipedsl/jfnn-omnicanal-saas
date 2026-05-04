# Plan de Migración a Producción — Meta WhatsApp Business

**Proyecto:** JFNN Omnicanal SaaS
**Fecha:** 2026-04-17
**Objetivo:** Migrar desde el número de prueba de Meta (token que expira cada 2h) hacia un entorno de producción real con:
- Número comercial permanente
- Token de sistema (no expira)
- Verificación del negocio aprobada
- Plantillas (templates) aprobadas para mensajes fuera de la ventana de 24h
- Cumplimiento legal (privacidad, términos, opt-in)

---

## Resumen ejecutivo

La migración a producción tiene **un cuello de botella crítico**: la **verificación del negocio en Meta**, que tarda entre **2 días y 4 semanas** dependiendo de qué tan consistente esté la documentación. Todo lo demás depende de este paso.

Estrategia: **arrancar verificación Meta en paralelo** mientras seguimos puliendo el agente.

### Entidad legal operativa

| Campo | Valor |
|-------|-------|
| Razón social | **Comercial e Industrial JFNN SpA** |
| Nombre comercial (DBA) | **Repuestos Automotrices JFNN** |
| Dominio | `repuestosjfnn.cl` |
| Correo corporativo | `contacto@repuestosjfnn.cl` |
| Sitio web | `https://repuestosjfnn.cl` |

> **Importante:** la entidad "JFNN Limitada" NO se usará para la verificación. Todos los documentos, registros y comunicación con Meta deben ser a nombre de **Comercial e Industrial JFNN SpA**.

---

## 1. Documentación a solicitar al dueño del negocio (Jessica Navarrete)

Esta es la lista completa de documentos y datos que necesitamos reunir **antes** de enviar la solicitud a Meta. Que todos estén a nombre de **Comercial e Industrial JFNN SpA**.

### 1.1. Documentos legales del SII y registro de comercio

| # | Documento | Formato | Notas |
|---|-----------|---------|-------|
| 1 | **Certificado de iniciación de actividades SII** | PDF | Descargable desde sii.cl → Servicios online → Situación tributaria. Debe decir "Comercial e Industrial JFNN SpA" + RUT. |
| 2 | **Certificado de vigencia de la sociedad** | PDF | Del Registro de Comercio. Máximo 60 días de antigüedad. |
| 3 | **Escritura de constitución** (opcional pero útil) | PDF | Por si Meta pide respaldo adicional de la razón social. |
| 4 | **RUT de la empresa** | Número | Para publicar en footer del sitio y usar en Meta Business. |
| 5 | **Patente comercial municipal vigente** (opcional) | PDF | Refuerza la verificación si es reciente. |

### 1.2. Comprobantes de domicilio comercial

Meta exige que la dirección declarada coincida con documentos externos verificables.

| # | Documento | Formato | Notas |
|---|-----------|---------|-------|
| 6 | **Factura de servicio básico** (luz, agua, internet o gas) | PDF | A nombre de "Comercial e Industrial JFNN SpA". Máximo 3 meses de antigüedad. Debe mostrar la dirección principal. |
| 7 | **Contrato de arriendo del local principal** (si aplica) | PDF | Alternativa si no hay factura a nombre de la SpA. |

### 1.3. Datos de contacto comercial

| # | Dato | Notas |
|---|------|-------|
| 8 | **Dirección comercial principal** | Exacta, con comuna, región y código postal. Debe ser una sola (elegir entre Melipilla, San Felipe o Santiago). La que esté declarada en SII. |
| 9 | **Teléfono comercial fijo o celular** | **DISTINTO al número de WhatsApp** (`+56 9 5955 6843`). Meta hace llamada/SMS de verificación. |
| 10 | **Correo corporativo** | `contacto@repuestosjfnn.cl` — ya existe, solo falta confirmar en Business Manager. |

### 1.4. Número de WhatsApp productivo

| # | Dato | Notas |
|---|------|-------|
| 11 | **Número de WhatsApp de producción** | Puede ser: (a) un número nuevo comprado específicamente, o (b) el actual `+56 9 5955 6843` si se desvincula de WhatsApp personal/normal. **CRÍTICO:** este número no podrá usarse en WhatsApp común, solo en WhatsApp Business API. |
| 12 | Chip físico o número virtual (VoIP) | Para recibir el código de verificación de Meta. Si es VoIP, debe ser capaz de recibir SMS o llamada. |

### 1.5. Acceso al sitio web

| # | Requisito | Notas |
|---|-----------|-------|
| 13 | **Acceso al CMS del sitio** `repuestosjfnn.cl` | Para agregar: razón social en footer, página de Política de Privacidad, página de Términos y Condiciones. Confirmar si es WordPress, Jumpseller, Wix, custom, etc. |
| 14 | **Credenciales DNS del dominio** | Opcional. Solo si Meta pide verificación de dominio por TXT record (poco común para Chile). |

### 1.6. Decisiones de negocio que necesitamos del dueño

| # | Decisión | Notas |
|---|----------|-------|
| 15 | ¿Usar el número actual `+56 9 5955 6843` o comprar uno nuevo para producción? | Si usan el actual, pierden el WhatsApp normal de ese número. |
| 16 | ¿Cuál será el **horario oficial** que se declara en Meta? | Se usa para la ficha del negocio. Ya tenemos: L-V 9:00-18:30 (colación 13:50-15:01), Sáb 9:00-13:00. |
| 17 | ¿Qué **categoría de negocio** se declara? | Sugerencia: "Automotive Store" o "Retail". |
| 18 | ¿Quién es el **administrador principal** del Business Manager? | Actualmente figura Jessica Navarrete. Decidir si se agrega un segundo admin de respaldo. |

---

## 2. Ajustes requeridos en el sitio web `repuestosjfnn.cl`

**Estado actual:** el sitio está activo y profesional pero le faltan elementos críticos para pasar la verificación.

### 2.1. Footer — agregar razón social y datos legales

El footer debe incluir, visible en todas las páginas:

```
Comercial e Industrial JFNN SpA
RUT: XX.XXX.XXX-X
[Dirección comercial principal completa, ciudad, región]

Contacto:
Teléfono: +56 X XXXX XXXX
Correo: contacto@repuestosjfnn.cl

© 2026 Comercial e Industrial JFNN SpA. Todos los derechos reservados.
Enlaces: [Política de Privacidad] [Términos y Condiciones]
```

### 2.2. Páginas legales nuevas (OBLIGATORIAS)

Meta **rechaza** aplicaciones sin estas dos páginas públicas:

| Página | URL sugerida | Contenido |
|--------|--------------|-----------|
| Política de Privacidad | `/politica-privacidad` | Debe mencionar: uso de WhatsApp Business API, datos que se recogen (teléfono, mensajes, imágenes enviadas), finalidad (atención de ventas), base legal, retención, derechos ARCO, contacto para ejercerlos. |
| Términos y Condiciones | `/terminos-y-condiciones` | Debe mencionar: condiciones de uso del canal WhatsApp, opt-in implícito al escribir, posibilidad de darse de baja, alcance geográfico, limitación de responsabilidad. |

> Redactaremos estas páginas como parte de la implementación. Solo se necesita el acceso al CMS.

### 2.3. Página de contacto — agregar teléfono fijo

Actualmente solo aparece WhatsApp. Meta valida cruzando el teléfono declarado en Business Manager contra lo que muestra el sitio.

---

## 3. Configuración de Meta Business Manager

### 3.1. Confirmar correo corporativo (YA PENDIENTE)

En https://business.facebook.com/settings/ aparece:
> "Sigue el enlace del correo electrónico enviado a contacto@repuestosjfnn.cl para confirmar tu dirección de correo electrónico."

**Acción:** abrir la bandeja de `contacto@repuestosjfnn.cl` y hacer clic en ese enlace.

### 3.2. Llenar "Información del negocio"

| Campo | Valor |
|-------|-------|
| Nombre legal | Comercial e Industrial JFNN SpA |
| Nombre visible / Nombre público | Repuestos Automotrices JFNN |
| Dirección | [según SII] |
| Ciudad / Región / Código postal | [según SII] |
| País | Chile |
| Teléfono del negocio | `+56 X XXXX XXXX` (fijo, NO WhatsApp) |
| Sitio web | `https://repuestosjfnn.cl` |

### 3.3. Agregar segundo administrador (recomendado)

Para evitar lockout si Jessica pierde acceso. Agregar un segundo admin de confianza en `Settings → Users → People → Add`.

---

## 4. Proceso de verificación del negocio en Meta

### 4.1. Pre-requisitos (checklist antes de enviar)

- [ ] Correo corporativo confirmado en Business Manager
- [ ] Información del negocio completa en Business Manager
- [ ] Sitio web con razón social visible en footer
- [ ] Política de Privacidad publicada y accesible
- [ ] Términos y Condiciones publicados y accesibles
- [ ] Teléfono comercial (fijo, no WhatsApp) capaz de recibir llamadas/SMS
- [ ] Todos los documentos PDF listos (SII, factura servicio, etc.)

### 4.2. Envío a verificación

1. `Business Settings` → `Business info` → `Security Center` (o `Centro de seguridad`)
2. Click en **"Start verification"**
3. Meta mostrará un formulario pidiendo:
   - Confirmar nombre legal
   - Confirmar dirección
   - Subir documentos (cargar PDFs del SII y factura de servicio)
   - Confirmar teléfono (recibirás código por SMS/llamada)
   - Confirmar correo corporativo

### 4.3. Tiempos esperados

| Escenario | Duración |
|-----------|----------|
| Verificación aprobada al primer intento | 2-5 días hábiles |
| Meta pide documentación adicional | 7-15 días hábiles |
| Documentos rechazados por inconsistencia | 2-4 semanas (reenviar y esperar nueva revisión) |

### 4.4. Causas comunes de rechazo (a evitar)

- Nombre legal en Business Manager ≠ nombre en documentos SII
- Dirección en Business Manager ≠ dirección en factura de servicio
- Sitio web no menciona la razón social
- Teléfono declarado no responde llamada de verificación
- Correo corporativo en dominio genérico (gmail, outlook)
- Documentos con más de 90 días de antigüedad
- Factura de servicio a nombre de persona natural, no de la SpA

---

## 5. Post-verificación: configuración de producción

Una vez Meta apruebe la verificación del negocio, se habilitan los siguientes pasos.

### 5.1. Migración del número de WhatsApp

**Opción A — Número nuevo:**
1. Comprar chip físico o número virtual
2. En Business Manager → WhatsApp Accounts → Add phone number
3. Verificar con código SMS/llamada
4. Configurar nombre visible, foto de perfil, categoría, descripción

**Opción B — Migrar número actual (+56 9 5955 6843):**
1. **Primero:** eliminar el número del WhatsApp normal/personal (en el celular)
2. Esperar 15 minutos
3. Agregarlo en Business Manager siguiendo el flujo de "Migrate existing number"
4. Verificar con código

### 5.2. Generación de System User Token (permanente)

Esto reemplaza el token de 2h que actualmente estamos usando.

1. Business Settings → System Users → Add
2. Nombre: `jfnn-backend-production`
3. Rol: Admin
4. Assign Assets → WhatsApp Business Account → Full control
5. Generate new token:
   - Permisos: `whatsapp_business_messaging`, `whatsapp_business_management`
   - Expiración: **Never**
6. **Guardar el token** en un lugar seguro (1Password o similar)
7. Subir a Railway como variable de entorno `WHATSAPP_ACCESS_TOKEN`

### 5.3. Creación y envío a revisión de Message Templates

Los templates son obligatorios para enviar mensajes **fuera de la ventana de 24h** desde el último mensaje del cliente. Sin templates aprobados, el bot no puede iniciar conversaciones ni retomar chats pausados.

Templates a crear (en `Business Manager → WhatsApp Manager → Message Templates`):

| # | Nombre interno | Categoría | Propósito |
|---|----------------|-----------|-----------|
| 1 | `cotizacion_lista` | UTILITY | Notificar al cliente que su cotización está lista |
| 2 | `retomar_cotizacion` | UTILITY | Retomar conversación pausada por más de 24h |
| 3 | `pago_confirmado` | UTILITY | Confirmar recepción de comprobante de pago |
| 4 | `pedido_llegado` | UTILITY | Avisar que el repuesto llegó a la sucursal |
| 5 | `recordatorio_retiro` | UTILITY | Recordatorio de retiro pendiente (3+ días) |
| 6 | `solicitud_resena` | MARKETING | Pedir reseña en Google tras entrega (requiere opt-in explícito) |

> Tiempo de revisión de templates: 24-48h por template. Hacer todos en paralelo.

### 5.4. Variables de entorno en Railway

Actualizar en el servicio de backend:

```env
# Reemplazar
WHATSAPP_ACCESS_TOKEN=<system user token permanente>
WHATSAPP_PHONE_ID=<phone id productivo>

# Rotar
WHATSAPP_VERIFY_TOKEN=<nuevo token de 32+ caracteres aleatorios>

# Agregar (nuevos)
WHATSAPP_BUSINESS_ACCOUNT_ID=<WABA ID productivo>
META_APP_SECRET=<app secret para validar firma del webhook>
META_APP_ID=<app id>
WHATSAPP_API_VERSION=v21.0

# Ajustar para producción
WHATSAPP_DEBOUNCE_MS=20000
```

### 5.5. Cambios de código necesarios

**Estado del código (actualizado 2026-05-03):**

- [x] **API version configurable** — `backend/services/whatsapp.service.js` ya lee `WHATSAPP_API_VERSION` (default `v21.0`). Sin acción.
- [x] **Validación X-Hub-Signature-256** — implementada en `backend/controllers/whatsapp.controller.js` (`verifySignature`). Si `META_APP_SECRET` no está definido en producción, rechaza con 401. En dev permite pasar con warning. Requiere `req.rawBody` capturado en `backend/index.js`.
- [x] **Función de envío de templates** — `whatsappService.sendTemplateMessage` ya existe y se usa desde el endpoint manual `/cotizaciones/template`.
- [x] **Fallback automático a template HSM en error 130472** — `sendTextMessage` ahora detecta el error y reintenta con `TEMPLATES.REOPEN_24H` (`retomar_cotizacion`, `es_CL`) sin que el caller lo note. Activación efectiva tras aprobación del template por Meta.
- [ ] **Templates aprobados en Meta** — los 6 templates de la sección 5.3 deben crearse y aprobarse antes del cutover. El nombre `retomar_cotizacion` está hard-coded en `whatsapp.service.js#TEMPLATES.REOPEN_24H` — actualizar ahí si Meta exige otro nombre.
- [ ] **Setear credenciales reales** post-aprobación: `META_APP_SECRET`, `META_APP_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_ACCESS_TOKEN` (System User token permanente) en Railway.

**Mock de desarrollo:** `whatsapp.service.js` mantiene fallback a mock cuando `NODE_ENV !== 'production'`. En producción se exige token válido; si falla la API, lanza el error.

---

## 6. Cumplimiento legal y opt-in

### 6.1. Opt-in de los clientes

Para cumplir con los términos de WhatsApp Business, cada cliente que contactemos debe haber dado consentimiento. Formas válidas:

1. **Opt-in implícito:** el cliente inicia la conversación escribiendo primero al número. ✅ Este es el caso actual y el más común en JFNN.
2. **Opt-in explícito desde sitio web:** checkbox en formulario "Acepto recibir comunicaciones por WhatsApp".

Para templates de MARKETING (ej: pedir reseña), Meta exige opt-in **explícito** documentado. Sugerencia: cuando el cliente retira el producto, preguntar verbalmente "¿le molesta si le escribimos un mensaje para pedirle una reseña?" y registrar el sí en el dashboard.

### 6.2. Registro de trazabilidad

Mantener en la base de datos, por cada cliente:
- Primera fecha de contacto
- Origen del opt-in (entrante WA / web / presencial)
- Si solicitó baja alguna vez

Ya tenemos la tabla `clientes` — confirmar que guarde estos campos o agregarlos.

### 6.3. Baja / derecho de eliminación

Implementar comando WhatsApp: si el cliente escribe "BAJA" o "ELIMINAR", marcar el cliente como opt-out y no volver a contactarlo por templates.

---

## 7. Plan de migración (cutover)

Una vez todo listo, el día del cambio a producción:

### Secuencia (estimada 30-60 min):

1. **T-24h:** avisar al dueño que se hará el cambio. Backup de la base de datos.
2. **T-1h:** preparar variables de Railway en un documento (sin aplicar aún).
3. **T-0:**
   - Aplicar nuevas variables de entorno en Railway
   - Forzar redeploy
   - Verificar logs: webhook debe recibir mensajes de prueba correctamente
4. **T+5min:** enviar mensaje de prueba desde un celular real → ver si llega, procesa y responde
5. **T+15min:** probar templates (enviarse uno a sí mismo)
6. **T+30min:** activar el número productivo en el sitio web y redes (cambiar el link de WhatsApp del footer)
7. **T+1h:** monitorear flujo normal de clientes durante 2-3 horas

### Rollback

Si algo falla:
- Las variables de entorno anteriores (del entorno test) se guardan en un backup
- `railway variables --service backend restore <snapshot>` recupera el estado previo
- El número test sigue vivo hasta que se decida eliminarlo (sugerencia: mantenerlo 2 semanas post-cutover)

---

## 8. Monitoreo post-producción

### Métricas a vigilar primer mes:

| Métrica | Dónde | Umbral de alerta |
|---------|-------|-------------------|
| Quality Rating de WhatsApp | Business Manager → WhatsApp Accounts | Si baja a "Medium" → revisar bloqueos/reportes de clientes |
| Messaging Tier | Business Manager | Debe subir automáticamente de Tier 1 (1000 chats/día) → Tier 2 (10k) → Tier 3 (100k) según uso |
| Tasa de error del webhook | Logs Railway | >1% por 5 min → alerta |
| Tiempo de respuesta del agente | Logs + dashboard | Mediana <15s |
| Templates rechazados | Business Manager | Reenviar con ajustes |
| Bloqueos por usuarios | Business Manager | >2% de conversaciones → revisar tono del agente |

### Mejoras sugeridas tras arranque

- Implementar dashboard de quality rating dentro del admin
- Alertas automáticas a Slack/Telegram del dueño si baja la calidad
- Log de todos los templates enviados para auditar uso

---

## 9. Cronograma estimado (path crítico)

| Etapa | Duración | Dependencias |
|-------|----------|--------------|
| 1. Recopilar documentación del dueño | 1-3 días | Jessica disponibilidad |
| 2. Cambios en sitio web (footer + 2 páginas) | 1-2 días | Acceso al CMS |
| 3. Configurar Business Manager completo | 1 día | Sitio listo |
| 4. Enviar verificación del negocio | 1 día | Todo lo anterior |
| 5. **Esperar aprobación de Meta** | **2 días - 4 semanas** | Meta |
| 6. Crear System User Token y migrar número | 1 día | Aprobación Meta |
| 7. Crear y enviar a revisión templates | 1 día de trabajo + 24-48h de revisión | Verificación aprobada |
| 8. Cambios de código (v21.0, firma webhook, templates) | 2-3 días | — (puede hacerse en paralelo) |
| 9. Cutover a producción | 1 hora | Todo anterior |
| 10. Monitoreo post-producción | 2 semanas | — |

**Tiempo total estimado (path crítico):** ~2-6 semanas desde hoy.

---

## 10. Checklist global

### A solicitar a Jessica Navarrete (dueña)

- [ ] PDF: Certificado de iniciación de actividades SII
- [ ] PDF: Certificado de vigencia de la sociedad (máx 60 días)
- [ ] PDF: Factura de servicio básico a nombre de la SpA (máx 3 meses)
- [ ] Número de RUT de la SpA
- [ ] Dirección comercial principal (la registrada en SII)
- [ ] Teléfono fijo o celular comercial distinto al WhatsApp
- [ ] Credenciales / acceso al CMS de `repuestosjfnn.cl`
- [ ] Decisión: ¿número WhatsApp nuevo o migrar `+56 9 5955 6843`?
- [ ] Confirmar el enlace del correo `contacto@repuestosjfnn.cl` en Business Manager

### A hacer por el equipo técnico (nosotros)

- [ ] Agregar razón social + RUT + contacto al footer del sitio
- [ ] Redactar y publicar Política de Privacidad
- [ ] Redactar y publicar Términos y Condiciones
- [x] Actualizar `whatsapp.service.js` a `v21.0` (configurable vía env)
- [x] Implementar validación de firma `X-Hub-Signature-256`
- [x] Implementar función de envío de templates + fallback automático fuera de ventana 24h
- [x] Métricas reales del agente conectadas en `/admin/estadisticas` (mensajes IA vs vendedor, dinero recaudado, tiempo ahorrado)
- [ ] Redactar las 6 plantillas para enviar a revisión
- [ ] Documentar proceso de rollback
- [ ] Configurar monitoreo de quality rating

### A configurar en Business Manager

- [ ] Completar "Información del negocio"
- [ ] Agregar segundo admin de respaldo
- [ ] Enviar a verificación
- [ ] (Post-aprobación) Crear System User permanente
- [ ] (Post-aprobación) Migrar/crear número de WhatsApp productivo
- [ ] (Post-aprobación) Crear y enviar a revisión 6 templates

### A configurar en Railway

- [ ] `WHATSAPP_ACCESS_TOKEN` (System User token)
- [ ] `WHATSAPP_PHONE_ID` (productivo)
- [ ] `WHATSAPP_VERIFY_TOKEN` (rotar)
- [ ] `WHATSAPP_BUSINESS_ACCOUNT_ID` (nuevo)
- [ ] `META_APP_SECRET` (nuevo)
- [ ] `META_APP_ID` (nuevo)
- [ ] `WHATSAPP_API_VERSION=v21.0`
- [ ] `WHATSAPP_DEBOUNCE_MS=20000`

---

## Contacto y dudas

Cualquier consulta sobre este plan → Felipe Navarrete (equipo técnico).
Documentación oficial Meta: https://developers.facebook.com/docs/whatsapp/cloud-api
