# Mejoras del Agente — Análisis de chats reales

**Última actualización:** 2026-04-14 (ronda 2 — batch de 115 chats)
**Metodología:** replay local de `_chat.txt` exportados desde WhatsApp contra `gemini.service.generateResponse()` con sesiones mock en memoria. **No toca Supabase ni el webhook de producción (Railway).**
**Script:** `backend/scripts/test_chats_replay.js`
**Analizador de patrones:** `/tmp/analyze_replay.js`

---

## Muestra acumulada

| Ronda | Chats | Turnos simulados | Vehículos detectados |
|---|---|---|---|
| 1 (4 chats exploratorios) | 4 | 55 | 24 |
| 2 (batch masivo) | 115 | 361 | 122 |
| **Total** | **119** | **416** | **146** |

### Estadísticas globales (ronda 2, 361 turnos)

| Métrica | Valor | % |
|---|---|---|
| Turnos con respuesta del AI | 361 | 100% |
| Turnos con respuesta real del vendedor | 310 | 86% |
| Turnos donde el AI pidió **patente/VIN** | 312 | **86%** 🔴 |
| Turnos donde el AI pidió **VIN** explícitamente | 265 | **73%** 🔴 |
| Turnos donde pidió motor/cilindrada | 130 | 36% |
| Turnos donde pidió año | 46 | 13% |
| Turnos con **fallback por JSON inválido** | 8 | 2.2% 🔴 |
| Chats donde capturó `nombre_cliente` | 8/115 | **7%** 🔴 |
| Chats donde capturó `patente` (raíz) | 10/115 | 9% |
| Chats con multi-vehículo | 10/115 | 9% |
| **AI repitió "dame patente" en turnos consecutivos** | 192 veces | 🔴 |
| **Vendedor real dio precio sin exigir patente** (AI sí insistió) | 131 veces | 🔴 |

**Interpretación**: el 86% de los turnos el AI exige patente/VIN, pero en 131 de esos el vendedor humano simplemente cotizó sin esa información. Hay un gap fuerte entre la política del prompt y la operación real.

---

## Mejoras priorizadas

### 1. 🔴 CRÍTICO — Crash por JSON inválido de Gemini

**Evidencia (ronda 2):** 8 turnos con fallback genérico por `SyntaxError: Unexpected non-whitespace character after JSON`.

**Patrones de input que lo disparan:**
- Mensajes triviales cortos: "El fabricante?", "Es china?", "Muchas gracias por la información"
- Inputs con chasis largos: "KMHSH81DP9U509684"
- Adjuntos sin contexto: "imagen omitida", "audio omitido"
- Estados vacíos: "Hola buenas tardes" (inicio sin datos previos)

**Causa raíz:** `generationConfig` solo usa `response_mime_type: application/json`. Gemini a veces añade comentarios explicativos fuera del JSON (típico con inputs muy cortos o ambiguos).

**Propuesta:**
1. Sanitizar antes de `JSON.parse` — extraer el primer bloque `{…}` balanceado con regex/parser.
2. Usar `responseSchema` de Gemini SDK con el contrato exacto para forzar validación.
3. Reintento silencioso (1 vez) con prompt "responde SOLO JSON, sin texto adicional" antes del fallback genérico.
4. Registrar en un contador de métricas cuándo cae al fallback para detectar regresiones en producción.

**Archivo:** `backend/services/gemini.service.js:217-226`

---

### 2. 🔴 CRÍTICO — Insistencia excesiva con patente/VIN (86% de turnos)

**Evidencia (ronda 2):**
- 312/361 turnos (86%) el AI pide patente/VIN.
- 265/361 (73%) pide VIN — la mayoría de clientes particulares NO tiene a mano su VIN.
- En **131 turnos** el vendedor real dio un precio directo mientras el AI seguía pidiendo patente.
- 192 veces el AI repitió la petición en turnos consecutivos al mismo cliente.

**Casos concretos:**
- `_chat 10.json`: Cliente "kit embrague chevrolet sail 1.4 lt" → AI pide patente → Real: "SI DISPONIBLE KOREA MARCA SECO $80.000"
- `_chat 100.json`: "kit embrague new accent 2010" → AI pide patente → Real: "VALEO KOREA $75.000, BENCINERO"
- `_chat 101.json`: "cilindro freno trasero izquierdo" → AI pide patente → Real: "Sale $16.000"

**Impacto:** fricción con el 86% de la interacción. El AI genera mal sentimiento por aparecer burocrático cuando el humano atendería directo.

