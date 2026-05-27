# Guia Paso a Paso: Cambio de Numero WhatsApp

**Cuando:** Al cierre del local (cuando ya no entren mas clientes)
**Tiempo estimado:** 20-30 minutos
**Requisitos:** Telefono con el chip del numero productivo de Melipilla (para recibir SMS)

---

## PASO 1 — Eliminar cuenta WhatsApp Business del telefono (5 min)

### 1.1 Desactivar verificacion en dos pasos
1. Abrir WhatsApp Business en el telefono
2. Ir a **Configuracion** > **Cuenta** > **Verificacion en dos pasos**
3. Si esta activada → **Desactivar**

### 1.2 Eliminar la cuenta
1. Ir a **Configuracion** > **Cuenta** > **Eliminar mi cuenta**
2. Ingresar el numero de telefono del local
3. Confirmar eliminacion
4. **ESPERAR 5 MINUTOS** antes de continuar

> IMPORTANTE: No desinstalar la app. ELIMINAR LA CUENTA desde dentro de la app. Es irreversible pero necesario para liberar el numero.

---

## PASO 2 — Registrar numero en Cloud API (15 min)

### 2.1 Agregar numero a la WABA

1. Abrir **business.facebook.com** en el notebook
2. Ir a **Administrador de WhatsApp** (ya deberia estar abierto de las plantillas)
3. Menu lateral: **Numeros de telefono**
4. Click en **"Agregar numero de telefono"** (boton azul arriba a la derecha)
5. Llenar:
   - Codigo de pais: `+56`
   - Numero: el numero productivo de Melipilla (sin el +56, ej: `962980686`)
   - Nombre verificado: `Repuestos JFNN`
6. Metodo de verificacion: **SMS**
7. Click en **"Solicitar codigo"**

### 2.2 Verificar con OTP
1. El codigo de 6 digitos llegara por SMS al telefono
2. Ingresarlo en Meta Business Manager
3. Te pedira un PIN de verificacion en dos pasos (6 digitos)
4. **ANOTAR ESTE PIN** (guardarlo en un lugar seguro)

### 2.3 Verificar que quedo conectado
- En la lista de numeros de telefono, el nuevo numero debe aparecer como **"Conectado"**
- Anotar el **Phone Number ID** que aparece (lo necesitas para el paso 3)

> Si no aparece el boton "Agregar numero", puede ser porque la WABA ya tiene el maximo para tu tier. En ese caso, primero elimina el numero de prueba (+56 9 5082 8842) haciendo click en el icono de basura.

---

## PASO 3 — Actualizar Railway (5 min)

### 3.1 Obtener el nuevo Phone Number ID

En el Administrador de WhatsApp > Numeros de telefono, haz click en el engranaje del nuevo numero. El **Phone Number ID** aparece en los detalles (es un numero largo, ej: `1066882779849103`).

Alternativamente, puedes obtenerlo via API:
```
En el navegador, abre:
https://graph.facebook.com/v25.0/1003088295416438/phone_numbers?access_token=TU_TOKEN
```
(Reemplaza TU_TOKEN por el WHATSAPP_ACCESS_TOKEN de Railway)

### 3.2 Cambiar la variable en Railway

1. Abrir **railway.app** > proyecto jfnn-backend
2. Click en el servicio backend > **Variables**
3. Buscar `WHATSAPP_PHONE_ID`
4. Cambiar el valor actual (`1066882779849103`) por el **nuevo Phone Number ID**
5. Click en **Deploy** o esperar el redeploy automatico

**NO cambiar estas variables** (siguen siendo las mismas):
- `WHATSAPP_ACCESS_TOKEN` — el token del System User sirve para toda la WABA
- `WHATSAPP_VERIFY_TOKEN` — el webhook no cambia

### 3.3 Verificar webhook

El webhook ya esta configurado y apunta a todos los numeros de la WABA. Pero para estar seguro:

1. Ir a **developers.facebook.com** > App `RepuestosOmnicanal` > WhatsApp > Configuration
2. Verificar que Webhook URL sea: `https://jfnn-backend-production.up.railway.app/api/whatsapp/webhook`
3. Verificar que esten suscritos: `messages`

---

