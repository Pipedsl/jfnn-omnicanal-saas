# PLAN OPCIÓN A — Cloud API directa de Meta (Limited Access)

**Estado:** ✅ **EJECUTADO Y FUNCIONANDO** (2026-05-18). Canal WhatsApp activo con número de prueba.
**Documento padre:** `docs/PLAN_B_META_RECHAZO.md`
**Fallback definido:** Twilio (Opción C) — saltar B. NO fue necesario.
**Verificación Meta:** en curso en paralelo (no se cancela, pero ya NO es bloqueante).

---

## ✅ RESULTADO DE LA EJECUCIÓN (2026-05-18)

El canal WhatsApp Cloud API quedó **operativo en modo Live sin Business Verification** (tier Limited Access). Validado end-to-end: cliente envía mensaje → webhook Railway → Gemini → respuesta al cliente.

**Datos de la integración (chip de prueba):**
| Recurso | Valor |
|---|---|
| App Meta | `RepuestosOmnicanal` — App ID `2553364111727691` |
| WABA (cuenta WhatsApp) | `repuestos jfnn` — ID `1003088295416438` |
| Phone ID (chip prueba) | `1066882779849103` — número `+56 9 5082 8842` |
| System User | `jfnnbackendapi` — ID `61589691377300` |
| Token | Permanente (sin expiración), generado vía System User, en Railway `WHATSAPP_ACCESS_TOKEN` |
| Webhook | `https://jfnn-backend-production.up.railway.app/api/whatsapp/webhook` |
| Estado app Meta | **Live / Publicada** |

**Confirmado:** sin Business Verification el negocio puede operar indefinidamente. Límite Limited Access (250 conversaciones business-initiated/24h) no afecta a JFNN porque el flujo es customer-initiated. Cero riesgo de ban.

**Pendiente futuro (NO urgente):**
1. Cuando Meta apruebe la verificación → migrar el **número productivo** de JFNN (mismo flujo OTP, backup de chats antes, cambiar `WHATSAPP_PHONE_ID` en Railway).
2. Auditar las 4 WABAs duplicadas y eliminar las que no se usen.
3. Configurar `META_APP_SECRET` en Railway para validar firma X-Hub-Signature-256 (hoy en modo dev permisivo).

**Notas de ejecución (lo que difirió del plan):**
- Se usó **Railway prod directo** en vez de ngrok local (decisión de Felipe — más rápido, sin clientes reales en riesgo).
- Se saltó el test de `hello_world` desde Meta (requiere método de pago; el flujo real de JFNN es customer-initiated → se validó directo con flujo real, gratis).
- El System User requiere rol **"Administrar app"** sobre la app + WABA asignada con **Control total** para poder generar tokens. "Desarrollar app" no alcanza.
- Hay 4 WABAs en el Business Manager; la correcta es `repuestos jfnn` (minúsculas) ID `1003088295416438`. Cuidado al asignar activos.

---

## 1. Objetivo y alcance

Activar el canal WhatsApp del agente JFNN sin esperar a la Business Verification de Meta, usando la cuenta **Limited Access** de WhatsApp Cloud API. La estrategia es validar el flujo end-to-end con un **número de prueba** (chip nuevo o virtual) y, una vez verde el camino feliz incluyendo POR_ENCARGO y multi-sucursal, **migrar el número productivo** de JFNN al mismo backend. Se mantiene 1 número compartido para ambas sucursales. Si Meta bloquea el onboarding sin verificación, se aborta y se ejecuta el fallback Twilio.

---

## 2. Fase 0 — Prerrequisitos (Felipe, antes de empezar)