#### Solución definitiva (decisión de producto)

**Delegar el criterio de compatibilidad al vendedor, no al AI.** El vendedor ya sabe qué piezas son críticas (bandejas, soportes, cremalleras) y cuáles no (filtros, aceite, bujías). Es más fiable que cualquier heurística estática en el prompt.

El comportamiento tiene **dos modos** según quién dispara la petición:

| Modo | Disparo | Comportamiento del AI |
|---|---|---|
| **Suave (default)** | El AI detecta pieza ambigua por su cuenta | Pide patente **1 sola vez** amablemente. Si el cliente no la da, avanza con los datos disponibles y NO insiste. |
| **Obligatorio** | Vendedor presiona botón "Solicitar Patente" o "Solicitar VIN" en el dashboard | El AI insiste en cada turno hasta recibir el dato. NO puede avanzar con la cotización. Es bloqueante. |

**Cambios necesarios:**

1. **AI: pedir máximo 1 vez en modo suave, bloquear en modo obligatorio**
   - Reemplazar en `gemini.service.js:74-82` la regla dura "NO puedes avanzar sin PATENTE o VIN" por lógica condicional según flags de sesión:
     ```
     Si sessionContext.entidades.solicitud_manual_patente === true:
       BLOQUEANTE — debes exigir patente al cliente en CADA turno hasta recibirla. No cotices ni avances sin ella.
     Si sessionContext.entidades.solicitud_manual_vin === true:
       BLOQUEANTE — debes exigir VIN al cliente en CADA turno hasta recibirlo. No cotices ni avances sin él.
     En caso contrario (modo suave):
       Puedes pedir patente UNA SOLA VEZ si la pieza parece crítica de compatibilidad. Si el cliente no la da, avanza normalmente con los datos que tengas (marca/modelo/año/motor) y NO vuelvas a preguntarla.
     ```
   - Cuando el cliente entrega el dato y el backend lo captura en `entidades.patente` / `entidades.vin`, los flags `solicitud_manual_*` se limpian automáticamente en `sessions.service.js` (el merge pisa el flag a `false` cuando llega el dato real).
   - Eliminar mención explícita de "VIN" en modo suave (intimida al cliente particular). En modo obligatorio sí se puede mencionar.

2. **Dashboard: agregar botón "Solicitar Patente" por repuesto** (complemento al "Solicitar VIN" existente)
   - **Ya existe** botón "Solicitar VIN" por repuesto en `dashboard/components/QuoteCard.tsx:474` (multi-vehículo) y `:609` (single) que llama `POST /api/dashboard/solicitar-vin`.
   - **Agregar** botón paralelo "Solicitar Patente" justo al lado, que llame a un nuevo endpoint `POST /api/dashboard/solicitar-patente`.
   - Cada botón es por repuesto/línea. El vendedor decide por qué pieza específica necesita el dato.
   - **Visual**: mientras el flag `solicitud_manual_*` está activo en la sesión, mostrar un badge de estado "⚠️ Esperando patente del cliente" en la tarjeta, para que el vendedor sepa que el bloqueo está activo.
   - Quitar el tooltip actual "Se requiere patente para solicitar VIN" — ya no se bloqueará el botón de VIN si no hay patente (el vendedor decide el orden y cuál priorizar).

3. **Backend: nuevo endpoint + activación de flag bloqueante**
   - **Endpoint**: `POST /api/dashboard/solicitar-patente` en `backend/routes/dashboard.routes.js` (espejo del bloque actual en líneas 863-886 para `solicitar-vin`).
     - Recibe `{ phone, itemName }`.
     - Dispara mensaje WhatsApp con mención al repuesto si viene:
       ```
       Hola, para verificar la compatibilidad exacta del repuesto "${itemName}", ¿podría enviarnos la patente de su vehículo por favor?
       ```
     - **IMPORTANTE**: antes de enviar el mensaje, setea en la sesión del cliente `entidades.solicitud_manual_patente = true` vía `sessionsService.mergeEntidades()`. Esto activa el modo bloqueante del AI para los próximos turnos.
     - Responde `200 { success: true }`.
   - **Endpoint existente `solicitar-vin`**: hacer el mismo cambio — setear `entidades.solicitud_manual_vin = true` en la sesión antes de enviar el WhatsApp. Actualmente (líneas 868-886) solo envía el mensaje sin persistir el estado, por lo que el AI no sabe que el vendedor activó el bloqueo.
   - **Auto-limpieza del flag**: en `sessions.service.js mergeEntidades`, cuando llegue `entidades.patente` con valor no-null, setear `solicitud_manual_patente = false`. Idem para VIN.

