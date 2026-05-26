# Plan de Implementacion Completa — Sucursal Melipilla

**Fecha:** 26 de mayo 2026
**Objetivo:** Migrar el numero productivo de WhatsApp Business al sistema JFNN Omnicanal, configurar perfil de negocio, importar historial de chats, y crear plantillas HSM.

**Tiempo estimado:** 2-3 horas

---

## CONTEXTO OPERACIONAL — Sucursales

### Melipilla (sucursal principal)
- Local **abierto** con atencion presencial
- Vendedores: Sergio, Feña, y otros del equipo
- Es la sucursal donde se implementa manana

### San Felipe (sucursal cerrada temporalmente)
- Local **cerrado** para atencion presencial
- **Solo opera delivery** a ciudades cercanas (San Felipe, Los Andes, etc.)
- Vendedor responsable: **Kano**
- Kano debe tener acceso al dashboard para:
  - Responder WhatsApp como apoyo (refuerzo para Melipilla tambien)
  - Gestionar pedidos de delivery de la zona de San Felipe
- El agente IA debe derivar a San Felipe solo cuando el cliente es de esa zona y quiere delivery
- Si un cliente de San Felipe quiere retiro presencial → informar que la sucursal esta temporalmente cerrada y ofrecer delivery

### Implicaciones para el sistema
- El prompt de Gemini debe saber que San Felipe **no tiene retiro presencial** por ahora
- Kano debe poder loguearse con la cuenta `vendedor_san_felipe` y ver ambas bandejas (su sucursal + apoyo general)
- Los mensajes de Kano en el chat deben aparecer con su nombre ("KANO")

---

## FASE 0 — Preparacion (ANTES de ir al local)

### 0.1 Materiales necesarios

- [ ] Acceso al telefono con WhatsApp Business del local (con la app abierta)
- [ ] Chip del numero productivo de Melipilla instalado en el telefono (para recibir SMS de verificacion)
- [ ] Notebook con acceso a internet
- [ ] Acceso a business.facebook.com (sesion iniciada)
- [ ] Acceso a Railway (variables de entorno)
- [ ] Logo/imagen de perfil de JFNN (640x640px, formato JPG, fondo limpio)
- [ ] Datos del local: direccion exacta, horario, email, sitio web

### 0.2 Verificar que el sistema actual funciona

```bash
# Verificar que el backend responde
curl https://jfnn-backend-production.up.railway.app/api/health

# Verificar que el dashboard carga
# Abrir https://panel.repuestosjfnn.cl y loguearse
```

---

## FASE 1 — Backup de WhatsApp Business (30 min)

> **CRITICO:** Una vez que eliminemos la cuenta de WhatsApp Business del telefono, TODOS los chats locales se pierden para siempre. Hacer esto PRIMERO.

### 1.1 Exportar chats individuales

En el telefono con WhatsApp Business:

1. Abrir cada chat importante (clientes frecuentes, conversaciones activas)
2. Tocar menu (3 puntos) → **Mas** → **Exportar chat**
3. Seleccionar **"Incluir multimedia"** (hasta 10.000 mensajes por chat) o **"Sin multimedia"** (hasta 40.000 mensajes)
4. Enviar a **Google Drive** o por **email** al correo del negocio
5. Repetir para cada chat relevante

**Formato del archivo exportado:** ZIP conteniendo:
- `_chat.txt` — texto plano con todos los mensajes
- Archivos multimedia (si se eligio "Incluir multimedia")

**Formato de cada linea en `_chat.txt`:**
```
15-01-26, 10:32 - Juan Perez: Hola, necesito un filtro de aceite
15-01-26, 10:33 - Repuestos JFNN: Bienvenido! Dejame buscar eso
15-01-26, 10:35 - Juan Perez: <Media omitted>
```

### 1.2 Backup del perfil de negocio

Antes de eliminar, anotar o capturar pantalla de:
- [ ] Nombre del perfil
- [ ] Foto de perfil (descargarla si es posible)
- [ ] Descripcion / "Acerca de"
- [ ] Direccion configurada
- [ ] Horario de atencion
- [ ] Catalogo de productos (si existe)
- [ ] Mensajes automaticos configurados (saludo, ausencia, respuestas rapidas)
- [ ] Etiquetas de clientes

### 1.3 Exportar contactos

- WhatsApp Business → Configuracion → Chats → Historial de chats → **Exportar contactos** (si esta disponible)
- Alternativamente, exportar contactos del telefono a un archivo .vcf

---

## FASE 2 — Importar historial a la base de datos