### 2.1 Cuentas y accesos
1. **Cuenta Meta for Developers** → personal (Facebook personal de Felipe). NO crear con la cuenta de empresa porque la verificación que está pendiente vive ahí y queremos no contaminar ese flujo. La app nueva se crea con cuenta personal y se asocia al **mismo Business Manager** donde está el negocio JFNN ya cargado, pero como un proyecto separado.
2. **Acceso admin al Meta Business Manager existente** (https://business.facebook.com) donde está cargada COMERCIAL E INDUSTRIAL JFNN SPA. Confirmar que Felipe es admin.
3. **Acceso admin a Railway** (proyecto `jfnn-omnicanal-saas` con root `backend/`).
4. **Acceso al repo** local + permisos push a `main`.

### 2.2 Número de prueba (NO el productivo)
Necesitás un número **sin WhatsApp activo** (ni Business ni personal) en los últimos 7 días, capaz de recibir SMS y llamada de voz para OTP.

**Opciones recomendadas en Chile (ordenadas por costo y velocidad):**
1. **Chip prepago físico** — Entel, Movistar, WOM o Claro (~CLP 3.000–5.000). Comprar en cualquier kiosko, registrar con cédula, esperar 5 min activación. Más confiable para OTP.
2. **Número virtual SMS** — servicios tipo `smspool.net`, `sms-activate.org` (USD 1–3 por número Chile). Riesgo: a veces Meta los detecta como VoIP y rechaza. Usar solo como segunda opción.
3. **Línea fija con SMS o llamada** — si Felipe tiene una línea fija con voz y nadie la usa, Meta puede mandar la OTP por llamada. Funciona pero es engorroso.

**Recomendación:** chip prepago WOM o Entel. Total ~CLP 3.000. 30 minutos.

### 2.3 Herramientas locales
- `node` ≥ 20 (ya presente)
- `ngrok` instalado y autenticado, o `cloudflared` (recomendamos ngrok por facilidad — ver Fase 2.3)
- `openssl` (viene con macOS)
- `curl`

---

## 3. Fase 1 — Setup en Meta for Developers (12 pasos)

URL base: https://developers.facebook.com

1. **Login** en https://developers.facebook.com con cuenta personal de Felipe.
2. **Aceptar Platform Terms** si es la primera vez (lo pide un banner). Si pide número de teléfono para 2FA, agregarlo (puede ser el celular personal de Felipe — no es el número del bot).
3. **Crear App** → botón "My Apps" → "Create App".
   - Casos de uso: seleccionar **"Other"** (importante: NO elegir "Authenticate and request data from users" que es para Login).
   - Tipo de app: **"Business"**.
   - Nombre: `JFNN Omnicanal Dev` (o el que prefiera Felipe; lo va a ver él solo).
   - Email de contacto: el suyo.
   - **Business Account:** seleccionar el Business Manager existente de JFNN. Esto vincula la app al negocio ya cargado y permite usar el mismo WABA cuando lleguemos al número productivo. Si Meta pide crear uno nuevo, crearlo con nombre `JFNN Dev` — no usar el de producción.
4. **Agregar producto WhatsApp** → en el panel de la app, sección "Add products to your app", buscar "WhatsApp" → "Set up".
5. **Crear o seleccionar WABA (WhatsApp Business Account)** → Meta abre wizard. Elegir "Create new WhatsApp Business Account" si pregunta. Nombre: `JFNN Dev WABA`.
6. **Confirmar Limited Access** → en `WhatsApp → Getting Started` debe aparecer un banner del estilo "You can send messages to up to 250 unique customers in a 24-hour period" y un panel para agregar números. **Anotar este banner como evidencia.** Limites Limited Access:
   - 250 conversaciones únicas iniciadas / 24h
   - Hasta 2 números de teléfono por WABA
   - Templates HSM deben ser aprobados igual (pueden usarse plantillas pre-aprobadas como `hello_world` para test)
   - **No requiere Business Verification** para operar dentro de estos límites.
7. **Anotar `WABA_ID`** → visible en la URL del panel o en "WhatsApp Manager → Account tools → Overview". Formato: 15-16 dígitos. Guardarlo en notas seguras.
8. **Agregar número de teléfono de prueba** → `WhatsApp → API Setup` o `Phone Numbers → Add phone number`.
   - Ingresar el número con código de país (`+56 9 XXXX XXXX`).
   - Display name: `JFNN Test` (puede cambiarse después).
   - Categoría: `Automotive`.
   - **Recibir OTP** → SMS o llamada. Meta envía un código de 6 dígitos. Ingresarlo.
   - Si el OTP no llega en 5 min, pedir reenvío. Si falla 3 veces, ver Sección 12 (Riesgos).
9. **Anotar `WHATSAPP_PHONE_ID`** → al verificarse, Meta muestra el "Phone number ID" (15-16 dígitos). NO es el número de teléfono — es un ID interno. Guardarlo.
10. **Generar token temporal (24h)** → `WhatsApp → API Setup → Temporary access token`. Copiar. Sirve para los primeros tests; expira en 24 horas. Anotarlo como `WHATSAPP_ACCESS_TOKEN_TEMP`.
11. **Test inicial desde la UI de Meta** → en `API Setup`, hay un botón "Send message" que envía el template `hello_world` al número de prueba del propio Felipe. Confirmar que llega al WhatsApp del celular de Felipe (no del número de prueba — del suyo personal, como receptor). Si llega, **el setup está vivo**.
12. **Generar token permanente (System User)** — se hace una vez que el flujo está validado, pero conviene dejar listo el camino:
    - Business Manager → `Settings → Users → System Users → Add`.
    - Nombre: `jfnn-omnicanal-bot`, rol: Admin.
    - "Generate Token" → seleccionar la app creada → permisos: `whatsapp_business_messaging`, `whatsapp_business_management`.
    - Token expiration: **Never**.
    - Copiar y guardar como `WHATSAPP_ACCESS_TOKEN` definitivo.
    - Asignar al System User el WABA: `Business Settings → WhatsApp Accounts → seleccionar WABA → Add People → seleccionar el System User → permisos completos`.

**Anotar también `META_APP_ID` y `META_APP_SECRET`** → `Settings → Basic` de la app. El App Secret aparece tras click en "Show" + password. Estos son necesarios para validar la firma X-Hub-Signature-256 que ya valida el backend (ver `backend/controllers/whatsapp.controller.js:16`).

**Variables que terminan en mano de Felipe al cierre de Fase 1:**
- `WHATSAPP_PHONE_ID` (del número de prueba)
- `WHATSAPP_BUSINESS_ACCOUNT_ID` (WABA_ID)
- `WHATSAPP_ACCESS_TOKEN` (System User, permanente)
- `META_APP_ID`
- `META_APP_SECRET`

---

## 4. Fase 2 — Configuración del backend (local primero)

### 4.1 Auditar nombres reales de env vars
El backend usa estos nombres exactos (verificado contra `backend/services/whatsapp.service.js` y `backend/controllers/whatsapp.controller.js`):

| Variable | Usado en | Notas |
|---|---|---|
| `WHATSAPP_PHONE_ID` | service.js:26, 127 | Phone Number ID, no el número |
| `WHATSAPP_ACCESS_TOKEN` | service.js:39, 141, 172, 179 | System User token |
| `WHATSAPP_VERIFY_TOKEN` | controller.js:66 | String que vos inventás, debe coincidir con lo que pongas en la consola Meta |
| `META_APP_SECRET` | controller.js:16-22 | Para validar firma X-Hub-Signature-256 |
| `META_APP_ID` | .env.example:26 | Para referencia, no se valida en runtime |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | .env.example:23 | Para referencia/management |
| `WHATSAPP_API_VERSION` | service.js:9 | Default `v21.0` |
| `WHATSAPP_DEBOUNCE_MS` | controller.js:80 | Dev=5000, prod=20000 |

### 4.2 Crear `.env.local`
```bash
cd /Users/felipenavarretenavarrete/Desktop/RepuestosJFNN/jfnn-omnicanal-saas/backend
cp .env.example .env.local
```

Editar `.env.local` y setear:
```
WHATSAPP_PHONE_ID=<phone_number_id de Fase 1.9>
WHATSAPP_ACCESS_TOKEN=<token permanente de Fase 1.12>
WHATSAPP_VERIFY_TOKEN=<generar con: openssl rand -hex 16>
META_APP_SECRET=<de Fase 1>
META_APP_ID=<de Fase 1>
WHATSAPP_BUSINESS_ACCOUNT_ID=<WABA_ID de Fase 1.7>
WHATSAPP_API_VERSION=v21.0
WHATSAPP_DEBOUNCE_MS=5000
NODE_ENV=development
```

Generar el verify token:
```bash
openssl rand -hex 16
```
Copiar el output (32 chars hex) como `WHATSAPP_VERIFY_TOKEN`.

### 4.3 Exponer backend local — ngrok vs cloudflared

**Recomendamos ngrok** porque (a) tiene dominio estable con plan gratuito (subdomain reservado), (b) UI web `localhost:4040` para inspeccionar requests del webhook en tiempo real (clave para debugging del handshake), (c) latencia menor desde Chile. Cloudflared sirve pero exige dominio propio configurado para URLs estables.

Setup ngrok:
```bash
# Si no está instalado:
brew install ngrok/ngrok/ngrok

# Autenticar (token gratis en dashboard.ngrok.com):
ngrok config add-authtoken <tu_token>

# Levantar backend
cd /Users/felipenavarretenavarrete/Desktop/RepuestosJFNN/jfnn-omnicanal-saas
npm run dev  # o solo cd backend && npm run dev

# En otra terminal: exponer puerto 4000
ngrok http 4000
```

Output ngrok: copiar la URL `https://xxxx-xxxx.ngrok-free.app`. Es la base del webhook.

### 4.4 Configurar webhook en Meta Console

1. En Meta App → `WhatsApp → Configuration → Webhook`.
2. Click "Edit" en Callback URL.
3. **Callback URL:** `https://<tu-ngrok-url>.ngrok-free.app/api/whatsapp/webhook`
4. **Verify token:** pegar el `WHATSAPP_VERIFY_TOKEN` del .env.local.
5. Click "Verify and Save". Meta dispara GET con `hub.mode=subscribe&hub.verify_token=...&hub.challenge=...`. El controller responde el challenge si el token matchea (`backend/controllers/whatsapp.controller.js:66`).
6. Si falla: confirmar que el backend está vivo (`curl http://localhost:4000/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=<token>&hub.challenge=ping` debería devolver `ping`).
7. **Suscribir al campo `messages`** → en la sección "Webhook fields", click "Manage" → marcar `messages` → Subscribe. Sin esto, Meta no envía notificaciones de mensajes entrantes.

### 4.5 Validación manual del handshake
```bash
curl "http://localhost:4000/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=$WHATSAPP_VERIFY_TOKEN&hub.challenge=test123"
# debe responder: test123
```

---

## 5. Fase 3 — Smoke tests con número de prueba

**Contexto:** todos los tests se hacen enviando mensajes desde el celular personal de Felipe al **número de prueba** que está conectado a Meta. El backend local procesa vía ngrok.

### Test 1 — Mensaje texto entrante (camino feliz)
1. Desde el WhatsApp del celular personal de Felipe, escribir "hola" al número de prueba.
2. **Validar:**
   - Ngrok UI (`localhost:4040`) muestra POST al webhook con payload de Meta.
   - Logs backend: `[WhatsApp] Webhook recibido`, `[Gemini] llamada` con prompt PERFILANDO, `[WhatsApp] ✅ Mensaje entregado`.
   - El celular de Felipe recibe respuesta de Gemini (saludo + pregunta de profiling).
   - DB: `SELECT phone, estado, entidades FROM user_sessions WHERE phone='56...';` → estado `PERFILANDO`, `saludo_dado=true`.

### Test 2 — Imagen (comprobante)
1. Avanzar la conversación hasta `ESPERANDO_COMPROBANTE` (requiere cotizar desde dashboard primero — ver Test 3).
2. Enviar una imagen cualquiera al número de prueba.
3. **Validar:**
   - Logs: `[WhatsApp] Descargando media`, `downloadMedia` retorna buffer (`backend/services/whatsapp.service.js:167`).
   - La imagen aparece en el dashboard en la sesión correspondiente.

### Test 3 — Flujo completo cotización
1. Cliente (celular Felipe): "necesito pastillas de freno para Hyundai Accent 2015".
2. Validar Gemini perfila (marca, modelo, año, repuesto).
3. Avanza a `ESPERANDO_VENDEDOR`.
4. Dashboard local (`http://localhost:3000`): login como vendedor Melipilla → abrir el lead → cotizar con precio (ej. $25.000), `disponibilidad: 'DISPONIBLE'`, sucursal Melipilla.
5. Enviar cotización → cliente recibe mensaje en WhatsApp.
6. Cliente: "sí, lo quiero".
7. Estado → `CONFIRMANDO_COMPRA` → `ESPERANDO_COMPROBANTE`. Validar que Gemini ofrece transferencia + pago en local (no es POR_ENCARGO).
8. Cliente envía imagen comprobante.
9. Estado → `ESPERANDO_APROBACION_ADMIN`. Admin verifica → `PAGO_VERIFICADO` → `ESPERANDO_RETIRO`.
10. Vendedor marca entregado → cliente recibe mensaje + link reseña Google.
11. **Validar en cada step:** estado en DB, mensajes recibidos en celular, logs limpios.

### Test 4 — Flujo POR_ENCARGO
1. Repetir Test 3 hasta cotización, pero marcar el repuesto con `disponibilidad: 'POR_ENCARGO'` (selector 🟡 Abono) y abono parcial (ej. $10.000 abono / $25.000 total).
2. Confirmar que Gemini bloquea pago en local y exige transferencia (regla CONFIRMANDO_COMPRA con `entidadesTienenEncargo`).
3. Cliente paga abono → admin verifica con `accion: 'approved_abono'` → estado `ABONO_VERIFICADO`.
4. Verificar filtro bandeja "📦 Por Llegar" agrupa la sesión.
5. Vendedor pulsa "Solicitar a proveedor" con ETA 5 días → estado `ENCARGO_SOLICITADO`.
6. Vendedor pulsa "Repuestos Llegaron" → estado `ESPERANDO_SALDO`.
7. Vendedor pulsa "💵 Saldo Pagado en Local" → estado `ENTREGADO` + reseña Google enviada.
8. Validar mensaje al cliente con dirección sucursal (`getDireccionSucursal('Melipilla')`).

### Test 5 — Lock pesimista
1. Abrir 2 navegadores (Chrome + Safari) logueados como vendedor Melipilla.
2. Ambos abren el mismo lead simultáneamente.
3. **Validar:** el segundo en abrir ve overlay "🔒 Cotizando como <nombre>" + inputs deshabilitados.
4. Primer vendedor cierra tab → el lock se libera vía `beforeunload`.
5. Segundo refresh → puede editar.
6. Edge case: simular crash (cerrar PC) → lock expira a los 5 min, otro vendedor puede tomar.

### Test 6 — Derivación de sucursal
1. Cotizar 2 leads: uno con sucursal Melipilla, otro con sucursal San Felipe.
2. Validar que el mensaje de retiro incluye direcciones distintas (`backend/utils/sucursales.js:getDireccionSucursal`).
3. Validar que vendedor Melipilla NO ve el lead de San Felipe en su bandeja (filtro backend por `x-user-sucursal`).

### Criterio de éxito de Fase 3
**Todos los 6 tests pasan en 2 corridas consecutivas sin errores en logs.** Si alguno falla, **NO avanzar a Fase 4** hasta resolver. Si después de 3 intentos un test falla por motivo Meta-side (no del código), evaluar fallback Twilio (Sección 9).

---

## 6. Fase 4 — Setup en Railway (staging)

### 6.1 Decisión: staging vs feature flag

**Recomendación: staging separado.** Razones:
- Railway permite duplicar servicios gratis (mismo plan, otro env).
- Aislás riesgo: si algo rompe en el staging WhatsApp, no afecta a producción cuando se migre.
- Costo marginal: ~USD 5/mes mientras dure la validación. Cancelable.
- Alternativa de feature flag (`WHATSAPP_ENABLED=false` en prod) es viable pero contamina logs y aumenta riesgo humano de tocar prod accidentalmente.

### 6.2 Setup Railway staging
1. Railway dashboard → proyecto JFNN → "New" → "Empty Service" o duplicar el actual.
2. Conectar al mismo repo GitHub, branch `main`, root `backend/`.
3. Setear env vars (Settings → Variables):
   - Copiar **todas** las variables del backend prod actual (DB, Gemini, etc.).
   - **Override** las de WhatsApp con los valores del número de prueba (Fase 1):
     - `WHATSAPP_PHONE_ID`
     - `WHATSAPP_ACCESS_TOKEN`
     - `WHATSAPP_VERIFY_TOKEN` (mismo valor que se usó en local — más simple)
     - `META_APP_SECRET`
     - `META_APP_ID`
     - `WHATSAPP_BUSINESS_ACCOUNT_ID`
     - `WHATSAPP_API_VERSION=v21.0`
     - `WHATSAPP_DEBOUNCE_MS=20000` (prod-like)
     - `NODE_ENV=production`
   - **DB:** apuntar al mismo Supabase prod (los datos de test son temporales) o crear un proyecto Supabase staging si Felipe lo prefiere. Recomendación rápida: usar Supabase prod, limpiar al final con `DELETE FROM user_sessions WHERE phone='<numero_test>'`.
4. Deploy automático con git push (ya configurado en proyecto).
5. Obtener dominio Railway: `Settings → Networking → Generate Domain`. Resultado: `https://jfnn-staging-xxx.up.railway.app`.

### 6.3 Actualizar webhook a Railway
1. Meta App → `WhatsApp → Configuration → Webhook → Edit`.
2. Callback URL: `https://jfnn-staging-xxx.up.railway.app/api/whatsapp/webhook`.
3. Verify token: igual que antes.
4. "Verify and Save" → debe pasar el handshake contra Railway.
5. Re-confirmar suscripción a `messages`.
6. Apagar ngrok local — ya no se usa.

### 6.4 Validación staging
- Repetir Tests 1, 3 y 4 contra el staging (no hace falta los 6 — son los críticos).
- Confirmar en Railway logs (`mcp__Railway__get-logs` o UI Railway).
- Si pasan: Fase 4 completa.

---

## 7. Fase 5 — Migración del número productivo

**⚠️ Esta fase es parcialmente irreversible. Leer completa antes de ejecutar.**

### 7.1 Pre-migración (sin downtime)
1. **Backup chats WhatsApp Business app** del número productivo:
   - Abrir WhatsApp Business en el celular que tiene el número productivo.
   - Settings → Chats → Chat backup → Back up now (a Google Drive o iCloud).
   - **Adicional:** exportar conversaciones críticas individualmente (chat → ⋮ → More → Export chat → "Without media"). Guardar en `whatsapps/backup_pre_migracion_<fecha>/`.
   - Esto preserva el historial de clientes que el bot no maneja todavía. **Una vez migrado a Cloud API, los chats viejos NO migran** — quedan solo en el celular como histórico.
2. **Avisar a vendedores Melipilla y San Felipe** del downtime planificado (30 min ventana). Mensaje sugerido al grupo interno: "Hoy <fecha> entre <hora> y <hora+30min> el WhatsApp del negocio va a estar caído mientras migramos al sistema nuevo. Si entra un cliente, anótenlo y respondemos después."
3. **Pausar Railway producción (opcional)** durante la migración para evitar webhooks fantasma del número viejo. O dejar corriendo — los webhooks no llegarán porque Meta no estará configurado todavía con el número prod.

### 7.2 Migración
4. **Desactivar WhatsApp Business del número productivo:**
   - Settings → Account → Delete my account → ingresar número → confirmar.
   - **Esto libera el número de la app oficial de WhatsApp Business.** Es necesario porque un número solo puede estar en un lugar: o en la app, o en Cloud API.
   - Alternativa más conservadora: mantener la app instalada pero migrar el número al Cloud API igual — Meta forzará el cierre de sesión de la app al verificar OTP en Cloud API.
5. **Repetir Fase 1, paso 8 con el número productivo:**
   - Meta App (la misma `JFNN Omnicanal Dev` o crear una `JFNN Prod`; recomendado: la misma para reutilizar tokens y secret) → WhatsApp → Phone Numbers → Add phone number.
   - Ingresar el número productivo.
   - Recibir OTP **vía SMS o llamada al número productivo**. Felipe tiene que tener el celular con ese chip en mano.
   - Confirmar OTP.
6. **Anotar el nuevo `WHATSAPP_PHONE_ID`** (es distinto al del número de prueba — cada número tiene su propio ID).
7. **Verificar Display Name:** Meta puede pedir aprobación del Display Name (`Repuestos JFNN` o similar) — usualmente automático para Limited Access. Si pide, llenar formulario (nombre, descripción, URL, vertical).

### 7.3 Switch en Railway producción
8. Railway → servicio **producción** (NO staging) → Variables.
9. Override SOLO `WHATSAPP_PHONE_ID` con el nuevo ID del número productivo.
10. `WHATSAPP_ACCESS_TOKEN`, `META_APP_SECRET`, etc. siguen igual (son a nivel app, no a nivel número).
11. Deploy automático con la nueva env var (Railway re-deploya en cambio de var).
12. **Webhook URL ya está configurada** apuntando a producción (asumiendo Felipe configuró el webhook de prod antes — si no, hacerlo ahora: `https://<railway-prod-domain>/api/whatsapp/webhook`).
13. **Re-mover el webhook de staging temporalmente o mover el callback de Meta** al dominio de producción. Recomendación: cambiar el callback en Meta Console al de producción ahora.

### 7.4 Smoke test producción
14. Felipe escribe "hola" desde su celular personal al número productivo.
15. Validar respuesta del agente.
16. Probar un flujo corto (perfilado → cotización → confirmación) con un repuesto barato.
17. Si pasa: **migración completa.**

### 7.5 Rollback (honesto: no hay rollback rápido)
**Si la migración falla en producción y hay clientes esperando:**
- **Opción A — Reactivar WhatsApp Business app:** descargar la app de nuevo, ingresar número, recibir OTP. **Pero:** Meta tiene que liberar el número del Cloud API primero (Settings → Two-step verification → Remove number from Cloud API). Eso toma **~30 min a 2 horas**. Total downtime adicional: 1–3 horas.
- **Opción B — Quedarse en Cloud API y debuggear en caliente:** revisar logs Railway, X-Hub-Signature, token validity. Si el problema es env var mal seteada, fix en 5 min. Si es algo profundo, puede ser peor que rollback.
- **Recomendación:** **planificar la migración en horario de baja actividad** (domingo 10pm o lunes 7am) para minimizar exposure si hay que rollbackear. Tener Felipe disponible 2h post-migración para responder.

---

## 8. Fase 6 — Monitoreo post-launch (primeros 7 días)

### 8.1 Métricas a vigilar
| Métrica | Dónde | Umbral alerta |
|---|---|---|
| Conversaciones únicas iniciadas / 24h | Meta Manager → WhatsApp Manager → Insights | >200 (a 80% del límite 250) |
| Errores webhook (5xx) | Railway logs | >5 en 1h |
| Latencia respuesta Gemini | Logs `[Gemini]` timestamps | p95 >10s |
| Mensajes fallidos (Meta 4xx no-130472) | Logs `[WhatsApp] ❌ Error` | cualquier no-130472 inesperado |
| Sesiones stuck en `ESPERANDO_*` >24h | Query DB | >3 sesiones |

### 8.2 Comandos Railway logs
```bash
# Vía MCP Railway
mcp__Railway__get-logs (proyecto JFNN, servicio backend)

# O CLI Railway:
railway logs --service backend --tail
```

### 8.3 Alertas mínimas
- **Sentry o equivalente** (no urgente — Felipe lo agrega si lo cree necesario después). Por ahora: revisar Railway logs 2x/día.
- **Email a Felipe** si error rate >5/min: configurar con Railway "Notifications" si está disponible, sino usar healthcheck externo (UptimeRobot gratis, ping `/health` cada 5 min).

### 8.4 Cuándo escalar
- **Llegando a 200 conversaciones/24h** → empezar gestión de Business Verification con mayor urgencia (sigue en curso, Sección "Meta Verification" en CLAUDE.md). Si Meta no aprueba en 2 semanas y vamos a saturar 250, **migrar a Twilio (Opción C)** — no esperar a hit el límite.
- **5+ errores Meta-side (no del código)** → activar Twilio.
- **Templates HSM rechazados** → no es bloqueante, usa solo `hello_world` y trabaja sin HSM custom hasta verificación aprobada.

---

## 9. Plan B — Fallback Twilio (Opción C)

### 9.1 Criterios objetivos para abortar Opción A y saltar a Twilio
**Aborto inmediato si:**
1. OTP no llega al número de prueba después de 3 intentos + 2 reenvíos (SMS y llamada) + chip cambiado. Indica que Meta no está aceptando onboarding regional o el número está flaggeado.
2. Meta exige Business Verification en medio del flujo Limited Access (banner "Verify your business to continue" antes de los 250 mensajes/24h). Indica cambio de política — saltar a Twilio.
3. Webhook signature validation falla persistentemente con `META_APP_SECRET` correcto y no se resuelve en 4h de debugging. Casi siempre es código, pero si después de revisar es Meta-side, abortar.
4. El número productivo (Fase 5) no acepta OTP después de 24h, después de haberse usado en WhatsApp Business durante años. Indica que el número está marcado como "no apto para Cloud API" — pasa raro pero ocurre.

### 9.2 Pasos resumidos activación Twilio
1. Crear cuenta Twilio (https://www.twilio.com/console) — verificación tarjeta de crédito.
2. Ir a **Messaging → Try it out → Send a WhatsApp message** o "WhatsApp senders".
3. **WhatsApp Sandbox** (gratis, instantáneo, número compartido): para tests inmediatos. Limitado a un join code.
4. **Solicitar WhatsApp Sender productivo** (cuesta USD ~85/mes + uso). Twilio actúa como BSP — ellos gestionan la relación con Meta y NO requiere Business Verification por parte del cliente (es de ellos). Hay que llenar formulario con datos del negocio. Aprobación 1–3 días.
5. Obtener credenciales: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` (formato `whatsapp:+14155238886` o el número de JFNN).
6. Configurar webhook URL en Twilio Console (mismo `https://<railway>/api/whatsapp/webhook` con un sufijo o ruta nueva — ver siguiente paso).
7. **Cambios en código backend** (~4–6 hs según `docs/PLAN_B_META_RECHAZO.md`):
   - Crear `backend/services/whatsapp-twilio.adapter.js` con misma interface que `whatsapp.service.js` (`sendTextMessage`, `sendTemplateMessage`, `downloadMedia`).
   - Twilio usa SDK `twilio` (`npm install twilio`).
   - Adaptar `webhook` controller: payload Twilio es distinto (form-encoded, no JSON; campos `From`, `Body`, `MediaUrl0`).
   - Validación de firma: Twilio usa `X-Twilio-Signature` con HMAC-SHA1 de URL + params.
   - Feature flag en `backend/services/whatsapp.service.js` para enrutar a Meta o Twilio según `WHATSAPP_PROVIDER=meta|twilio`.

### 9.3 Costos estimados Twilio para JFNN
- **WhatsApp Sender fee:** USD 85/mes (fijo).
- **Conversaciones iniciadas por el cliente** (utility/marketing): USD 0.0085–0.04 por conversación 24h, depende de categoría. Promedio JFNN (mayoría utility): ~USD 0.015.
- **Volumen estimado:** Felipe mencionó ~50 conversaciones nuevas/día. = 1.500/mes.
- **Costo conversaciones:** 1.500 × 0.015 = USD 22.5/mes.
- **Total estimado:** USD ~110/mes (vs Meta directo = USD 0).
- Conviene Twilio si: (a) Meta no aprueba en 4+ semanas, (b) volumen <5.000 conversaciones/mes, (c) no se quiere esperar gestión BSP propia.

---

## 10. Checklist final ejecutable

### Fase 0 — Prerrequisitos
- [ ] Cuenta Meta for Developers personal lista
- [ ] Acceso admin Business Manager JFNN confirmado
- [ ] Acceso admin Railway confirmado
- [ ] Chip prepago/número de prueba en mano + activado
- [ ] ngrok instalado y autenticado

### Fase 1 — Meta Setup (12 pasos)
- [ ] App `JFNN Omnicanal Dev` creada
- [ ] Producto WhatsApp agregado
- [ ] WABA creada y `WABA_ID` anotado
- [ ] Limited Access confirmado (banner 250/24h visible)
- [ ] Número de prueba verificado con OTP
- [ ] `WHATSAPP_PHONE_ID` anotado
- [ ] Token temporal generado (para tests iniciales)
- [ ] Test `hello_world` enviado y recibido
- [ ] System User creado + token permanente generado
- [ ] `META_APP_SECRET` y `META_APP_ID` anotados

### Fase 2 — Backend local
- [ ] `.env.local` poblado con todas las vars
- [ ] `WHATSAPP_VERIFY_TOKEN` generado con `openssl rand -hex 16`
- [ ] Backend levantado en `localhost:4000`
- [ ] ngrok exponiendo puerto 4000
- [ ] Webhook configurado en Meta Console con URL ngrok
- [ ] Handshake `Verify and Save` exitoso
- [ ] Campo `messages` suscrito

### Fase 3 — Smoke tests (6 tests, local)
- [ ] Test 1: mensaje texto round-trip
- [ ] Test 2: imagen recibida
- [ ] Test 3: flujo cotización completo
- [ ] Test 4: flujo POR_ENCARGO completo
- [ ] Test 5: lock pesimista con 2 vendedores
- [ ] Test 6: derivación sucursal correcta

### Fase 4 — Railway staging
- [ ] Servicio staging creado en Railway
- [ ] Env vars seteadas
- [ ] Dominio generado
- [ ] Webhook movido a dominio Railway
- [ ] Smoke tests 1, 3, 4 repetidos en staging

### Fase 5 — Migración número productivo
- [ ] Backup WhatsApp Business app realizado
- [ ] Vendedores avisados de ventana de downtime
- [ ] WhatsApp Business app desactivada del número prod
- [ ] OTP recibido y validado en Cloud API
- [ ] Nuevo `WHATSAPP_PHONE_ID` anotado
- [ ] Railway producción var actualizada
- [ ] Webhook Meta apuntando a prod Railway
- [ ] Smoke test producción exitoso con cliente real (interno)

### Fase 6 — Monitoreo
- [ ] Métricas configuradas / proceso de revisión diaria definido
- [ ] Healthcheck UptimeRobot configurado
- [ ] Plan de escalación documentado

---

## 11. Tiempos estimados totales

| Escenario | Días calendario | Horas de trabajo activo |
|---|---|---|
| Camino feliz (sin fricción) | 1–2 días | 4–6 hs |
| Con fricción (OTP demora, debugging webhook) | 3–4 días | 8–12 hs |
| Fallback Twilio activado | +3–5 días | +8–12 hs (adapter + tests) |

**Distribución del camino feliz:**
- Fase 0 + 1: 1.5 hs (incluye ir al kiosko por chip)
- Fase 2: 1 hr
- Fase 3 (6 tests): 1.5 hs
- Fase 4: 1 hr
- Fase 5: 1 hr (más ventana de espera OTP)
- Fase 6: monitoreo pasivo (no incluye trabajo activo continuo)

---

## 12. Riesgos conocidos y mitigaciones

### Riesgo 1 — OTP no llega al número de prueba (probabilidad: media)
**Síntomas:** Meta dice "Code sent" pero el chip nunca recibe SMS ni llamada después de 10 min.
**Mitigaciones:**
- Reintentar pidiendo OTP por **voz** en lugar de SMS (botón en la UI Meta).
- Cambiar de operador (si fue Entel, probar WOM).
- Asegurar que el chip está activado con saldo (algunos operadores chilenos requieren saldo mínimo para recibir SMS internacionales).
- Si después de 3 intentos no llega: el número está flaggeado por Meta → comprar OTRO chip.

### Riesgo 2 — Meta exige Business Verification mid-flow (probabilidad: baja-media)
**Síntomas:** banner aparece en consola: "Verify your business to send messages."
**Mitigaciones:**
- Confirmar que estamos en Limited Access (banner de 250/24h debería seguir visible).
- Si Meta cambió política regionalmente para Chile → **activar Twilio (Sección 9)**.
- En paralelo, acelerar la verificación que está en curso (revisar email contacto@repuestosjfnn.cl por código pendiente).

### Riesgo 3 — Webhook signature mismatch (probabilidad: media en setup, baja después)
**Síntomas:** logs muestran `[Webhook] ❌ Firma inválida` repetidamente; Meta marca el webhook como "fallando".
**Mitigaciones:**
- Verificar que `META_APP_SECRET` no tenga espacios o caracteres extra.
- Confirmar que `controller.js:16-30` está usando el secret correcto y el raw body (no parseado).
- Express debe estar configurado para preservar raw body en `/api/whatsapp/webhook` — verificar `backend/index.js` o `body-parser.raw()`. Si no está, agregar middleware.
- En desarrollo (`NODE_ENV !== production`), la validación se saltea, así que confirmar el `NODE_ENV` real.

### Riesgo 4 — Rate limit token temporal (probabilidad: alta si se usa >24h)
**Síntomas:** error 401 "OAuthException" después del primer día de tests.
**Mitigaciones:**
- **NO postergar la creación del System User token permanente.** Hacerla apenas el test inicial pasa (Fase 1.12).
- Token permanente no expira (excepto si se rota manualmente).

### Riesgo 5 — Número de prueba se quema (probabilidad: baja)
**Síntomas:** después de muchos tests con mensajes idénticos, Meta marca el comportamiento como spam y reduce calidad del número (visible en WhatsApp Manager → Quality rating: red).
**Mitigaciones:**
- Variar los mensajes en los tests (no enviar "hola" 50 veces seguidas — usar "hola", "buenas", "necesito un repuesto", etc.).
- Tests Test 5 (lock) se hacen vía dashboard, no vía WhatsApp — bajan presión.
- Si quality rating baja a "red": dejar el número descansar 48h o usar OTRO chip de prueba.

### Riesgo 6 — Migración número productivo: clientes pierden chats viejos (probabilidad: alta — es por diseño)
**Síntomas:** vendedores no encuentran historial conversación con clientes pre-migración en el dashboard.
**Mitigaciones:**
- Backup de Fase 5.1 conserva chats en el celular (no en dashboard).
- Avisar a vendedores: "el historial viejo queda solo en el celular físico — desde la migración, todo nuevo entra al dashboard".
- Si Felipe quiere importar histórico al dashboard: requiere desarrollo adicional (parser de export WhatsApp `.txt`). Estimación: 4–6 hs si se decide hacer.

---

**FIN DEL PLAN**

Última actualización: 2026-05-18. Owner: Felipe Navarrete.