4. **Sesión (PostgreSQL → JSONB entidades)**: agregar campos:
   - `solicitud_manual_patente: boolean` (default `false`)
   - `solicitud_manual_vin: boolean` (default `false`)
   - No requiere migración de schema — ya van en `entidades` JSONB.

**Archivos afectados:**
- `backend/services/gemini.service.js:74-82` — lógica condicional suave/bloqueante en prompt
- `backend/routes/dashboard.routes.js:868-886` — modificar `solicitar-vin` para setear flag
- `backend/routes/dashboard.routes.js` (nuevo endpoint ~887+) — `solicitar-patente`
- `backend/services/sessions.service.js mergeEntidades` — auto-limpieza de flags al recibir el dato
- `dashboard/components/QuoteCard.tsx:124-127` — nueva función `handleSolicitarPatente`
- `dashboard/components/QuoteCard.tsx:474, 609` — botón "Solicitar Patente" + badge de estado

**Beneficios esperados:**
- Modo suave (default ~90% de casos): baja de 86% → ~15% de turnos pidiendo patente.
- Modo obligatorio: el vendedor activa bloqueo con un clic cuando la compatibilidad lo exige. El AI hace el trabajo sucio de insistir sin intervención humana adicional.
- El vendedor mantiene 100% del control sobre cuándo la compatibilidad requiere precisión.
- El cliente no ve al AI como interrogativo por defecto, solo cuando realmente hace falta.

---

### 3. 🟠 ALTO — Captura de nombre del cliente muy pobre (7%)

**Evidencia (ronda 2):** Solo 8/115 chats (7%) terminaron con `nombre_cliente` poblado.

**Patrones que el AI está perdiendo:**
- Autoidentificaciones informales: "soy el kike", "rey", "master", "don"
- Despedidas firmadas: "gracias, Juan"
- Saludos al negocio: "hola master" es el cliente hablándole al vendedor (no su nombre)

**Impacto:** al quedarse sin nombre, en la fase CONFIRMANDO_COMPRA el AI tiene que pedirlo explícitamente (fricción innecesaria), y no puede personalizar el saludo para clientes recurrentes.

**Propuesta:**
1. Reforzar en el prompt: "Si detectas cualquier forma de autoidentificación ('soy X', 'me llamo X', 'habla X', 'mi nombre es X', firmas tipo 'saludos, Juan'), captura en `nombre_cliente`."
2. Pre-carga desde BD: `SELECT nombre FROM clientes WHERE telefono = $1` antes de llamar a Gemini — si existe, inyectar en `sessionContext.entidades.nombre_cliente` para que no lo tenga que redescubrir.
3. Prompt: clarificar que palabras como "master", "don", "señor", "rey", "jefe" son formas de dirigirse al vendedor, NO el nombre del cliente.

**Archivos:** `backend/services/gemini.service.js` (prompt), `backend/controllers/whatsapp.controller.js` (pre-carga)

---

### 4. 🟠 ALTO — Propagación incorrecta de patente entre vehículos

**Síntoma (ronda 1):** Una patente recibida suelta se propaga como patente de múltiples vehículos distintos en `vehiculos[]`.

**Evidencia (ronda 1, chat +56 9 4035 0723):** Cliente envió `YZ1914` para Kia Rio, terminó asignada a Luv, Optra y Rio simultáneamente.

**Evidencia (ronda 2):** Menos frecuente (el batch tiene pocos chats multi-vehículo, solo 10/115), pero el patrón persiste cuando aparece.

**Propuesta:**
1. En prompt: "Si la patente llega suelta SIN referencia explícita al vehículo, SOLO asígnala al vehículo cuyo último mensaje del cliente mencionó directamente."
2. En `sessions.service.js mergeEntidades`: nunca copiar `patente` de raíz a múltiples entries de `vehiculos[]`. Solo al vehículo cuyo nombre aparezca en el último `userText`.
3. Validación: si la patente no matchea formato chileno válido (`[A-Z]{2,4}\d{2,4}`), rechazarla y pedir aclaración.

**Archivos:** `backend/services/gemini.service.js` (prompt), `backend/services/sessions.service.js` (mergeEntidades)

---

### 5. 🟠 ALTO — Repuestos huérfanos en array raíz (multi-vehículo)

