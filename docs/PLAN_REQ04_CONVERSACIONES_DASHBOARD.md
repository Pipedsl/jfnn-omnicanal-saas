# PLAN REQ-04 — Centro de Conversaciones en el Dashboard

> Estado: propuesto · Fecha: 2026-05-22 · Autor: Tech Lead
> Ampliado: 2026-05-22 — se agregan Fase 6 (catálogo de plantillas HSM) y Fase 8 (nueva conversación / contacto en frío), aprobadas por Felipe. El plan pasa de 8 a 10 fases (la antigua Fase 6 "Respuesta libre" es ahora la 7; "Llamadas perdidas" la 9; "Migración" la 10).
> Documentos relacionados: `docs/PLAN_OPCION_A_EJECUCION.md` (migración del número productivo — sección 7), `CLAUDE.md` (arquitectura y reglas críticas).

## Resumen ejecutivo

Con la migración a WhatsApp Cloud API, todos los mensajes entran por webhook y ya no existe la app de WhatsApp en un teléfono físico: el vendedor perdió la única forma que tenía de ver y seguir las conversaciones. Hoy el backend manda el texto a Gemini, extrae entidades y **descarta el mensaje crudo**; las imágenes se guardan en disco efímero de Railway, los audios se descartan y los videos se ignoran en el webhook. Este plan construye un "Centro de Conversaciones" — persistencia de mensajes, storage multimedia persistente, vista de chat en el dashboard y respuesta libre del vendedor — y es **bloqueante para migrar el número productivo de JFNN**. Se entrega en 10 fases incrementales sin romper el flujo actual de Gemini ni la clasificación de comprobantes.

Además del centro de conversaciones reactivo (el cliente escribe primero), el plan incorpora dos capacidades **proactivas** aprobadas por Felipe: (a) un **catálogo completo de 12 plantillas HSM** pre-aprobadas por Meta — hoy solo existe `retomar_cotizacion` cableada — que permite al vendedor escribir a un cliente fuera de la ventana de 24 h en cualquier punto del ciclo de venta; y (b) **"Nueva conversación"**, que habilita iniciar un chat con un número que JFNN ya tiene (cliente de tienda física, lista vieja) enviándole una plantilla, sin esperar a que el cliente escriba primero.

---

## Hallazgos verificados en el código

| # | Hallazgo | Evidencia |
|---|----------|-----------|
| 1 | Mensajes crudos no se persisten. No hay tabla de mensajes. | `backend/sql/init.sql` — `user_sessions` tiene `entidades` JSONB, sin columna de mensajes. `whatsapp.controller.js` pasa `userText` a Gemini y no lo guarda. |
| 2 | Imágenes en disco efímero. | `backend/services/storage.service.js` líneas 12-13 — `UPLOADS_DIR` / `PART_IMAGES_DIR` bajo `backend/uploads/`. Servidas con `express.static('/uploads')` en `backend/index.js:31`. Cada deploy de Railway borra el volumen. |
| 3 | Audios se descargan pero no se guardan. | `whatsapp.controller.js:558-570` — descarga buffers, los pasa a Gemini, nunca llama a storage. |
| 4 | Videos ignorados. | `whatsapp.controller.js:789` — `if (!message || !['text','image','audio'].includes(message.type)) return 200`. |
| 5 | No hay endpoint de mensaje libre del vendedor. | `dashboard.routes.js` — endpoints cierran por acción (`/cotizaciones/responder`, `/solicitar-vin`, `/solicitar-patente`, `/cotizaciones/template`). `sendSellerMessage` existe en `whatsapp.service.js:101` pero ninguna ruta lo expone para texto arbitrario. |
| 6 | **Mecanismo de pausa de IA YA EXISTE (parcial).** | `sessions.service.js:845` `setAgentePausado`; flag `entidades.agente_pausado`; `whatsapp.controller.js:222` hace `return` y silencia a Gemini. Endpoint `PATCH /sessions/:phone/pausa` (`dashboard.routes.js:884`). **Reusable** — pero el `return` en línea 224 saltaría también la persistencia si se agrega ingenuamente (ver Fase 1, riesgo R7). |
| 7 | Ventana 24h ya tiene fallback. | `whatsapp.service.js:55-71` — error 130472 → `sendTemplateMessage('retomar_cotizacion')`; lanza `WHATSAPP_WINDOW_CLOSED` si el template falla. `ultimo_mensaje` en `user_sessions` sirve para calcular si la ventana está abierta. |
| 8 | Sucursal ya derivada. | `derivarSucursal` en `sessions.service.js`, columna `sucursal` en `user_sessions`, bandeja filtra por `x-user-sucursal` del JWT. Reusable tal cual. |
| 9 | Patrones reusables. | Polling 3s en pendientes, `useQuoteLock` (claim/renew/release), axios cache-busting `?t=`, badges Tailwind `bg-[color]/10`. |
| 10 | Solo 1 template HSM cableado. | `whatsapp.service.js:14-16` — la constante `TEMPLATES` tiene una sola entrada (`REOPEN_24H` → `retomar_cotizacion`, idioma `es_CL`). El fallback de ventana cerrada solo sabe usar esa. Felipe quiere 12. |
| 11 | `sendTemplateMessage` ya soporta parámetros. | `whatsapp.service.js:111-124` — acepta `bodyParams`: array de strings (posicional → `{type:'text', text}`) o de objetos `{name, text}` (named → `parameter_name`). Reusable tal cual; hay que decidir un formato consistente (ver D4). |
| 12 | **No se persiste la fecha de cambio de estado.** | `sessions.service.js:582` — `setEstado` solo escribe `estado` y `ultimo_mensaje = NOW()`. No hay columna ni campo que registre **cuándo** un pedido entró a `ESPERANDO_RETIRO`. La plantilla `recordatorio_retiro` necesita ese dato → hay que persistirlo (ver Fase 6, sub-tarea 6.0 y riesgo R12). |
| 13 | Tabla `clientes` existe y es perfil por `phone`. | `init.sql:19-40` — PK `phone`, campos `nombre`, `email`, `rut`, `total_compras`, `es_recurrente`, etc. No tiene `sucursal`. Reusable para "Nueva conversación": al escribir a un número se crea/actualiza el perfil. |

**Decisión de migración de historial:** no se migra historial textual viejo — se perdió y nunca existió como texto en DB. El Centro de Conversaciones arranca de cero desde el deploy de la Fase 1. Los chats de la app de WhatsApp Business se respaldan manualmente en la Fase 11 (ver `PLAN_OPCION_A_EJECUCION.md` 7.1).

---

## Decisiones de arquitectura

### D1 — Tabla `mensajes` dedicada (NO JSONB en sesión)

Se crea una tabla relacional `mensajes` en vez de un array JSONB dentro de `user_sessions.entidades`.

**Justificación:**
- Un array JSONB crece sin techo dentro de la fila de sesión; cada `updateEntidades` reescribe el blob completo → escrituras O(n) y contención de fila.
- `user_sessions` se borra/archiva al cerrar el ciclo (`archiveSession`). Los mensajes deben sobrevivir el archivado del pedido para auditoría e historial — una tabla independiente con `phone` los preserva.
- Paginación, índice por `(phone, created_at)` y conteos por tipo son triviales en SQL y costosos en JSONB.
- El caché de sesión (5s TTL) se invalida en cada escritura; meter mensajes ahí dispararía invalidaciones constantes y degradaría la bandeja.

### D2 — Storage: Supabase Storage

Migrar multimedia de disco efímero de Railway a **Supabase Storage** (bucket `whatsapp-media`).