> **Objetivo:** Parsear los archivos `_chat.txt` exportados e insertarlos en la tabla `mensajes` para que aparezcan en el Chat del dashboard.

### 2.1 Script de importacion

El script ya esta preparado. Para cada archivo ZIP exportado:

```bash
# 1. Descomprimir el ZIP
unzip "WhatsApp Chat - +56 9 XXXX XXXX.zip" -d ./import_temp/

# 2. Ejecutar el script de importacion (se creara en el backend)
cd backend
node scripts/import_whatsapp_export.js \
  --file ../import_temp/_chat.txt \
  --phone 569XXXXXXXX \
  --sucursal Melipilla \
  --business-name "Repuestos JFNN"
```

### 2.2 Logica del parser

El script debe:

1. Leer `_chat.txt` linea por linea
2. Detectar el formato de timestamp chileno: `DD-MM-YY, HH:MM` o `DD/MM/YY, HH:MM`
3. Para cada mensaje:
   - Si el sender es el nombre del negocio → `direccion: 'saliente'`, `autor: 'vendedor'`
   - Si el sender es otro nombre → `direccion: 'entrante'`, `autor: 'cliente'`
   - Si es `<Media omitted>` → `tipo: 'image'` (generico), `contenido: null`
   - Si es texto normal → `tipo: 'text'`, `contenido: texto`
4. Insertar en tabla `mensajes` con `created_at` del timestamp original
5. Extraer el nombre del cliente del primer mensaje entrante → crear/actualizar `user_sessions` si no existe

### 2.3 Mapeo de campos

| Campo _chat.txt | Campo DB `mensajes` |
|-----------------|---------------------|
| Timestamp | `created_at` |
| Sender = negocio | `direccion: 'saliente'`, `autor: 'vendedor'` |
| Sender = otro | `direccion: 'entrante'`, `autor: 'cliente'` |
| Texto del mensaje | `contenido` |
| `<Media omitted>` | `tipo: 'image'`, `contenido: null` |
| Numero del chat | `phone` (formato 569XXXXXXXX) |

### 2.4 Consideraciones

- Los mensajes importados NO tendran `wa_message_id` (se dejara NULL) — son historicos
- La `sucursal` se asigna como 'Melipilla' para todos
- Si un numero ya tiene mensajes en la DB (de las pruebas), los importados se agregan con su timestamp original
- Los mensajes del sistema de WhatsApp (cifrado, cambios de grupo) se ignoran

---

## FASE 3 — Eliminar cuenta WhatsApp Business del telefono (5 min)

> **Solo hacer esto DESPUES de completar Fase 1 y 2**

### 3.1 Desactivar verificacion en dos pasos

1. Abrir WhatsApp Business en el telefono
2. Ir a **Configuracion** → **Cuenta** → **Verificacion en dos pasos**
3. Si esta activada → **Desactivar**
4. Confirmar

### 3.2 Eliminar la cuenta

1. Ir a **Configuracion** → **Cuenta** → **Eliminar mi cuenta**
2. Ingresar el numero de telefono
3. Confirmar eliminacion
4. **ESPERAR 5 MINUTOS** antes de continuar (Meta necesita tiempo para liberar el numero)

> **IMPORTANTE:** Esto es IRREVERSIBLE. No desinstalar la app, sino ELIMINAR LA CUENTA desde dentro de la app.

---

## FASE 4 — Registrar numero productivo en Cloud API (15 min)

### 4.1 Agregar numero a la WABA (via Meta Business Manager)

1. Ir a **business.facebook.com**
2. Menu lateral → **WhatsApp Manager**
3. Verificar que estas en la WABA correcta: `repuestos jfnn` (ID `1003088295416438`)
4. Ir a **Numeros de telefono** → **Agregar numero de telefono**
5. Ingresar:
   - Codigo de pais: `+56`
   - Numero: `9 XXXX XXXX` (numero productivo de Melipilla)
   - Nombre verificado: `Repuestos JFNN`
6. Seleccionar metodo de verificacion: **SMS**
7. Click en **Solicitar codigo**

### 4.2 Verificar con OTP

1. El codigo de 6 digitos llegara por SMS al telefono con el chip
2. Ingresar el codigo en Meta Business Manager
3. Establecer un PIN de verificacion en dos pasos (6 digitos) — **ANOTAR ESTE PIN**

### 4.3 Verificar registro exitoso

En WhatsApp Manager → Numeros de telefono, el nuevo numero debe aparecer con estado **"Conectado"**.

Anotar el nuevo **Phone Number ID** que Meta asigna — lo necesitamos para Railway.

### 4.4 Alternativa via API (si el UI no funciona)