**Evidencia (ronda 2):** En todos los chats multi-vehículo analizados aparecen repuestos en `repuestos_solicitados[]` raíz que pertenecen por contexto a un vehículo específico.

Ejemplos:
- `_chat 101.json` (Yaris + Morning): "cilindro freno trasero izquierdo" huérfano. Por contexto era del Yaris.
- `_chat 67.json` (Spark Lt + Hyundai + Chery Tiggo 2): "cinta del airbag", "piola del embrague", "par de bandejas" y otros quedaron en raíz.
- `_chat 58.json` (Ssangyong + Optra): "empaquetadura de tapa de válvulas" huérfana.
- `_chat 106.json` (Apache S10 + Tiida + Kia Frontier): "repuesto según fotografía" huérfano.

**Causa raíz:** el prompt dice "si hay repuestos para vehículo desconocido, agrégalos temporalmente en `repuestos_solicitados[]` raíz", pero el AI usa esa válvula de escape con demasiada facilidad en vez de inferir por contexto.

**Propuesta:**
1. Endurecer la regla: "Solo usa `repuestos_solicitados[]` raíz si NO hay ningún vehículo en foco en los últimos 3 turnos del cliente Y no puedes inferirlo por contexto. Si hay un único vehículo mencionado recientemente, asígnalo a ese."
2. Post-procesamiento automático: si queda solo 1 vehículo en la sesión y hay repuestos en raíz, moverlos automáticamente al vehículo en `sessions.service.js`.
3. Evitar placeholders vacíos como "repuesto según fotografía" / "repuesto según imagen" — usar flag `requiere_revision_foto: true` en vez de crear entries falsos.

**Archivos:** `backend/services/gemini.service.js` (prompt), `backend/services/sessions.service.js` (post-merge)

---

### 6. 🟡 MEDIO — Saludos ambiguos disparan interrogatorio completo

**Evidencia (ronda 2):** En 5 casos confirmados, un simple "Hola" o "Buenas tardes" dispara respuesta del tipo "¿marca, modelo, año, motor y patente o VIN?".

Ejemplos:
- `_chat 77.json`: "Hola" → AI: "Hola, bienvenido. ¿Qué repuestos busca y cuál es la patente, año y motor de su vehículo?"
- `_chat 88.json`: "Hola" → AI: "¿Qué repuestos necesita y de qué vehículo (marca, modelo, año y patente o VIN)?"
- `_chat 6.json`, `_chat 76.json`, `_chat 85.json`: mismo patrón.

**Impacto:** arranque frío hostil. El vendedor humano simplemente devuelve el saludo y espera.

**Propuesta:**
1. **Pre-filtro en `whatsapp.controller.js`**: si el mensaje del cliente matchea regex de saludo puro (`/^(hola|buen[oa]s|hey)[\s.,!?¡¿👋🙏]*$/i`) y no hay entidades previas, responder localmente con un saludo corto sin llamar a Gemini.
2. **O en el prompt**: "Si el cliente solo saluda sin dar contexto, responde con un saludo breve y pregunta abierta '¿En qué puede ayudarle hoy?'. NO pidas datos del vehículo hasta que mencione uno."

**Archivo:** `backend/services/gemini.service.js` o `backend/controllers/whatsapp.controller.js`

---

### 7. 🟡 MEDIO — Detección de cliente recurrente

**Evidencia:** Kike (ronda 1) y varios clientes del batch muestran patrones de recurrencia ("soy el kike", referencias a compras previas, "master", "rey"). El AI trata cada conversación como primera.

**Propuesta:**
1. En `whatsapp.controller.js`, antes de llamar a Gemini, hacer `SELECT * FROM clientes WHERE telefono = $1`.
2. Si existe, inyectar en `sessionContext.entidades`:
   - `nombre_cliente`
   - `vehiculos_historicos[]` (últimos 3-5 con patentes)
   - `flag es_recurrente: true`
3. En el prompt: si `es_recurrente=true`, saludar por nombre y NO repetir preguntas ya respondidas en compras anteriores.

**Archivos:** `backend/controllers/whatsapp.controller.js`, `backend/services/gemini.service.js`, `backend/sql/init.sql` (tabla `clientes`)

---

### 8. 🟡 MEDIO — Vehículo fantasma por typo

**Evidencia (ronda 1):** Kike turno #14 → "Koml 2008 Turbo" era continuación de H100 del turno previo. El AI creó vehículo nuevo "Koml".