| Opción | Costo | Simplicidad | Veredicto |
|--------|-------|-------------|-----------|
| Supabase Storage | Incluido en plan actual; ~1 GB free, luego centavos/GB | SDK `@supabase/supabase-js` ya presente (`dashboard/lib/supabase.ts`); URLs firmadas nativas | **Elegido** |
| Railway Volume | Costo de volumen mensual + sigue acoplado al backend | Persistente pero no resuelve servir al dashboard sin proxy propio | Descartado |
| AWS S3 | Centavos/GB pero suma una cuenta y credenciales nuevas | Requiere SDK extra, IAM, política de bucket | Descartado — over-engineering para ~30 conv/día |

JFNN ya usa Supabase para la DB de producción → cero proveedores nuevos, una sola consola, y permite URLs firmadas con expiración para no exponer media pública. Volumen estimado: ~30 conv/día × ~2 medias × ~300 KB ≈ 18 MB/día ≈ 0,5 GB/mes → costo despreciable.

### D3 — Agente IA vs vendedor: reusar `agente_pausado` + auto-pausa al primer mensaje del vendedor

No se inventa un flag nuevo. Se reusa `entidades.agente_pausado` (hallazgo #6). Cuando un vendedor envía el primer mensaje libre en una conversación, el endpoint setea `agente_pausado = true` automáticamente (atención humana tomada). Gemini deja de responder en esa sesión. El vendedor reactiva la IA con un toggle explícito en la UI ("Devolver al agente IA"). Esto evita que la IA responda encima del vendedor sin construir maquinaria nueva.

**Concurrencia entre vendedores:** se reusa el patrón de `useQuoteLock`. El acto de "tomar la conversación" hace claim del lock existente (`lock_token` / `lock_vendedor` / `lock_expires_at` en `user_sessions`). Si otro vendedor ya la tiene, la UI muestra "🔒 Atendiendo: X" y deshabilita el input. No se crea un lock nuevo — el lock pesimista de cotización y el de conversación son el mismo recurso por `phone`.

### D4 — Catálogo de plantillas HSM como única fuente de verdad en `TEMPLATES`

El catálogo de las 12 plantillas se cablea en la constante `TEMPLATES` de `whatsapp.service.js`, ampliando la entrada única actual. `TEMPLATES` pasa a ser la **única fuente de verdad** del backend: el endpoint del selector de plantillas (Fase 6) lee de ahí qué plantillas existen y qué parámetros espera cada una, y el dashboard arma el formulario de variables a partir de esa metadata. No se hardcodea el catálogo en el frontend ni se duplica en DB.

**Formato de parámetros — decisión:** `sendTemplateMessage` acepta posicional u objeto named (hallazgo #11). Se adopta **posicional** (`{{1}}`, `{{2}}`, ...) para todo el catálogo nuevo, por consistencia con `retomar_cotizacion` y porque named params requieren que la plantilla se haya creado en Meta con nombres de variable explícitos (paso extra y propenso a desalinearse). Cada entrada de `TEMPLATES` declara un array `params` ordenado con `{ key, label }` — `key` para el código, `label` para el formulario del dashboard.

### D5 — "Nueva conversación" no es agenda de contactos

WhatsApp Cloud API **no tiene libreta de contactos**: no se "guarda" un contacto en Meta. Iniciar una conversación con un número nuevo es, técnicamente, enviarle una plantilla HSM aprobada — eso crea la conversación del lado de Meta y abre la ventana de 24 h si el cliente responde. Por eso "Nueva conversación" (Fase 7) **depende dura de Fase 6**: sin catálogo de plantillas no hay forma legal de iniciar el primer mensaje. El "directorio de clientes" de JFNN es la tabla `clientes` (perfil por `phone`); "Nueva conversación" la usa como origen/destino, no como agenda de WhatsApp.

**Envío masivo fuera de alcance.** Felipe pidió explícitamente empezar de a un número por vez. El bulk (subir una lista y disparar plantillas en lote) queda **fuera de alcance** de este plan: concentra riesgo de spam, puede degradar la calificación de calidad del número en Meta (y con ello el límite diario de mensajes), y exige rate-limiting y opt-out que hoy no existen. Se evalúa a futuro como REQ aparte.

---

## Fases

Orden estricto por dependencia. Fases 1-2 son backend puro y no tienen UI; pueden desplegarse sin romper nada (escriben datos que aún nadie lee).

### Fase 1 — Persistencia de mensajes (backend)

**Objetivo:** registrar cada mensaje entrante y saliente en una tabla `mensajes`.

**SQL — añadir a `backend/sql/init.sql`** (y aplicar a prod vía MCP Supabase `apply_migration`, NO psql — ver `CLAUDE.md`):

```sql
CREATE TABLE IF NOT EXISTS mensajes (
    id            BIGSERIAL PRIMARY KEY,
    phone         VARCHAR(30)  NOT NULL,
    direccion     VARCHAR(10)  NOT NULL CHECK (direccion IN ('entrante','saliente')),
    tipo          VARCHAR(15)  NOT NULL CHECK (tipo IN ('text','image','audio','video','document')),
    contenido     TEXT,                       -- cuerpo de texto o caption
    media_url     TEXT,                       -- ruta Supabase Storage (null si tipo=text)
    media_mime    VARCHAR(60),
    transcripcion TEXT,                        -- solo audio (Fase 2)
    autor         VARCHAR(15)  NOT NULL CHECK (autor IN ('cliente','agente_ia','vendedor')),
    autor_nombre  VARCHAR(100),                -- nombre del vendedor cuando autor='vendedor'
    sucursal      VARCHAR(30),
    wa_message_id VARCHAR(80),                 -- id de Meta, para dedupe de reintentos de webhook
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mensajes_phone_fecha ON mensajes(phone, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mensajes_sucursal    ON mensajes(sucursal);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mensajes_wa_id ON mensajes(wa_message_id) WHERE wa_message_id IS NOT NULL;
```

`wa_message_id` con índice único evita duplicar mensajes si Meta reintenta el webhook (responde 200 igual pero el `INSERT ... ON CONFLICT DO NOTHING` no duplica).

**Archivos a crear:**
- `backend/services/mensajes.service.js` — `registrarEntrante(...)`, `registrarSaliente(...)`, `listarPorPhone(phone, {limit, before})`, `listarConversacionesActivas({sucursal})`. Logging prefijado `[Mensajes]`, queries parametrizadas.

**Archivos a modificar:**
- `backend/controllers/whatsapp.controller.js`:
  - En `receiveMessage` (~línea 786), **antes** del debounce: persistir cada mensaje entrante con `registrarEntrante` (tipo, caption, `wa_message_id`). Esto ocurre en TODOS los mensajes, incluso si `agente_pausado` (corrige R7: el `return` de línea 224 silencia a Gemini, no a la persistencia — la persistencia va antes y en otro punto del flujo, en el webhook, no en `processBufferedMessages`).
  - En `processBufferedMessages`, al enviar la respuesta de Gemini (~línea 765): tras `sendAgentMessage`, persistir saliente con `autor='agente_ia'`.
- `backend/services/whatsapp.service.js`: en `sendSellerMessage` ya se incrementa el contador; añadir hook opcional o dejar que el endpoint del dashboard (Fase 7) registre el saliente del vendedor. Decisión: registrar desde el endpoint del dashboard para tener el `autor_nombre`.

**Endpoints:** ninguno nuevo en esta fase (solo escritura).

**Esfuerzo: 6 h**

---

### Fase 2 — Storage persistente + multimedia (backend)

**Objetivo:** migrar imágenes a Supabase Storage, persistir audios con transcripción, y dar de alta el tipo `video`.

**Archivos a modificar:**
- `backend/services/storage.service.js` — reescribir `uploadVoucher` y `uploadPartImage` para subir a Supabase Storage (`bucket whatsapp-media`, paths `comprobantes/`, `part-images/`). Añadir `uploadAudio`, `uploadVideo`, `uploadDocument`. Devolver path interno; el dashboard pedirá URL firmada. Mantener firma de funciones existentes para no tocar callers de comprobantes.
- `backend/controllers/whatsapp.controller.js`:
  - Línea 789: ampliar el filtro a `['text','image','audio','video','document']`.
  - Bloque de audio (~558-570): tras descargar, llamar `storageService.uploadAudio` y guardar `media_url` en el mensaje. Transcribir con Gemini (ver abajo) y guardar `transcripcion`.
  - Añadir bloque `hasVideo`: descargar con `downloadMedia`, subir con `uploadVideo`, persistir mensaje tipo `video`. **No** se manda el video a Gemini en esta fase (costo de tokens, R3) — solo se guarda y se notifica al vendedor que el cliente envió un video.
  - Documentos (`document`): mismo trato que video — guardar y notificar, sin procesar.

**Transcripción de audio:** Gemini ya recibe los audios para extraer entidades (`generateResponse(..., audioDataList)`). Se extiende el prompt para que devuelva además `transcripcion_audio` en el JSON — **costo marginal cero** porque el audio ya se está enviando al modelo (no es una llamada extra). Se guarda en `mensajes.transcripcion` para que el vendedor lea sin reproducir.

**Migración del bucket:** crear bucket `whatsapp-media` en Supabase (privado). No se migran archivos viejos del disco de Railway — son efímeros y probablemente ya se perdieron; arranca limpio.

**Esfuerzo: 8 h**

---

### Fase 3 — Endpoints de lectura de conversaciones (backend)

**Objetivo:** exponer la conversación y la lista de conversaciones al dashboard.

**Archivos a modificar:** `backend/routes/dashboard.routes.js` — añadir:

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/conversaciones` | Lista conversaciones activas. Filtra por `sucursal` derivada del JWT `x-user-sucursal` (vendedor) o query param (admin). Devuelve `phone`, último mensaje, timestamp, no leídos, sucursal, `agente_pausado`, lock actual, ventana 24h abierta/cerrada. |
| GET | `/conversaciones/:phone` | Timeline paginado de `mensajes` por `phone` (orden cronológico, `?before=` para scroll infinito). Cada mensaje incluye URL firmada de Supabase si tiene media. |

**Filtrado por sucursal y conversación sin sucursal derivada:** una conversación nueva en estado `PERFILANDO` puede no tener `sucursal` aún (`derivarSucursal` corre más tarde). Decisión: las conversaciones con `sucursal IS NULL` van a un **pool común visible para todos los roles** (vendedores de ambas sucursales y admin), etiquetadas "Sin sucursal asignada". En cuanto `derivarSucursal` la asigna, cae al filtro normal. Esto evita que una consulta nueva quede invisible. El endpoint `/conversaciones` incluye explícitamente `sucursal IS NULL` en el resultado de cada vendedor.

**URLs firmadas:** el endpoint genera URLs firmadas de Supabase con expiración corta (ej. 1 h) en lugar de exponer el bucket público — no se sirve media desde `express.static` nunca más.

**Esfuerzo: 5 h**

---

### Fase 4 — Vista de chat en el dashboard (UI lectura)

**Objetivo:** que el vendedor vea las conversaciones en timeline.

**Archivos a crear (`dashboard/`):**
- `components/ConversacionesList.tsx` — panel lateral con conversaciones activas, badge de no leídos, badge de sucursal, indicador "🔒 Atendiendo: X" si hay lock.
- `components/ChatTimeline.tsx` — burbujas ida/vuelta. Distinción visual: cliente (gris, izquierda), agente IA (azul, derecha, ícono robot), vendedor (verde, derecha, nombre del vendedor). Scroll infinito hacia arriba con `?before=`.
- `components/MediaViewer.tsx` — visor de imágenes (lightbox, reusar patrón de `ImageLightbox.tsx`), `<audio controls>` con la transcripción mostrada debajo del player, `<video controls>` para videos, link de descarga para documentos.
- `app/conversaciones/page.tsx` — página `/conversaciones`, layout dos columnas (lista + timeline).
- `lib/conversaciones.ts` — wrappers axios con cache-busting `?t=`.

**Archivos a modificar:**
- `dashboard/app/page.tsx` o el nav — añadir entrada "Conversaciones".

**Refresco:** polling cada 4 s en la lista y en el timeline abierto (reusar el patrón de 3 s de pendientes). **No WebSockets** — justificación: volumen ~30 conv/día, picos de pocos mensajes/minuto; el polling de 4 s da latencia percibida aceptable, cuesta cero infraestructura, no requiere sticky sessions ni un canal persistente en Railway, y es consistente con el resto del dashboard (la bandeja ya hace polling). WebSockets serían over-engineering y sumarían un punto de fallo.

**Esfuerzo: 12 h**

---

### Fase 5 — Indicador de ventana de 24h (backend + UI)

**Objetivo:** que el vendedor sepa si puede escribir texto libre o solo templates.

**Backend:** el endpoint `/conversaciones` y `/conversaciones/:phone` devuelven `ventana_abierta: boolean` calculado como `NOW() - ultimo_mensaje_entrante < 24h` (usar el `created_at` del último mensaje `direccion='entrante'` de la tabla `mensajes`, más preciso que `user_sessions.ultimo_mensaje`).

**UI:** cuando `ventana_abierta === false`, el input de texto se deshabilita con un aviso "Ventana de 24 h cerrada — solo puedes enviar una plantilla aprobada" y se ofrece un botón "Enviar plantilla" que abre el **selector de plantillas** de la Fase 6. Banner ámbar. Cuando faltan <2 h para cerrar, banner de advertencia "La ventana cierra pronto".

> Nota de dependencia: el botón "Enviar plantilla" de esta fase queda funcional recién al completarse la Fase 6 (selector + endpoint de envío de plantilla). Si la Fase 5 se despliega antes que la 6, el botón se renderiza deshabilitado con tooltip "Disponible pronto".

**Esfuerzo: 4 h**

---

### Fase 6 — Catálogo de plantillas HSM (Meta + backend + UI)

**Objetivo:** dejar listo un catálogo de 12 plantillas pre-aprobadas por Meta, cableado en el backend y expuesto al vendedor mediante un selector con formulario de variables. Habilita escribir al cliente **fuera de la ventana de 24 h** en cualquier punto del ciclo.

#### 6.0 — Persistir la fecha de "listo para retiro" (precondición de `recordatorio_retiro`)

**Problema (hallazgo #12):** `setEstado` no guarda *cuándo* un pedido cambió de estado. La plantilla `recordatorio_retiro` necesita saber hace cuántos días el pedido está esperando retiro, y ese dato **no existe hoy**.

**Solución:** persistir un timestamp de entrada a `ESPERANDO_RETIRO`.

```sql
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS fecha_listo_retiro TIMESTAMPTZ;
```

`setEstado` setea `fecha_listo_retiro = NOW()` **solo** cuando `nuevoEstado === 'ESPERANDO_RETIRO'` y la columna está `NULL` (idempotente — no se pisa si se reentra al estado). El backend calcula `dias = floor((NOW() − fecha_listo_retiro) / 1 día)` al rellenar la variable `{{2}}` de la plantilla. Aplicar a prod vía MCP Supabase `apply_migration`. Para pedidos ya archivados no aplica (la plantilla se usa sobre sesiones activas en `ESPERANDO_RETIRO`).

#### 6.1 — Catálogo de plantillas a crear en Meta

Las 12 plantillas se crean en **WhatsApp Manager → Plantillas de mensajes**. Esto es **trabajo de configuración manual de Felipe** (guiado, no código). Cada plantilla nueva pasa por revisión de Meta (~1 día hábil, a veces minutos). Idioma: `es_CL` cuando Meta lo ofrezca para la categoría; si no, `es` (igual que `retomar_cotizacion`, que ya está en `es_CL`).

**Variables:** Meta numera las variables del cuerpo como `{{1}}`, `{{2}}`, ... en orden de aparición. El texto propuesto abajo es la base; Felipe puede pulir redacción al crearlas, manteniendo la **misma cantidad y orden de variables**.

##### UTILITY (transaccionales — costo bajo)

| # | Nombre técnico | Estado | Variables (orden) | Texto propuesto |
|---|----------------|--------|-------------------|-----------------|
| 1 | `retomar_cotizacion` | **Crear** — ⚠️ cableada en código (`TEMPLATES.REOPEN_24H`, `params: []`) pero NO necesariamente aprobada en la WABA actual `1003088295416438`. Las plantillas viven por WABA y no se migran; debe crearse y aprobarse en Meta como las demás. **Sin variables** — el fallback automático de `sendTextMessage` la invoca sin parámetros; agregarle variables rompería ese mecanismo. | (sin variables) | "Hola 👋 Tu cotización en Repuestos JFNN sigue disponible. Si quieres retomarla o tienes dudas, respóndenos por aquí y te ayudamos. 🔧" |
| 2 | `cotizacion_lista` | Crear | `{{1}}` nombre cliente · `{{2}}` descripción repuesto/auto · `{{3}}` precio | "Hola {{1}} 👋 Tu cotización en Repuestos JFNN ya está lista: {{2}} por ${{3}}. Respóndenos por aquí para coordinar el pago y la entrega." |
| 3 | `comprobante_pendiente` | Crear | `{{1}}` nombre · `{{2}}` número de cotización | "Hola {{1}}, nos faltó recibir el comprobante de pago de tu cotización #{{2}}. Cuando puedas, envíanoslo por este chat y seguimos con tu pedido. 🙌" |
| 4 | `encargo_llego` | Crear | `{{1}}` nombre · `{{2}}` sucursal | "¡Buenas noticias, {{1}}! 📦 Tu repuesto por encargo ya llegó a nuestra sucursal de {{2}}. Escríbenos para coordinar el retiro." |
| 5 | `saldo_pendiente` | Crear | `{{1}}` nombre · `{{2}}` monto del saldo · `{{3}}` número de pedido | "Hola {{1}}, te recordamos que tu pedido #{{3}} tiene un saldo pendiente de ${{2}}. Puedes transferir o pagar en la sucursal al retirar. ¡Cualquier duda escríbenos!" |
| 6 | `listo_para_retiro` | Crear | `{{1}}` nombre · `{{2}}` número de pedido · `{{3}}` sucursal | "Hola {{1}} 🎉 Tu pedido #{{2}} ya está listo para retirar en nuestra sucursal de {{3}}. Te esperamos en horario de atención." |
| 7 | `recordatorio_retiro` | Crear | `{{1}}` nombre · `{{2}}` cantidad de días sin retirar · `{{3}}` sucursal | "Hola {{1}}, tu pedido lleva {{2}} días esperándote en la sucursal de {{3}}. Pásate cuando puedas a retirarlo. 😊" |
| 8 | `pago_confirmado` | Crear | `{{1}}` nombre · `{{2}}` número de pedido | "Hola {{1}} ✅ Confirmamos la recepción de tu pago para el pedido #{{2}}. ¡Gracias! Te avisamos en cuanto esté listo." |
| 9 | `solicitud_resena` | Crear | `{{1}}` nombre · `{{2}}` link de reseña | "¡Gracias por tu compra, {{1}}! 🙏 Si quedaste conforme, nos ayudaría muchísimo una reseña en Google: {{2}}" |

##### MARKETING (contacto en frío / promoción — costo más alto)

| # | Nombre técnico | Estado | Variables (orden) | Texto propuesto |
|---|----------------|--------|-------------------|-----------------|
| 10 | `bienvenida_jfnn` | Crear | `{{1}}` nombre | "Hola {{1}} 👋 Te escribimos de Repuestos JFNN. Ahora puedes cotizar repuestos para tu auto directo por WhatsApp. ¿Buscas algo? Cuéntanos marca, modelo y año." |
| 11 | `seguimiento_postventa` | Crear | `{{1}}` nombre | "Hola {{1}}, te escribimos de Repuestos JFNN 🚗 ¿Cómo te fue con el repuesto que compraste? ¿Necesitas algo más? Aquí estamos." |
| 12 | `promocion_general` | Crear | `{{1}}` nombre · `{{2}}` texto de la oferta | "Hola {{1}} 🔧 En Repuestos JFNN tenemos: {{2}}. Escríbenos para más info o para cotizar." |

**Notas sobre `solicitud_resena` (#9):** hoy `whatsapp.service.js` función `sendGoogleReviewRequest` envía texto plano con `GOOGLE_REVIEW_URL`. Esa función **sigue siendo válida dentro de la ventana de 24 h** (post-venta inmediata). La plantilla HSM `solicitud_resena` es la versión para usar **fuera de ventana** (cliente que cerró el ciclo hace días). El backend pasa `GOOGLE_REVIEW_URL` como `{{2}}`.

**Costo (referencia para Felipe):** Meta cobra por conversación iniciada. UTILITY (transaccionales, gatilladas por una acción del negocio) es **notablemente más barato** que MARKETING. Recomendación: usar plantillas UTILITY para todo lo operativo del ciclo de venta; reservar MARKETING (`bienvenida_jfnn`, `seguimiento_postventa`, `promocion_general`) para contacto en frío real y campañas, sin abusar — el spam degrada la calificación de calidad del número.

#### 6.2 — Cableado en el backend (`whatsapp.service.js`)

Reemplazar la constante `TEMPLATES` (hoy una sola entrada) por el catálogo completo. Cada entrada declara `name`, `language`, `category` y el array `params` ordenado (D4 — posicional):

```js
const TEMPLATES = {
    retomar_cotizacion:     { name: 'retomar_cotizacion',     language: 'es_CL', category: 'UTILITY',   params: [] },
    cotizacion_lista:       { name: 'cotizacion_lista',       language: 'es_CL', category: 'UTILITY',
        params: [ { key: 'nombre', label: 'Nombre del cliente' }, { key: 'repuesto', label: 'Repuesto / auto' }, { key: 'precio', label: 'Precio' } ] },
    comprobante_pendiente:  { name: 'comprobante_pendiente',  language: 'es_CL', category: 'UTILITY',
        params: [ { key: 'nombre', label: 'Nombre del cliente' }, { key: 'num_cotizacion', label: 'N° de cotización' } ] },
    encargo_llego:          { name: 'encargo_llego',          language: 'es_CL', category: 'UTILITY',
        params: [ { key: 'nombre', label: 'Nombre del cliente' }, { key: 'sucursal', label: 'Sucursal' } ] },
    saldo_pendiente:        { name: 'saldo_pendiente',        language: 'es_CL', category: 'UTILITY',
        params: [ { key: 'nombre', label: 'Nombre del cliente' }, { key: 'monto', label: 'Monto del saldo' }, { key: 'num_pedido', label: 'N° de pedido' } ] },
    listo_para_retiro:      { name: 'listo_para_retiro',      language: 'es_CL', category: 'UTILITY',
        params: [ { key: 'nombre', label: 'Nombre del cliente' }, { key: 'num_pedido', label: 'N° de pedido' }, { key: 'sucursal', label: 'Sucursal' } ] },
    recordatorio_retiro:    { name: 'recordatorio_retiro',    language: 'es_CL', category: 'UTILITY',
        params: [ { key: 'nombre', label: 'Nombre del cliente' }, { key: 'dias', label: 'Días sin retirar (auto)' }, { key: 'sucursal', label: 'Sucursal' } ] },
    pago_confirmado:        { name: 'pago_confirmado',        language: 'es_CL', category: 'UTILITY',
        params: [ { key: 'nombre', label: 'Nombre del cliente' }, { key: 'num_pedido', label: 'N° de pedido' } ] },
    solicitud_resena:       { name: 'solicitud_resena',       language: 'es_CL', category: 'UTILITY',
        params: [ { key: 'nombre', label: 'Nombre del cliente' }, { key: 'link', label: 'Link de reseña (auto)' } ] },
    bienvenida_jfnn:        { name: 'bienvenida_jfnn',        language: 'es_CL', category: 'MARKETING',
        params: [ { key: 'nombre', label: 'Nombre del cliente' } ] },
    seguimiento_postventa:  { name: 'seguimiento_postventa',  language: 'es_CL', category: 'MARKETING',
        params: [ { key: 'nombre', label: 'Nombre del cliente' } ] },
    promocion_general:      { name: 'promocion_general',      language: 'es_CL', category: 'MARKETING',
        params: [ { key: 'nombre', label: 'Nombre del cliente' }, { key: 'oferta', label: 'Texto de la oferta' } ] },
};
```

> **Compatibilidad:** el fallback de ventana cerrada en `sendTextMessage` referencia `TEMPLATES.REOPEN_24H`. Al reestructurar la constante, actualizar esa referencia a `TEMPLATES.retomar_cotizacion` (o conservar un alias `REOPEN_24H` apuntando a la misma entrada para no tocar `sendTextMessage`). `sendTemplateMessage` ya soporta `bodyParams` posicional (hallazgo #11) — no necesita cambios. Exportar un helper `getTemplate(key)` y `listTemplates()` para que el endpoint del dashboard lea el catálogo.

#### 6.3 — Endpoints del dashboard (`dashboard.routes.js`)

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/templates` | Devuelve el catálogo de `TEMPLATES` (clave, `category`, `params` con `label`). El frontend arma el formulario de variables desde acá. |
| POST | `/conversaciones/:phone/template` | Body `{ template_key, params: {...}, vendedor_nombre, lock_token }`. Valida lock. Resuelve la plantilla con `getTemplate`, mapea `params` al orden declarado, llama `sendTemplateMessage(phone, name, language, [...])`. Registra el saliente en `mensajes` (`autor='vendedor'`, `tipo='text'`, `contenido` = texto renderizado de la plantilla con variables sustituidas, para que el timeline muestre lo enviado). Setea `agente_pausado=true` (D3). |

Para `recordatorio_retiro` y `solicitud_resena` el backend **autocompleta** las variables marcadas "(auto)": `dias` se calcula desde `fecha_listo_retiro` (6.0) y `link` desde `GOOGLE_REVIEW_URL` — el formulario del dashboard muestra esos campos como solo-lectura pre-rellenados.

#### 6.4 — Selector de plantillas en el dashboard

**Archivo a crear:** `dashboard/components/TemplatePicker.tsx` — modal disparado desde el banner de ventana cerrada (Fase 5), desde un botón "Enviar plantilla" siempre disponible en `ChatInput`, y desde el modal de "Nueva conversación" (Fase 8). Flujo:
1. Carga el catálogo vía `GET /templates`.
2. Lista las plantillas agrupadas por categoría (UTILITY / MARKETING), con un aviso "Las plantillas MARKETING tienen mayor costo" sobre el grupo MARKETING.
3. Al elegir una, renderiza un formulario con un input por cada `param` (usando `label`); los `param` "(auto)" llegan pre-rellenados y solo-lectura.
4. Muestra una **previsualización** del texto final con las variables sustituidas antes de enviar.
5. "Enviar" → `POST /conversaciones/:phone/template`.

**Esfuerzo: 11 h** (6.0 persistencia 1 h · 6.2 cableado backend 2 h · 6.3 endpoints 3 h · 6.4 UI selector 5 h). La creación de las 12 plantillas en Meta la hace Felipe en paralelo, no consume horas de desarrollo — solo se contempla la ventana de aprobación (~1 día hábil).

---

### Fase 7 — Respuesta libre del vendedor (backend + UI)

**Objetivo:** input de texto en el chat que envía mensajes al cliente.

**Archivos a modificar:** `backend/routes/dashboard.routes.js` — nuevo endpoint:

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/conversaciones/:phone/responder` | Body `{ texto, vendedor_nombre, lock_token }`. Valida lock (rechaza 409 `locked_by_other` si no coincide — reusa lógica de `PATCH /cotizaciones/estado`). Valida ventana 24 h (si cerrada → 422 `window_closed`, la UI cae al selector de plantillas de Fase 6). Llama `whatsappService.sendSellerMessage`. Persiste el mensaje con `mensajes.service` (`autor='vendedor'`, `autor_nombre`). **Setea `agente_pausado=true`** vía `setAgentePausado` (D3) si era el primer mensaje del vendedor. |

**UI (`ChatTimeline.tsx` / nuevo `ChatInput.tsx`):**
- Input de texto + botón enviar, deshabilitado si la ventana está cerrada (Fase 5) o si otro vendedor tiene el lock. Botón "Enviar plantilla" siempre visible que abre el `TemplatePicker` de Fase 6.
- Al abrir la conversación: claim del lock (`useQuoteLock` reusado), renew cada 4 min, release en cleanup/`beforeunload`.
- Toggle "Pausar agente IA / Devolver al agente IA" — visible al tomar la conversación; usa `PATCH /sessions/:phone/pausa`. Banner "🤖 Agente IA pausado — estás atendiendo tú" cuando `agente_pausado`.

**Concurrencia:** un solo lock por `phone`. El segundo vendedor ve overlay "🔒 Atendiendo: X" e input deshabilitado, igual que en QuoteCard.

**Esfuerzo: 10 h**

---

### Fase 8 — Nueva conversación / escribir a un número nuevo (backend + UI)

**Objetivo:** que el vendedor pueda **iniciar** una conversación con un número que JFNN ya tiene (cliente de tienda física, lista vieja, alguien que dejó su número), sin esperar a que el cliente escriba primero.

**Depende de Fase 6** (D5): técnicamente, "iniciar conversación" es enviar una plantilla HSM aprobada al número — sin catálogo no hay primer mensaje legal. WhatsApp Cloud API **no tiene agenda de contactos**: no se "guarda un contacto", solo se le envía una plantilla y eso crea la conversación.

**Backend — nuevo endpoint en `dashboard.routes.js`:**

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/conversaciones/iniciar` | Body `{ telefono, nombre, sucursal, template_key, params, vendedor_nombre }`. Ver flujo abajo. |

Flujo del endpoint:
1. **Normaliza y valida el número** a formato E.164 chileno (`+56 9 XXXX XXXX` → `569XXXXXXXX`). Rechaza 422 `numero_invalido` si no calza el patrón móvil chileno.
2. **Chequea sesión existente:** si ya hay fila en `user_sessions` para ese `phone`, NO duplica — responde 200 con `{ ya_existe: true, phone }` y la UI abre la conversación existente en `/conversaciones/:phone` (ver "Caso borde" abajo).
3. **Envía la plantilla** vía `sendTemplateMessage` (resuelta con `getTemplate`, params mapeados al orden del catálogo). Si Meta rechaza el envío (plantilla no aprobada, número inválido para Meta, etc.) → 502 `envio_fallido`, no se crea sesión.
4. **Crea la sesión** en `user_sessions`: estado inicial `PERFILANDO` (la conversación arranca como cualquier otra; cuando el cliente responda, Gemini perfila normal). Setea `sucursal` con la elegida en el formulario (a diferencia del flujo reactivo, aquí el vendedor ya la conoce — no espera a `derivarSucursal`). Setea `vendedor_nombre` con quien inició. `agente_pausado` queda en `false` — la IA atiende cuando el cliente responda; si el vendedor quiere atender él mismo, pausa desde el chat (Fase 7).
5. **Registra el saliente** en `mensajes`: `autor='vendedor'`, `autor_nombre`, `tipo='text'`, `contenido` = texto renderizado de la plantilla, `sucursal`.
6. **Crea/actualiza el perfil en `clientes`** (ver abajo).

**Conexión con la tabla `clientes`** (hallazgo #13 — PK `phone`):
- Si el `phone` **no existe** en `clientes` → `INSERT` con `phone` y `nombre` (los demás campos quedan en su default; `es_recurrente=false`, `total_compras=0`).
- Si **ya existe** → `UPDATE` del `nombre` solo si el actual está vacío (no se pisa un nombre ya conocido), `updated_at=NOW()`.
- La tabla `clientes` **no tiene columna `sucursal`** — la sucursal vive en `user_sessions`/`pedidos`. No se agrega columna: un cliente puede comprar en ambas tiendas; la sucursal es por venta, no por cliente.
- Idempotente: `INSERT ... ON CONFLICT (phone) DO UPDATE`.

**UI — `dashboard/`:**
- Botón **"+ Nueva conversación"** en la cabecera de `app/conversaciones/page.tsx`.
- Nuevo `components/NuevaConversacionModal.tsx`: formulario con
  - **Teléfono** — input con máscara/validación de formato chileno (`+56 9 ...`); error inline si no calza.
  - **Nombre del cliente** — texto.
  - **Sucursal** — selector Melipilla / San Felipe. Para el vendedor con sucursal fija en el JWT, viene pre-seleccionada y bloqueada; el admin elige.
  - **Plantilla** — reusa el `TemplatePicker` de Fase 6 embebido: elige plantilla y rellena variables, con previsualización.
- Al enviar: `POST /conversaciones/iniciar`. Si responde `ya_existe: true`, el modal se cierra y navega a la conversación existente con un toast "Ya existe una conversación con este número — abriéndola".

**Caso borde — número con sesión activa:** cubierto en el paso 2 del endpoint. No se duplica sesión ni se reenvía plantilla; se redirige a la conversación existente. Esto evita gastar una conversación HSM de más y evita el desconcierto de "tengo dos chats con el mismo cliente".

**Fuera de alcance — envío masivo:** Felipe pidió de a un número por vez. El bulk (cargar una lista y disparar plantillas en lote) queda fuera de este plan por riesgo de spam y de degradar la calificación de calidad del número en Meta (lo que baja el límite diario de mensajes). Se evalúa a futuro como REQ aparte, con rate-limiting y opt-out.

**Esfuerzo: 8 h** (endpoint + validación número + integración `clientes` 4 h · modal UI 4 h — el `TemplatePicker` ya existe de Fase 6).

---

### Fase 9 — Llamadas perdidas (prioridad baja)

**Objetivo:** respuesta automática mínima ante eventos de llamada.

El número de JFNN queda solo-chat (decisión tomada). Si Meta entrega un evento de llamada perdida por webhook, el handler responde con un texto automático: "Este número atiende solo por chat 💬. Escríbenos por aquí y te ayudamos." Si Meta no entrega tal evento en el tier actual, esta fase se omite sin impacto. **No se desarrolla a fondo.**

**Archivos a modificar:** `backend/controllers/whatsapp.controller.js` — rama adicional en `receiveMessage` para el tipo de evento de llamada, si existe.

**Esfuerzo: 1 h**

---

### Fase 10 — Auditoría de seguridad OWASP (gate obligatorio)

**Objetivo:** auditar todo el código nuevo de REQ-04 contra OWASP Top 10 antes de exponerlo en producción. Es un **gate bloqueante**: la migración del número productivo (Fase 11) no procede hasta que esta auditoría esté verde o sus hallazgos críticos/altos estén remediados.

REQ-04 abre superficie de ataque nueva y sensible — por eso esta fase no es opcional. La ejecuta el agente `security-auditor`.

**Alcance de la auditoría (mapeado a OWASP Top 10):**
- **A01 Broken Access Control / IDOR** — `GET /conversaciones/:phone`, `POST /conversaciones/:phone/responder`, `/template`, `/iniciar`: ¿un vendedor de Melipilla puede leer o responder conversaciones de San Felipe manipulando el `phone` de la URL? El filtrado por sucursal debe validarse **server-side** contra el JWT, no confiar en el front.
- **A03 Injection** — todas las queries de `mensajes.service.js` y los endpoints nuevos deben ser parametrizadas; el texto libre del vendedor y las variables de plantilla no deben permitir inyección.
- **A01/A04 Exposición de media** — las URLs firmadas de Supabase Storage: expiración corta, no adivinables, bucket privado. Los comprobantes de pago son datos sensibles (R6).
- **A02 Datos sensibles** — la tabla `mensajes` guarda PII (teléfonos, contenido de conversaciones, comprobantes). Revisar logs (que no impriman PII de más), y acceso.
- **A07 Auth** — los endpoints nuevos deben exigir JWT válido; el webhook debe validar la firma `X-Hub-Signature-256` (hoy `META_APP_SECRET` está en modo dev permisivo — la auditoría debe exigir activarlo).
- **A05 Misconfiguration** — el endpoint de respuesta libre y el de `/iniciar` no deben poder usarse para spam; rate limiting si corresponde.
- **A08/A10** — validación del payload del webhook; SSRF al descargar media desde URLs de Meta.

**Salida:** informe de hallazgos clasificados (crítico / alto / medio / bajo). Críticos y altos se remedian antes de la Fase 11. Medios/bajos se documentan como deuda con ticket.

**Esfuerzo: 4 h auditoría + buffer de remediación variable según hallazgos (estimado 2-6 h).**

---

### Fase 11 — Migración del número productivo

**Objetivo:** una vez QA-validado el Centro de Conversaciones y aprobada la auditoría OWASP, migrar el número real de JFNN.

Esta fase **es la Fase de migración de `docs/PLAN_OPCION_A_EJECUCION.md`** (sección 7) — no se reescribe aquí. Pasos clave: backup de los chats de la app de WhatsApp Business antes de migrar (`whatsapps/backup_pre_migracion_<fecha>/`), aviso a vendedores del downtime, flujo OTP en Cloud API, cambiar `WHATSAPP_PHONE_ID` en Railway, smoke test. Hacerlo en horario de baja actividad.

**Precondición dura:** Fases 1-8 desplegadas y QA-OK, **Fase 10 (auditoría OWASP) aprobada con críticos/altos remediados**, y las 12 plantillas HSM aprobadas por Meta. No migrar antes — sin el Centro de Conversaciones el vendedor queda ciego, sin las plantillas aprobadas no puede contactar clientes fuera de ventana, y sin la auditoría se expondría PII y comprobantes de pago en producción.

**Esfuerzo: 1 h (+ ventana de espera OTP) — ver PLAN_OPCION_A_EJECUCION.md sección 7.**

---

## Estimación de esfuerzo

| Fase | Descripción | Horas |
|------|-------------|-------|
| 1 | Persistencia de mensajes (backend) | 6 |
| 2 | Storage persistente + multimedia | 8 |
| 3 | Endpoints de lectura | 5 |
| 4 | Vista de chat (UI lectura) | 12 |
| 5 | Indicador ventana 24 h | 4 |
| 6 | Catálogo de plantillas HSM (Meta + backend + UI) | 11 |
| 7 | Respuesta libre del vendedor | 10 |
| 8 | Nueva conversación / contacto en frío | 8 |
| 9 | Llamadas perdidas | 1 |
| 10 | Auditoría de seguridad OWASP (gate) | 4 + remediación 2-6 |
| 11 | Migración número productivo | 1 |
| | **Total** | **~71-75 h** |

Buffer recomendado +20 % (QA, ajustes de UI, imprevistos de Supabase Storage) → **~85-90 h** de presupuesto realista. La remediación de la Fase 10 es variable: si la auditoría no encuentra hallazgos críticos/altos, el total queda en el extremo bajo.

> Las Fases 6 y 8 suman **+19 h** de desarrollo sobre el plan original de 47 h. No incluye el tiempo de Felipe creando las 12 plantillas en WhatsApp Manager (configuración manual, en paralelo) ni la ventana de aprobación de Meta (~1 día hábil por lote) — esa espera es calendario, no esfuerzo de desarrollo, pero condiciona la fecha de la Fase 11.

---

## Riesgos técnicos y mitigación

| # | Riesgo | Impacto | Mitigación |
|---|--------|---------|------------|
| R1 | La persistencia de mensajes rompe el flujo de Gemini / clasificación de comprobantes. | Alto — el core de negocio deja de cotizar. | La escritura en `mensajes` es aditiva y no condiciona el flujo. Se inserta con manejo de error aislado (`try/catch` propio) — si el INSERT falla, se loguea y el flujo de Gemini continúa. Fases 1-2 se despliegan y observan en prod antes de tocar UI. |
| R2 | Costo de Supabase Storage crece sin control (clientes mandan muchos videos/imágenes). | Medio — factura sube. | Volumen estimado ~0,5 GB/mes (despreciable). Mitigación dura: política de retención — job que mueve a cold/borra media >90 días de pedidos archivados. Límite de tamaño al descargar (rechazar media >16 MB, límite de Meta). |
| R3 | Costo de tokens al transcribir audio / procesar video con Gemini. | Medio. | Audio: la transcripción es marginal cero — el audio YA se envía a Gemini para extraer entidades, solo se pide un campo extra en el JSON. Video: **no se manda a Gemini** — se guarda y se notifica al vendedor; procesar video es caro y de bajo valor para este caso de uso. |
| R4 | Ventana de 24 h: el vendedor escribe creyendo que llega y Meta lo rechaza. | Alto — cliente nunca recibe la respuesta. | Backend calcula `ventana_abierta` con el último mensaje entrante real de la tabla `mensajes`; la UI deshabilita el input y fuerza el template HSM cuando está cerrada. El endpoint `/responder` revalida server-side (422 `window_closed`) — la UI no es la única defensa. |
| R5 | Concurrencia: la IA responde encima del vendedor, o dos vendedores responden a la vez. | Alto — cliente recibe mensajes contradictorios. | IA: al primer mensaje del vendedor se setea `agente_pausado=true` (reusa mecanismo existente, `whatsapp.controller.js:222` ya silencia). Vendedores: lock pesimista único por `phone` (reusa `useQuoteLock` + `lock_token`); el segundo vendedor ve overlay e input bloqueado. |
| R6 | URLs públicas de media exponen comprobantes de pago (datos sensibles) a cualquiera con el link. | Alto — fuga de datos de pago. | No usar `express.static` ni bucket público. Bucket `whatsapp-media` privado; el backend genera URLs firmadas con expiración de 1 h. Se elimina la dependencia de `/uploads` estático para media nueva. |
| R7 | El `return` en `whatsapp.controller.js:224` (modo pausa) saltaría también la persistencia si se agrega ingenuamente dentro de `processBufferedMessages`. | Medio — se pierden mensajes entrantes mientras el vendedor atiende manualmente, justo cuando más se necesitan. | La persistencia del entrante se hace en `receiveMessage` (webhook), **antes** del debounce y antes de cualquier chequeo de pausa — no en `processBufferedMessages`. Así todo mensaje entrante queda registrado aunque la IA esté pausada. |
| R8 | Disco efímero de Railway: imágenes ya guardadas (comprobantes) se pierden en el próximo deploy. | Medio — vendedor no puede revisar un comprobante reciente. | La Fase 2 corta la sangría a futuro (Supabase Storage). Para lo ya guardado no hay recuperación posible — se asume pérdida y se comunica. La migración debe coordinarse con un deploy para minimizar la ventana de archivos en disco viejo. |
| R9 | Webhook reintentado por Meta duplica mensajes en el timeline. | Bajo — UI confusa. | Índice único `idx_mensajes_wa_id` sobre `wa_message_id`; INSERT con `ON CONFLICT DO NOTHING`. |
| R10 | Meta rechaza una o varias plantillas del catálogo en revisión. | Medio — la plantilla rechazada no se puede usar; el vendedor no puede contactar en ese caso de uso. | Las 12 plantillas se crean con tiempo (Fase 6 puede arrancar antes en calendario). Textos propuestos son sobrios, sin promesas ni lenguaje promocional agresivo (causa típica de rechazo). El selector (`GET /templates`) puede filtrar por plantillas efectivamente aprobadas; si una falta, simplemente no aparece en la lista y el resto del catálogo funciona. Felipe ajusta y reenvía la rechazada según el motivo que devuelve Meta. |
| R11 | Número marcado como spam / baja calificación de calidad en Meta por uso de plantillas MARKETING o contacto en frío. | Alto — Meta baja el límite diario de mensajes; en el extremo, bloqueo del número. | Sin bulk (D5, Fase 8 fuera de alcance). UI advierte el mayor costo/riesgo de las plantillas MARKETING. Recomendación de uso: MARKETING solo a clientes reales que dejaron su número, no a listas frías compradas. Monitorear la "calidad del número" en WhatsApp Manager tras los primeros envíos. |
| R12 | La fecha de "listo para retiro" no está persistida hoy → `recordatorio_retiro` no puede calcular los días. | Medio — la plantilla quedaría sin su variable clave o mostraría un valor erróneo. | Sub-tarea 6.0: columna `fecha_listo_retiro` en `user_sessions`, seteada por `setEstado` al entrar a `ESPERANDO_RETIRO`. Pedidos que ya estaban en `ESPERANDO_RETIRO` antes de la migración tendrán `fecha_listo_retiro NULL`: el backend, si la fecha es `NULL`, cae a `ultimo_mensaje` como aproximación y loguea el caso; afecta solo a los pedidos en vuelo al momento del deploy. |
| R13 | "Nueva conversación" crea una sesión duplicada para un número que ya tenía conversación activa. | Medio — dos chats del mismo cliente, lock y estado divergentes. | El endpoint `/conversaciones/iniciar` chequea `user_sessions` por `phone` antes de crear (paso 2); si existe, no duplica y redirige a la conversación existente. `phone` es UNIQUE en `user_sessions` — un INSERT duplicado fallaría igual a nivel DB, el chequeo previo solo da mejor UX. |
| R14 | Número mal tipeado en "Nueva conversación" → se gasta una conversación HSM (costo) y/o se contacta a un desconocido. | Bajo-Medio — costo menor + mensaje a número equivocado. | Validación estricta de formato móvil chileno en frontend y revalidación server-side (422 `numero_invalido`). Previsualización del texto de la plantilla antes de enviar. El nombre del cliente en el texto ayuda a que un destinatario equivocado note el error sin exponer datos sensibles. |

---

## Orden de QA

QA tras cada bloque, no todo al final.

1. **Fases 1-2 (backend, sin UI):** enviar al número de prueba texto, imagen (comprobante y pieza), audio, video y documento. Verificar en Supabase: filas en `mensajes` con tipo/autor/sucursal/`wa_message_id` correctos; media subida a `whatsapp-media`; transcripción presente en audios. Confirmar que **el flujo de cotización y la clasificación de comprobantes siguen intactos** (regresión crítica — R1).
2. **Fase 3:** golpear `/conversaciones` como vendedor Melipilla, vendedor San Felipe y admin — verificar filtrado por sucursal y que las conversaciones `sucursal NULL` aparecen en el pool común. URLs firmadas funcionan y expiran.
3. **Fase 4:** abrir `/conversaciones` en el dashboard, verificar timeline cronológico, distinción visual cliente/IA/vendedor, visor de imagen, player de audio con transcripción, player de video. Polling refresca a los ~4 s.
4. **Fase 5:** conversación con último entrante >24 h → input deshabilitado, banner ámbar, botón "Enviar plantilla". Conversación reciente → input habilitado.
5. **Fase 6 (catálogo HSM):** confirmar que las 12 plantillas figuran "Aprobadas" en WhatsApp Manager. `setEstado` a `ESPERANDO_RETIRO` setea `fecha_listo_retiro` (verificar en Supabase). `GET /templates` devuelve el catálogo con `params` y `category`. Abrir el `TemplatePicker`: elegir cada plantilla, rellenar variables, ver previsualización. Enviar `cotizacion_lista` y `recordatorio_retiro` al número de prueba (esta última con la ventana cerrada, para validar que la plantilla pasa fuera de ventana y que `dias` se calcula bien). Verificar que el saliente queda en `mensajes` con el texto renderizado. Probar una plantilla UTILITY y una MARKETING.
6. **Fase 7 (respuesta libre):** vendedor A toma una conversación → IA se pausa (mandar un mensaje del cliente y confirmar que Gemini NO responde). Vendedor B abre la misma → overlay "🔒 Atendiendo: A". Enviar texto libre dentro de ventana → llega al WhatsApp de prueba y se persiste con `autor=vendedor`. Toggle "Devolver al agente IA" → Gemini vuelve a responder.
7. **Fase 8 (nueva conversación):** desde `/conversaciones` → "+ Nueva conversación". Probar: número con formato inválido → error inline. Número válido nuevo → se envía plantilla, se crea sesión `PERFILANDO` con la sucursal elegida, fila en `clientes`, mensaje saliente en `mensajes`. Repetir con un número que YA tiene sesión activa → no duplica, redirige a la existente con toast. Verificar que un número ya presente en `clientes` reusa el perfil sin pisar el nombre.
8. **Regresión global:** correr `cd backend && npm test`; `cd dashboard && npm run lint` (0 errores). Ciclo completo de cotización + POR_ENCARGO + multi-sucursal sin romper. Confirmar que el fallback de ventana cerrada en `sendTextMessage` sigue funcionando tras reestructurar `TEMPLATES`.
9. **Fase 10 (auditoría OWASP):** el `security-auditor` corre el informe; verificar que los hallazgos críticos/altos quedaron remediados y re-auditados antes de habilitar la Fase 11.
10. **Fase 11:** solo tras 1-8 verde, auditoría OWASP aprobada y las 12 plantillas aprobadas. Smoke test post-migración del número productivo según `PLAN_OPCION_A_EJECUCION.md` 7.

---

## Checklist final

### Backend — persistencia y multimedia
- [ ] Tabla `mensajes` creada en `init.sql` y aplicada a prod vía MCP Supabase `apply_migration`
- [ ] `mensajes.service.js` creado (registrar/listar, queries parametrizadas, logging `[Mensajes]`)
- [ ] Persistencia de entrantes en `receiveMessage` (antes del debounce y del chequeo de pausa)
- [ ] Persistencia de salientes IA en `processBufferedMessages`
- [ ] Bucket `whatsapp-media` privado creado en Supabase
- [ ] `storage.service.js` migrado a Supabase Storage (imágenes + `uploadAudio`/`uploadVideo`/`uploadDocument`)
- [ ] Filtro de webhook ampliado a `['text','image','audio','video','document']`
- [ ] Transcripción de audio guardada en `mensajes.transcripcion`
- [ ] Índice único `wa_message_id` + `ON CONFLICT DO NOTHING` (dedupe de reintentos)

### Backend — endpoints
- [ ] `GET /conversaciones` (filtro por sucursal JWT + pool `sucursal NULL`)
- [ ] `GET /conversaciones/:phone` (timeline paginado, URLs firmadas)
- [ ] `POST /conversaciones/:phone/responder` (valida lock + ventana 24 h, persiste, auto-pausa IA)
- [ ] `ventana_abierta` calculado y expuesto en los endpoints de conversación

### Catálogo de plantillas HSM (Fase 6)
- [ ] Columna `fecha_listo_retiro` en `user_sessions` (init.sql + `apply_migration`)
- [ ] `setEstado` setea `fecha_listo_retiro = NOW()` al entrar a `ESPERANDO_RETIRO` (idempotente)
- [ ] Las 12 plantillas creadas en WhatsApp Manager y **aprobadas por Meta** (trabajo manual de Felipe)
- [ ] Constante `TEMPLATES` ampliada con las 12 entradas (`name`, `language`, `category`, `params`)
- [ ] Referencia de fallback en `sendTextMessage` actualizada (alias `REOPEN_24H` o `TEMPLATES.retomar_cotizacion`)
- [ ] Helpers `getTemplate(key)` / `listTemplates()` exportados
- [ ] `GET /templates` (catálogo) y `POST /conversaciones/:phone/template` (envío, autocompleta `dias` y `link`)
- [ ] `TemplatePicker.tsx` con formulario de variables, campos "(auto)" solo-lectura y previsualización

### Nueva conversación / contacto en frío (Fase 8)
- [ ] `POST /conversaciones/iniciar` (valida número CL, dedupe sesión, envía plantilla, crea sesión + `clientes`, registra saliente)
- [ ] Integración con tabla `clientes` (INSERT/UPDATE idempotente por `phone`, sin pisar nombre)
- [ ] `NuevaConversacionModal.tsx` (teléfono validado, nombre, sucursal, `TemplatePicker` embebido)
- [ ] Botón "+ Nueva conversación" en `app/conversaciones/page.tsx`
- [ ] Caso borde: número con sesión activa → no duplica, redirige a la existente

### Auditoría de seguridad OWASP (Fase 10 — gate)
- [ ] `security-auditor` ejecutó el informe sobre todo el código nuevo de REQ-04
- [ ] Control de acceso por sucursal validado server-side en todos los endpoints `/conversaciones/*` (sin IDOR)
- [ ] URLs firmadas de Supabase Storage: expiración corta, bucket privado, comprobantes no expuestos
- [ ] `META_APP_SECRET` activo en Railway — webhook valida firma `X-Hub-Signature-256` (sale del modo dev permisivo)
- [ ] Hallazgos críticos y altos remediados y re-auditados
- [ ] Hallazgos medios/bajos documentados como deuda técnica con ticket

### Dashboard
- [ ] `app/conversaciones/page.tsx` + entrada en el nav
- [ ] `ConversacionesList.tsx`, `ChatTimeline.tsx`, `MediaViewer.tsx`, `ChatInput.tsx`
- [ ] Distinción visual cliente / agente IA / vendedor
- [ ] Visor de imagen, player de audio (con transcripción), player de video
- [ ] Polling 4 s en lista y timeline (sin WebSockets)
- [ ] Banner de ventana 24 h cerrada + acceso al `TemplatePicker`
- [ ] Lock de conversación reusando `useQuoteLock` + overlay "🔒 Atendiendo: X"
- [ ] Toggle "Pausar / Devolver agente IA"

### Calidad y cierre
- [ ] `npm test` (backend) y `npm run lint` (dashboard, 0 errores) pasan
- [ ] Regresión: cotización + POR_ENCARGO + multi-sucursal intactos (R1)
- [ ] Regresión: fallback de ventana cerrada sigue OK tras reestructurar `TEMPLATES`
- [ ] QA por bloques completado (orden de QA arriba)
- [ ] Política de retención de media >90 días definida (R2)
- [ ] Conventional Commits + PR template seguidos
- [ ] **Solo entonces:** Fase 11 — migración del número productivo (`PLAN_OPCION_A_EJECUCION.md` 7)
