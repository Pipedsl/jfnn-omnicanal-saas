# Guía: Cómo Crear Plantillas de Mensajes (HSM) en WhatsApp Business

Esta guía explica paso a paso cómo registrar las plantillas necesarias para que JFNN pueda enviar mensajes a clientes **fuera de la ventana de 24 horas** de Meta.

---

## 📋 ¿Por qué necesitas esto?

Meta (Facebook) impone la siguiente regla:  
> **Solo puedes enviar mensajes de texto libre a un cliente si él te escribió en las últimas 24 horas.**

Si el cliente escribió un domingo, el local estaba cerrado, y respondes el martes → **Meta bloqueará tu mensaje**. La única forma de "reactivar" la conversación es usar una **Plantilla Pre-Aprobada (HSM)**.

---

## 🔧 Paso 1: Acceder al Business Manager

1. Ingresa a [business.facebook.com](https://business.facebook.com/)
2. Inicia sesión con la cuenta que administra el WhatsApp Business del local.
3. En el menú lateral, busca: **WhatsApp Manager** → **Gestión de cuentas** → **Plantillas de mensajes**.

> [!TIP]
> Si no ves la opción "Plantillas de mensajes", verifica que tu cuenta de WhatsApp Business API esté vinculada al Business Manager. Puedes verificarlo en **Configuración del negocio → Cuentas de WhatsApp**.

---

## 🔧 Paso 2: Crear la Plantilla de Cotización Lista

1. Haz clic en **"Crear plantilla"**.
2. Completa los campos iniciales:

| Campo | Valor |
|---|---|
| **Nombre** | `cotizacion_lista` |
| **Categoría** | `UTILITY` (Utilidad) |
| **Idioma** | `Español (Spanish)` |

3. En el **Cuerpo de la plantilla (Body)**, escribe copiar y pegar el siguiente texto exacto:

```text
¡Hola {{nombre}}! 👋 Tu asesor de Repuestos JFNN ya tiene lista tu cotización de {{repuesto}}.

¿Te gustaría revisar los detalles ahora?
```

> **Configuración de Variables:**  
> Meta ahora exige que las variables tengan nombres descriptivos (todo en minúsculas y sin espacios):
> - `{{nombre}}` = Nombre del cliente
> - `{{repuesto}}` = Vehículo o Repuesto solicitado  
> *(La plataforma podría pedirte muestras de contenido para estas variables. Para la muestra {{nombre}} puedes poner "Felipe" y para la {{repuesto}} puedes poner "Amortiguadores".)*

4. En la sección **Botones (Opcional)**, añade botones interactivos para facilitar la respuesta:
   - Haz clic en **"+ Agregar botón"** y elige **"Respuesta rápida"**.
   - **Botón 1:** `Sí, revisar`
   - **Botón 2:** `No por ahora`

5. Haz clic en el botón azul **"Enviar para revisión"**.
6. **Espera la aprobación**: Meta revisa las plantillas, lo cual suele ser en minutos (o en su defecto entre 1 a 24 horas). Te llegará una notificación cuando sea aprobada.

---

## 🔧 Paso 3: Crear la Plantilla de Re-enganche

Esta plantilla es para clientes que abandonaron su cotización y vuelven a aparecer después de tiempo:

| Campo | Valor |
|---|---|
| **Nombre** | `retomar_cotizacion` |
| **Categoría** | `UTILITY` |
| **Idioma** | `es` |

**Cuerpo:**
```text
Hola {{nombre}} 👋, vimos que dejaste pendiente una cotización para {{repuesto}}. ¿Te gustaría retomarla o prefieres empezar una nueva?

Estamos para ayudarte. 🚗
```

> **Configuración de Variables:**  
> Al igual que en la primera plantilla, usa los nombres:
> - `{{nombre}}` (Muestra: "Felipe")
> - `{{repuesto}}` (Muestra: "Amortiguadores")

**Botones (Opcional pero Recomendado):**
   - Agrega **Respuesta rápida**:
   - **Botón 1:** `Sí, retomarla`
   - **Botón 2:** `No, gracias`
   - **Botón 3:** `Empezar nueva`

---

## 🔧 Paso 4: Configurar el Nombre de la Plantilla en el Backend

Una vez aprobadas, necesitas agregar el nombre exacto de la plantilla en tu archivo `.env`:

```env
# Plantillas HSM de WhatsApp (poner el nombre exacto aprobado por Meta)
WHATSAPP_TEMPLATE_COTIZACION=cotizacion_lista
WHATSAPP_TEMPLATE_RETOMAR=retomar_cotizacion
```

> [!IMPORTANT]
> Las plantillas ya deben estar **aprobadas por Meta** antes de configurarlas aquí. Si intentas enviar una plantilla no aprobada, Meta responderá con un error `132015`.

---

## 🔧 Paso 5: Verificar que Funciona

1. Abre el Dashboard del sistema.
2. Busca una cotización que lleve más de 24 horas sin interacción del cliente.
3. Intenta enviar la cotización al cliente.
4. Si la ventana está cerrada, el sistema automáticamente intentará enviar la **plantilla HSM** en vez de un mensaje libre.
5. El cliente recibirá un mensaje formal con la plantilla. Si responde, **se reabre la ventana de 24h** y el vendedor puede enviar mensajes normales.

---

## ⚠️ Notas Importantes

- **Límite de plantillas**: Las cuentas Business básicas pueden tener hasta **250 plantillas**.
- **Costo**: Las conversaciones iniciadas con plantillas de utilidad tienen un costo por conversación (~$0.02 USD aprox.). Consulta [precios de Meta](https://developers.facebook.com/docs/whatsapp/pricing).
- **No spam**: Meta puede revocar tus plantillas si las usas de forma agresiva o fuera de contexto.
- **Plazo de revisión**: Puede tardar desde minutos hasta 24 horas hábiles.
- **Rechazos**: Si Meta rechaza tu plantilla, generalmente es porque contiene lenguaje promocional disfrazado. Mantén el tono neutro/informativo.

---

## 📞 ¿Problemas?

Si tienes dificultades con la aprobación de plantillas, los errores más comunes son:

| Error | Causa | Solución |
|---|---|---|
| `132015` | Plantilla no encontrada | Verificar el nombre exacto y que esté aprobada |
| `132001` | Parámetros inválidos | Verificar que envías todos los `{{N}}` requeridos |
| `131047` | Más de 24h sin respuesta | Necesitas usar la plantilla HSM (este caso) |
| `130472` | Ventana de conversación cerrada | Mismo caso, usar plantilla |

---

*Documento generado como parte del Sprint 3 - JFNN Omnicanal SaaS*