**Evidencia (ronda 2):** Patrones similares en chats con modelos mal escritos ("tida" por "tiida", "aveo" ambiguo).

**Propuesta:**
1. Catálogo de marcas/modelos válidos en `knowledge-base.md` o código (Toyota, Nissan, Chevrolet, Hyundai, Kia, Mazda, Ford, Chery, Ssangyong, Suzuki, etc.).
2. En el prompt: "Si la marca del cliente no está en el catálogo conocido, asume que es continuación del vehículo anterior del turno y pide aclaración amable: '¿Sería para la H100 que me mencionaste antes?'"

**Archivo:** `backend/services/gemini.service.js`

---

### 9. 🟢 BAJO — Placeholders inútiles para imágenes sin identificar

**Evidencia (ronda 2):** Aparecen entries como `"repuesto según fotografía"`, `"repuesto según imagen"` en `repuestos_solicitados` raíz en vez de usar el mecanismo adecuado (`identifyPartFromImage`).

**Propuesta:**
- No insertar placeholders textuales para imágenes. Si se recibió una foto y no se identificó, dejar un flag `pendiente_identificacion_foto: true` en la sesión y que el asesor humano la resuelva en el dashboard.
- Alternativamente usar `identifyPartFromImage()` del mismo `gemini.service.js` (ya existe) y guardar el `nombre_sugerido` real.

**Archivo:** `backend/services/gemini.service.js` + `whatsapp.controller.js`

---

### 10. 🟢 BAJO — Petición excesiva de "motor/cilindrada/combustible"

**Evidencia (ronda 2):** 130/361 turnos (36%) pide motor. En muchos casos innecesario para piezas comunes como filtros, bujías de marca única, correas de distribución estándar.

**Propuesta:** combinar con mejora #2 — lista de piezas "no-críticas-motor" donde omitir la pregunta de cilindrada.

---

## Fortalezas confirmadas (NO tocar en refactor)

- ✅ Extracción multi-vehículo funciona (10 chats multi-vehículo procesados con detección correcta de cada vehículo).
- ✅ Normalización de typos en nombres de piezas ("Viela"→"biela", "kañeria"→"cañería", "tida"→"tiida").
- ✅ Captura de cantidades implícitas (2 extremos, 4 bujías, par amortiguadores).
- ✅ Regla "nunca dar precios" se respeta en el 100% de los turnos (0/361 precios dados por AI).
- ✅ Manejo de imágenes y audio sin crashear (respuestas graciosas, aunque 8 crashean por JSON).
- ✅ Tono semiformal coherente y longitud ≤2 frases en la mayoría de respuestas.

---

## Cómo reproducir las pruebas

```bash
# Procesar todos los _chat*.txt sueltos en whatsapps/ con límite de 2min por chat
node backend/scripts/test_chats_replay.js \
  --loose-chats \
  --time-limit-per-chat=120 \
  --delete-after \
  --save-results=/tmp/replay_results

# Después, correr analizador de patrones
node /tmp/analyze_replay.js
```

Requiere: `backend/.env` con `GEMINI_API_KEY` válida.

El script:
- **NO** escribe en Supabase
- **NO** llama al webhook de Railway
- Todo es local en memoria
- Los JSONs de cada chat quedan en `/tmp/replay_results/*.json` para análisis

---

## Roadmap sugerido (orden de impacto)

| # | Mejora | Impacto | Esfuerzo | Archivo principal |
|---|---|---|---|---|
| 1 | Fix JSON parse crash | Alto (evita 2.2% de fallas) | Bajo | `gemini.service.js` |
| 2 | Relajar exigencia de patente/VIN | Muy alto (86%→~30% de turnos) | Medio | `gemini.service.js` prompt |
| 3 | Mejor captura de `nombre_cliente` | Alto (7%→50%+) | Bajo | `gemini.service.js` prompt |
| 4 | Fix propagación patente multi-veh | Medio | Medio | `sessions.service.js` |
| 5 | Asignar huérfanos al vehículo correcto | Medio | Medio | ambos |
| 6 | Saludos ambiguos sin interrogatorio | Medio | Bajo | pre-filtro controller |
| 7 | Cliente recurrente desde BD | Alto (requiere cambios en BD) | Alto | controller + prompt |
| 8 | Catálogo de marcas válidas | Bajo | Bajo | knowledge-base |
| 9 | No placeholders de imagen | Bajo | Bajo | prompt |
| 10 | Menos pregunta de motor | Bajo | Bajo | prompt (junto con #2) |