## PASO 4 — Configurar perfil de negocio (5 min)

Abrir una terminal en el notebook y ejecutar estos comandos. Reemplazar `{PHONE_ID}` por el nuevo Phone Number ID y `{TOKEN}` por el WHATSAPP_ACCESS_TOKEN de Railway.

### 4.1 Configurar info del negocio

```bash
curl -X POST \
  "https://graph.facebook.com/v25.0/{PHONE_ID}/whatsapp_business_profile" \
  -H "Authorization: Bearer {TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "messaging_product": "whatsapp",
    "about": "Repuestos automotrices - Melipilla y San Felipe",
    "description": "Venta de repuestos automotrices nuevos y usados. Cotiza por WhatsApp y recibe tu presupuesto en minutos. Envios a todo Chile.",
    "address": "Ortuzar 531, Melipilla, Chile",
    "vertical": "AUTO",
    "websites": ["https://repuestosjfnn.cl"]
  }'
```

### 4.2 Subir foto de perfil (si tienes el archivo JPG listo)

```bash
# Paso A: Crear sesion de upload
curl -X POST \
  "https://graph.facebook.com/v25.0/2553364111727691/uploads" \
  -H "Authorization: OAuth {TOKEN}" \
  -F "file_length=$(wc -c < perfil.jpg | tr -d ' ')" \
  -F "file_name=perfil.jpg" \
  -F "file_type=image/jpeg"

# Esto devuelve: {"id": "upload:XXXXXXXXX"}

# Paso B: Subir la imagen
curl -X POST \
  "https://graph.facebook.com/v25.0/upload:XXXXXXXXX" \
  -H "Authorization: OAuth {TOKEN}" \
  -H "file_offset: 0" \
  -H "Content-Type: image/jpeg" \
  --data-binary @perfil.jpg

# Esto devuelve: {"h": "handle:XXXXXXXXXXXXXXXX"}

# Paso C: Asignar al perfil
curl -X POST \
  "https://graph.facebook.com/v25.0/{PHONE_ID}/whatsapp_business_profile" \
  -H "Authorization: Bearer {TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"messaging_product": "whatsapp", "profile_picture_handle": "handle:XXXXXXXXXXXXXXXX"}'
```

### 4.3 Verificar que todo quedo bien

```bash
curl -s "https://graph.facebook.com/v25.0/{PHONE_ID}/whatsapp_business_profile?fields=about,address,description,email,websites,vertical,profile_picture_url" \
  -H "Authorization: Bearer {TOKEN}" | python3 -m json.tool
```

---

## PASO 5 — Test rapido (5 min)

1. Desde **otro telefono**, enviar un mensaje al numero productivo de Melipilla
2. Verificar en **Railway logs** que el webhook lo recibe
3. Verificar que el **agente IA responde**
4. Abrir **panel.repuestosjfnn.cl** > Chat > verificar que aparece la conversacion
5. Enviar un mensaje desde el dashboard al cliente > verificar que llega

---

## PASO 6 — Si algo sale mal (Rollback)

Si el numero nuevo no funciona:

1. En Railway, cambiar `WHATSAPP_PHONE_ID` de vuelta a `1066882779849103` (numero de prueba)
2. El sistema vuelve a funcionar con el numero de prueba inmediatamente
3. Investigar que fallo y reintentar

Si necesitas volver a usar WhatsApp Business en el telefono:
1. Instalar WhatsApp Business
2. Verificar con el numero (OTP)
3. Los chats antiguos se perdieron, pero estan en la base de datos del sistema

---

## Checklist final

- [ ] Cuenta eliminada del telefono
- [ ] 5 minutos de espera cumplidos
- [ ] Numero registrado en Meta (estado "Conectado")
- [ ] Phone Number ID anotado
- [ ] Variable `WHATSAPP_PHONE_ID` actualizada en Railway
- [ ] Railway redeploy completado (verificar logs)
- [ ] Perfil de negocio configurado (nombre, descripcion, direccion)
- [ ] Foto de perfil subida
- [ ] Test: mensaje entrante funciona
- [ ] Test: respuesta del agente IA funciona
- [ ] Test: mensaje desde dashboard funciona
- [ ] PIN de verificacion en dos pasos anotado en lugar seguro