```bash
# Solicitar OTP
curl -X POST \
  "https://graph.facebook.com/v25.0/{NUEVO_PHONE_NUMBER_ID}/request_code" \
  -H "Authorization: Bearer $WHATSAPP_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"code_method": "SMS", "language": "es"}'

# Verificar OTP
curl -X POST \
  "https://graph.facebook.com/v25.0/{NUEVO_PHONE_NUMBER_ID}/verify_code" \
  -H "Authorization: Bearer $WHATSAPP_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"code": "CODIGO_6_DIGITOS"}'

# Registrar
curl -X POST \
  "https://graph.facebook.com/v25.0/{NUEVO_PHONE_NUMBER_ID}/register" \
  -H "Authorization: Bearer $WHATSAPP_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"messaging_product": "whatsapp", "pin": "TU_PIN_6_DIGITOS"}'
```

---

## FASE 5 — Configurar perfil de negocio via API (10 min)

> Ya no tendremos acceso a la app del telefono. Todo se configura via Cloud API.

### 5.1 Subir foto de perfil

**Paso 1 — Crear sesion de upload:**
```bash
curl -X POST \
  "https://graph.facebook.com/v25.0/2553364111727691/uploads" \
  -H "Authorization: OAuth $WHATSAPP_ACCESS_TOKEN" \
  -F "file_length=$(wc -c < perfil.jpg | tr -d ' ')" \
  -F "file_name=perfil.jpg" \
  -F "file_type=image/jpeg"
```
Respuesta: `{"id": "upload:XXXXXXXXX"}`

**Paso 2 — Subir la imagen:**
```bash
curl -X POST \
  "https://graph.facebook.com/v25.0/upload:XXXXXXXXX" \
  -H "Authorization: OAuth $WHATSAPP_ACCESS_TOKEN" \
  -H "file_offset: 0" \
  -H "Content-Type: image/jpeg" \
  --data-binary @perfil.jpg
```
Respuesta: `{"h": "handle:XXXXXXXXXXXXXXXX"}`

**Paso 3 — Asignar al perfil:**
```bash
curl -X POST \
  "https://graph.facebook.com/v25.0/{NUEVO_PHONE_NUMBER_ID}/whatsapp_business_profile" \
  -H "Authorization: Bearer $WHATSAPP_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"messaging_product": "whatsapp", "profile_picture_handle": "handle:XXXXXXXXXXXXXXXX"}'
```

### 5.2 Configurar informacion del negocio

```bash
curl -X POST \
  "https://graph.facebook.com/v25.0/{NUEVO_PHONE_NUMBER_ID}/whatsapp_business_profile" \
  -H "Authorization: Bearer $WHATSAPP_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "messaging_product": "whatsapp",
    "about": "Repuestos automotrices - Melipilla y San Felipe",
    "description": "Venta de repuestos automotrices nuevos y usados. Cotiza por WhatsApp y recibe tu presupuesto en minutos. Envios a todo Chile.",
    "address": "Ortuzar 531, Melipilla, Chile",
    "email": "CORREO_DEL_NEGOCIO",
    "vertical": "AUTO",
    "websites": ["https://repuestosjfnn.cl"]
  }'
```

### 5.3 Verificar perfil

```bash
curl -s -X GET \
  "https://graph.facebook.com/v25.0/{NUEVO_PHONE_NUMBER_ID}/whatsapp_business_profile?fields=about,address,description,email,websites,vertical,profile_picture_url" \
  -H "Authorization: Bearer $WHATSAPP_ACCESS_TOKEN" | jq .
```

### 5.4 Endpoint en el dashboard (futuro)

Se puede agregar una seccion en la pagina de Settings del dashboard para editar estos campos sin necesidad de usar curl. Por ahora, se hace via terminal.

---

## FASE 6 — Actualizar variables en Railway (5 min)

### 6.1 Cambiar el Phone Number ID

En Railway → servicio `jfnn-backend` → Variables:

```
WHATSAPP_PHONE_ID = {NUEVO_PHONE_NUMBER_ID}
```

**NO cambiar:**
- `WHATSAPP_ACCESS_TOKEN` — el token del System User `jfnnbackendapi` es de nivel WABA, sirve para todos los numeros de la misma WABA
- `WHATSAPP_VERIFY_TOKEN` — el webhook sigue siendo el mismo

### 6.2 Configurar META_APP_SECRET (si no esta)

```
META_APP_SECRET = {App Secret de RepuestosOmnicanal}
```

Se obtiene de: Meta for Developers → App `RepuestosOmnicanal` → Settings → Basic → App Secret.

### 6.3 Verificar el webhook

