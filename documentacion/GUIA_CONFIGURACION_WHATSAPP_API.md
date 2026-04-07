# Guía: Configurar WhatsApp Business API desde Cero (Modo Pruebas)

Esta guía te lleva paso a paso desde crear una app en Meta hasta tener tu `.env` listo para hacer pruebas con un número de test **sin tocar el número oficial del local**.

---

## 📋 Requisitos Previos

- Una cuenta personal de Facebook.
- Un navegador web (Chrome recomendado).
- Acceso a tu proyecto backend (`/backend/.env`).

---

## Paso 1: Crear o Acceder al Business Portfolio (Meta Business Suite)

1. Ve a [business.facebook.com](https://business.facebook.com/).
2. Si ya tienes un portafolio → selecciónalo.
3. Si creaste uno **nuevo** → haz clic en el portafolio recién creado para entrar.
4. Asegúrate de estar en el portafolio correcto mirando el nombre arriba a la izquierda.

> [!TIP]
> Si es la primera vez, Meta te pedirá un nombre para el portafolio. Usa algo como: `JFNN Repuestos - Dev` para diferenciarlo del de producción.

---

## Paso 2: Crear la App de Desarrollo en Meta

1. Ve a [developers.facebook.com/apps](https://developers.facebook.com/apps/).
2. Haz clic en **"Crear app"**.
3. Selecciona:
   - **Tipo de app**: `Negocio` (Business)
   - **Nombre de la app**: `JFNN WhatsApp Dev` (o similar, para diferenciar)
   - **Portafolio de negocio**: Selecciona el portafolio del Paso 1.
4. Haz clic en **"Crear app"**.
5. Meta te mostrará el panel de la app recién creada.

---

## Paso 3: Agregar el Producto "WhatsApp"

1. En el panel de la app, busca la sección **"Agregar productos a tu app"**.
2. Busca **"WhatsApp"** y haz clic en **"Configurar"**.
3. Te llevará al panel de WhatsApp → **"Comenzar"**.

---

## Paso 4: Obtener las Credenciales (lo más importante)

Una vez dentro del panel de WhatsApp de tu app, verás la sección **"API Setup"** (Configuración de API):

### 4.1 — Token de Acceso Temporal

1. En la sección **"Temporary access token"**, haz clic en **"Generate"** (o copia el que ya aparece).
2. **Copia este token** → este es tu `WHATSAPP_ACCESS_TOKEN`.

> [!WARNING]
> **Este token expira en 24 horas.** Cada vez que vayas a hacer pruebas después de un día, tendrás que volver aquí y generar uno nuevo. Más adelante te explico cómo obtener uno permanente.

### 4.2 — Phone Number ID (ID del Teléfono de Pruebas)

1. En la misma pantalla de API Setup, busca la sección **"From"** (Desde).
2. Meta te asigna un **número de pruebas** automáticamente (algo como `+1 555 XXX XXXX`).
3. Debajo del número verás: **Phone number ID**: un número largo como `1073821205809165`.
4. **Copia este ID** → este es tu `WHATSAPP_PHONE_ID`.

### 4.3 — Número de Destino (Para Pruebas)

1. En la sección **"To"** (Hacia), haz clic en **"Manage phone number list"**.
2. Agrega tu número personal de WhatsApp (con código de país, ej: `+56 9 XXXX XXXX`).
3. Meta te enviará un código de verificación por WhatsApp. Ingresa el código.
4. Ahora puedes enviar mensajes de prueba a tu número.

> [!IMPORTANT]
> En modo desarrollo, solo puedes enviar mensajes a números que hayas verificado en este paso. Puedes agregar hasta 5 números.

---

## Paso 5: Configurar el Webhook (Para Recibir Mensajes)

Para que tu backend **reciba** los mensajes que el cliente envía, necesitas un webhook público.

### 5.1 — Exponer tu Servidor Local con ngrok

1. Si no tienes ngrok instalado:
   ```bash
   brew install ngrok
   ```

2. Abre una terminal **aparte** y ejecuta:
   ```bash
   ngrok http 4000
   ```

3. ngrok te dará una URL como:
   ```
   https://abc123def456.ngrok-free.app
   ```

4. **Copia esa URL** → la necesitas para el siguiente paso.

> [!CAUTION]
> Cada vez que reinicias ngrok, la URL cambia (en el plan gratuito). Si la URL cambia, debes actualizar el webhook en Meta.

### 5.2 — Registrar el Webhook en Meta

1. En el panel de WhatsApp de tu app, ve a la sección **"Configuration"** (Configuración).
2. En **"Webhook"**, haz clic en **"Edit"** (Editar).
3. Completa:
   - **Callback URL**: `https://TU-URL-NGROK.ngrok-free.app/api/whatsapp/webhook`
   - **Verify Token**: `jfnn_seguro_2026` (debe coincidir con tu `.env`)
4. Haz clic en **"Verify and Save"**.
5. Si todo está bien, Meta verificará tu webhook con un `GET` y verás ✅.

### 5.3 — Suscribir a Eventos de Mensajes

1. Después de verificar, en la misma sección de Webhooks verás una tabla de "Webhook fields".
2. Busca **"messages"** y haz clic en **"Subscribe"** (Suscribir).
3. Esto le dice a Meta: "Avísame cuando alguien me escriba un mensaje".

---

## Paso 6: Actualizar tu .env

Abre tu archivo `/backend/.env` y actualiza estas 3 variables:

```env
# ═══════════════════════════════════════════
# WhatsApp Business API — Credenciales
# ═══════════════════════════════════════════

# Token de acceso (regenerar cada 24h en modo dev)
WHATSAPP_ACCESS_TOKEN=EAAxxxxxxxxxxxxxxxxx...

# ID del teléfono de pruebas (copiado del paso 4.2)
WHATSAPP_PHONE_ID=1234567890123456

# Token de verificación del webhook (inventado por ti, debe coincidir con Meta)
WHATSAPP_VERIFY_TOKEN=jfnn_seguro_2026
```

---

## Paso 7: Verificar que Todo Funciona

1. Inicia tu backend:
   ```bash
   cd backend && npm run dev
   ```

2. Verifica que ngrok esté corriendo y apuntando al puerto 4000.

3. Desde tu WhatsApp personal (el número que verificaste en el paso 4.3), envía un mensaje al **número de pruebas de Meta** (el que aparece en "From" en el panel de API Setup).

4. **✅ Esperado**:
   - En la terminal del backend verás:
     ```
     [Webhook] Mensaje recibido de 569XXXXXXXX. Iniciando buffer de espera de 15s...
     ```
   - Después de 15 segundos, el bot responde con el flujo de perfilamiento.

5. **❌ Si no llega nada**: Revisa:
   - Que ngrok esté activo y apuntando a `http 4000`.
   - Que la URL del webhook en Meta coincida con la de ngrok.
   - Que el campo "messages" esté suscrito.
   - Que el token no haya expirado.

---

## 🔄 Rutina Diaria de Desarrollo

Cada vez que vayas a hacer pruebas:

| Paso | Acción | ¿Cuándo? |
|------|--------|----------|
| 1 | Iniciar ngrok (`ngrok http 4000`) | Siempre |
| 2 | Copiar la nueva URL de ngrok | Si cambió |
| 3 | Actualizar webhook en Meta con nueva URL | Si cambió |
| 4 | Regenerar Access Token en Meta | Si pasaron +24h |
| 5 | Actualizar `WHATSAPP_ACCESS_TOKEN` en `.env` | Si regeneraste |
| 6 | Reiniciar backend (`npm run dev`) | Si cambiaste `.env` |

---

## 🔐 Paso Opcional: Token Permanente (Producción)

El token temporal expira en 24h. Para producción necesitas un **System User Token**:

1. Ve a [business.facebook.com/settings/system-users](https://business.facebook.com/settings/system-users).
2. Crea un **"System User"** (Usuario del sistema) con rol **Admin**.
3. Asigna los permisos:
   - `whatsapp_business_management`
   - `whatsapp_business_messaging`
4. Genera un token para ese System User → selecciona tu app y los permisos.
5. Este token **no expira** → úsalo como `WHATSAPP_ACCESS_TOKEN` en producción.

> [!WARNING]
> **NUNCA** subas el token permanente a GitHub. Debe estar solo en `.env` y este archivo debe estar en `.gitignore`.

---

## 🎯 Diferencia: Número de Pruebas vs Número Oficial

| Característica | Número de Pruebas (Meta) | Número Oficial |
|----------------|--------------------------|----------------|
| Costo | Gratis | Gratis (con límites) |
| Quién puede recibir | Solo números verificados (máx 5) | Cualquier persona |
| Nombre que ve el cliente | "Test Number" | El nombre de tu negocio |
| Sirve para desarrollo | ✅ Perfecto | ❌ No tocar para pruebas |
| Limitaciones | 1000 msgs/día | Según tier de Meta |

**Recomendación**: Usa **siempre** el número de pruebas para desarrollo. Solo vincula el número oficial cuando el sistema esté validado y listo para producción.

---

## 📁 Estructura de Variables .env Completa

```env
# ─── Servidor ───────────────────────
PORT=4000

# ─── Base de Datos ──────────────────
DATABASE_URL=postgresql://jfnn_user:jfnn_password@localhost:5433/jfnn_db

# ─── WhatsApp Business API ─────────
WHATSAPP_ACCESS_TOKEN=EAAxxxxx...
WHATSAPP_PHONE_ID=1234567890123456
WHATSAPP_VERIFY_TOKEN=jfnn_seguro_2026

# ─── Gemini AI ──────────────────────
GEMINI_API_KEY=AIzaSyXxxxxxxx...

# ─── Google Reviews ─────────────────
GOOGLE_REVIEW_URL=https://g.page/r/xxxxx/review

# ─── Auto-Archivado (opcional) ──────
AUTO_ARCHIVE_HOURS=48

# ─── Plantillas HSM (opcional) ──────
# WHATSAPP_TEMPLATE_COTIZACION=cotizacion_lista
# WHATSAPP_TEMPLATE_RETOMAR=retomar_cotizacion
```

---

*Documento generado para JFNN Omnicanal SaaS — Última actualización: Abril 2026*