El webhook ya esta configurado en `https://jfnn-backend-production.up.railway.app/api/whatsapp/webhook`. Solo necesitas verificar que el nuevo numero este suscrito al webhook:

1. Meta for Developers → App `RepuestosOmnicanal` → WhatsApp → Configuration
2. En Webhook fields, verificar que esten suscritos: `messages`, `messaging_postbacks`
3. El webhook URL debe ser el de Railway

### 6.4 Esperar redeploy

Railway redesplegara automaticamente al cambiar las variables. Verificar en los logs que el backend sube correctamente.

---

## FASE 7 — Crear plantillas HSM en Meta (20 min)

### 7.1 Ir al panel de plantillas

1. business.facebook.com → WhatsApp Manager
2. WABA: `repuestos jfnn`
3. Menu: **Plantillas de mensajes** → **Crear plantilla**

### 7.2 Crear cada plantilla

#### Plantilla 1: `retomar_cotizacion`
- **Categoria:** UTILITY
- **Idioma:** Espanol (es)
- **Cuerpo:**
```
Hola {{1}}, soy de Repuestos JFNN. Hace un tiempo nos consultaste por repuestos para tu vehiculo y la conversacion quedo pendiente. Si todavia necesitas los repuestos, respondenos por aqui y te ayudamos altiro. Saludos!
```
- **Variables:** `{{1}}` = Nombre del cliente
- **Footer:** `Repuestos JFNN - Melipilla y San Felipe`

#### Plantilla 2: `cotizacion_lista`
- **Categoria:** UTILITY
- **Idioma:** Espanol (es)
- **Cuerpo:**
```
Hola {{1}}, ya tenemos los precios listos para los repuestos que nos pediste. Tu cotizacion incluye {{2}} repuesto(s). Respondenos por aqui para que te enviemos el detalle y puedas confirmar tu compra.
```
- **Variables:** `{{1}}` = Nombre, `{{2}}` = Cantidad de repuestos
- **Footer:** `Repuestos JFNN`

#### Plantilla 3: `comprobante_pendiente`
- **Categoria:** UTILITY
- **Idioma:** Espanol (es)
- **Cuerpo:**
```
Hola {{1}}, te recordamos que tu pedido de repuestos esta confirmado pero aun no hemos recibido el comprobante de transferencia. Envianoslo por aqui para que podamos verificar tu pago y preparar tu pedido. Gracias!
```
- **Variables:** `{{1}}` = Nombre
- **Footer:** `Repuestos JFNN`

#### Plantilla 4: `pedido_listo`
- **Categoria:** UTILITY
- **Idioma:** Espanol (es)
- **Cuerpo:**
```
Hola {{1}}, tu pedido de repuestos esta listo para retiro en nuestra sucursal {{2}}. Te esperamos en horario de atencion. Recuerda traer tu comprobante de pago.
```
- **Variables:** `{{1}}` = Nombre, `{{2}}` = Sucursal
- **Footer:** `Repuestos JFNN`

#### Plantilla 5: `encargo_llegada`
- **Categoria:** UTILITY
- **Idioma:** Espanol (es)
- **Cuerpo:**
```
Hola {{1}}, te avisamos que los repuestos que encargaste ya llegaron a nuestra sucursal {{2}}. Respondenos por aqui para coordinar el retiro.
```
- **Variables:** `{{1}}` = Nombre, `{{2}}` = Sucursal
- **Footer:** `Repuestos JFNN`

#### Plantilla 6: `seguimiento_postventa`
- **Categoria:** MARKETING
- **Idioma:** Espanol (es)
- **Cuerpo:**
```
Hola {{1}}, de Repuestos JFNN. Esperamos que los repuestos que compraste te hayan funcionado bien. Si tienes un minuto, nos ayudaria mucho que nos dejaras una resena en Google. Gracias por tu preferencia!
```
- **Variables:** `{{1}}` = Nombre
- **Footer:** `Repuestos JFNN - Melipilla y San Felipe`

### 7.3 Tiempo de aprobacion

- Automatico: 1-15 minutos
- Con revision humana: hasta 24 horas
- Si rechazan, editar y reenviar (sin penalizacion)

### 7.4 Verificar nombres en el backend

Los nombres de las plantillas en Meta DEBEN coincidir exactamente con los del catalogo en `backend/routes/dashboard.routes.js` (endpoint `GET /plantillas-hsm`). Si Meta requiere cambiar algun nombre, actualizar tambien el backend.

---

## FASE 8 — Testing completo (20 min)

### 8.1 Test de recepcion

1. Desde otro telefono, enviar un mensaje al numero productivo de Melipilla
2. Verificar en Railway logs que el webhook recibe el mensaje
3. Verificar que el agente IA responde correctamente
4. Verificar en el dashboard (Chat) que aparece la conversacion

### 8.2 Test de envio vendedor

1. Abrir panel.repuestosjfnn.cl → Chat
2. Seleccionar la conversacion de prueba
3. Escribir un mensaje libre → verificar que llega al WhatsApp del cliente
4. Verificar que aparece con el nombre del vendedor en el chat

### 8.3 Test de plantillas HSM

1. En el Chat, abrir "Plantillas HSM"
2. Enviar una plantilla a un numero de prueba
3. Verificar que llega correctamente al WhatsApp del destinatario

### 8.4 Test de multimedia

1. Enviar una imagen desde el WhatsApp del cliente
2. Verificar que se sube a Supabase Storage
3. Verificar que se muestra en el Chat del dashboard con signed URL

### 8.5 Test de perfil

1. Desde el telefono de prueba, abrir el chat con el numero de Melipilla
2. Tocar el nombre del contacto para ver el perfil
3. Verificar: foto de perfil, nombre, descripcion, direccion

### 8.6 Test de historial importado

1. En el Chat del dashboard, verificar que aparecen las conversaciones antiguas
2. Los mensajes deben tener sus timestamps originales
3. La distincion cliente/vendedor debe ser correcta

---

## FASE 9 — Checklist final

### Verificaciones post-implementacion

- [ ] El numero productivo responde mensajes via Cloud API
- [ ] El agente IA procesa y responde correctamente
- [ ] El dashboard muestra conversaciones en la bandeja
- [ ] El Chat muestra mensajes en tiempo real (sin flash de loading)
- [ ] Los vendedores pueden escribir mensajes libres
- [ ] Las plantillas HSM estan aprobadas y se pueden enviar
- [ ] La foto de perfil se ve correctamente
- [ ] La informacion del negocio aparece en el perfil
- [ ] El historial importado aparece en el Chat
- [ ] La ventana de 24h muestra el indicador correcto
- [ ] El webhook valida firmas con META_APP_SECRET
- [ ] Los vendedores pueden loguearse y ver solo su sucursal

### Comunicar al equipo

- [ ] Informar a los vendedores de Melipilla que el sistema esta activo
- [ ] Explicar que ya no usan la app del telefono — todo va por el dashboard
- [ ] Dar acceso al panel: URL, cuenta, PIN
- [ ] Explicar el flujo: el cliente escribe, la IA perfila, ellos cotizan en la bandeja

### Rollback (si algo falla)

Si hay un problema critico:
1. En Railway, cambiar `WHATSAPP_PHONE_ID` de vuelta al numero de prueba
2. El numero productivo quedara sin WhatsApp — seria necesario reinstalar WhatsApp Business en el telefono y verificar con OTP
3. Los chats locales se habran perdido, pero estaran en el backup exportado

---

## Resumen de orden de ejecucion

| # | Fase | Tiempo | Requiere |
|---|------|--------|----------|
| 1 | Backup de chats y perfil | 30 min | Telefono con WhatsApp Business |
| 2 | Importar historial a DB | 15 min | Notebook + archivos ZIP exportados |
| 3 | Eliminar cuenta del telefono | 5 min | Telefono |
| 4 | Registrar numero en Cloud API | 15 min | business.facebook.com + SMS al telefono |
| 5 | Configurar perfil de negocio | 10 min | Terminal con curl |
| 6 | Actualizar Railway | 5 min | railway.app |
| 7 | Crear plantillas HSM | 20 min | business.facebook.com |
| 8 | Testing completo | 20 min | Dos telefonos + dashboard |
| 9 | Checklist final | 10 min | - |
| **Total** | | **~2.5 horas** | |

---

## Notas importantes

1. **El script de importacion de chats (Fase 2) debe crearse antes de ir al local.** Prepararlo hoy y testearlo con el archivo de ejemplo que ya teniamos (`whatsapp/extracted_chats/_chat.txt`).

2. **La imagen de perfil debe estar lista** en formato JPG, idealmente 640x640px. Si el logo actual del negocio esta en otro formato, convertirlo antes.

3. **Llevar anotado el numero productivo exacto** del local de Melipilla en formato internacional (569XXXXXXXX).

4. **El System User token (`jfnnbackendapi`) es de nivel WABA** — funciona para cualquier numero dentro de la WABA `1003088295416438`. No necesita regenerarse.

5. **Si la verificacion de negocio de Meta se aprueba** mientras tanto, el limite sube de 250 a 1.000 conversaciones/24h automaticamente.
