# Plan de Pruebas Manuales — Sprint 4
**Módulo de Métricas (P0) + Entrenador IA HU-7 (P2)**

> **Cómo usar este documento:**
> Ejecutamos cada paso juntos. Marca con `✅` cuando pase o `❌` con el error encontrado para que lo resolvamos en el momento.

---

## ⚙️ PRE-REQUISITOS — Levantar el entorno

Antes de cualquier prueba, verificar que los servicios estén corriendo.

### P1 — Docker (PostgreSQL)
```bash
cd /Users/felipenavarretenavarrete/Desktop/RepuestosJFNN/jfnn-omnicanal-saas
docker ps --filter name=jfnn_postgres --format "{{.Names}} {{.Status}}"
```
**Esperado:** `jfnn_postgres Up ...`

- [ ] ✅ PostgreSQL corriendo en puerto `5433`

---

### P2 — Backend (Node.js)
En una terminal separada:
```bash
cd backend
npm run dev
```
**Esperado en consola:**
```
[Gemini] ✅ knowledge-base.md cargado correctamente.
Servidor corriendo en puerto 4000
```

Verificar con:
```bash
curl http://localhost:4000/
```
**Esperado:** `JFNN Omnicanal API is running`

- [ ] ✅ Backend en `http://localhost:4000`

---

### P3 — Frontend (Next.js)
En otra terminal:
```bash
cd dashboard
npm run dev
```
**Esperado:** `ready - started server on http://localhost:3000`

- [ ] ✅ Dashboard en `http://localhost:3000`

---

## 📊 PRUEBA 1 — Módulo de Métricas

### 1.1 — Endpoint de métricas (Backend)
```bash
curl http://localhost:4000/api/dashboard/metrics | python3 -m json.tool
```
**Esperado:** Objeto JSON con estas 6 claves (sin `NaN`, sin error):
```json
{
  "totalVendidoHoy": 0,
  "cantidadVentasHoy": 0,
  "ticketPromedioHoy": 0,
  "sesionesActivas": 0,
  "tiempoPromedioEsperaVendedorMins": 0,
  "tasaConversionHoy": 0
}
```

- [ ] ✅ Responde con 200 y valores numéricos (no NaN, no undefined)

---

### 1.2 — Componente DashboardMetrics en el Dashboard
1. Abrir `http://localhost:3000`
2. Verificar que aparecen las **6 tarjetas KPI** en la parte superior:
   - `Ventas Hoy`
   - `Conversión`
   - `Tiempo Esp. Prom.`
   - `Ticket Promedio`
   - `Sesiones Live`
   - `Ahorro IA`

- [ ] ✅ 6 cards visibles sin errores de React en consola del navegador
- [ ] ✅ No aparece `NaN` ni `undefined` en ninguna card

**Verificar en consola del navegador (F12 → Console):**
- [ ] ✅ Sin errores en rojo

---

### 1.3 — Auto-refresco de métricas
1. Dejar el Dashboard abierto
2. Esperar ~15 segundos
3. Observar si los números se actualizan (pueden mantenerse en 0 si no hay sesiones activas)

- [ ] ✅ No aparece error de red en Network tab cada 15s

---

## 🧠 PRUEBA 2 — HU-7: Entrenar al Agente IA

### 2.1 — Navegar a la sección de entrenamiento
1. Ir a `http://localhost:3000/settings`
2. Hacer clic en el botón lateral **"Entrenamiento IA"** (con ícono ✨ y badge BETA)

- [ ] ✅ Se muestra la sección de entrenamiento con:
  - Card "Entrenar al Agente IA" (con textarea vacío)
  - Card "Base de Conocimiento" (vacía inicialmente)

---

### 2.2 — Enviar un historial ficticio para entrenar
Copiar y pegar el siguiente texto en el textarea:

```
[10:15] Cliente: hola buenas, tengo un hyundai elantra 2018
[10:15] Vendedor: Hola! Buen día 🙂 ¿qué repuestos necesita para su Elantra?
[10:16] Cliente: necesito las bujías y el filtro de aire
[10:16] Vendedor: Para ese motor (1.6 bencina) necesita 4 bujías NGK. Las tenemos a $4.500 cada una.
[10:17] Cliente: perfecto, y el filtro?
[10:17] Vendedor: El filtro de aire para ese modelo está a $12.000. Siempre pedimos la patente para asegurarnos que sea el correcto.
[10:18] Cliente: la patente es BPKJ94
[10:18] Vendedor: Perfecto, anotado. Total: 4 bujías NGK ($18.000) + filtro de aire ($12.000) = $30.000. ¿Le cotizo formal?
[10:19] Cliente: sí, mándame la cotización
```

Luego hacer clic en el botón **"Entrenar Agente"**.

- [ ] ✅ Aparece spinner con texto "Gemini analizando chat..."
- [ ] ✅ Después de unos segundos aparece sección verde "✅ X reglas aprendidas"
- [ ] ✅ Se muestran las reglas extraídas como chips de colores (verde=precio, azul=tono, etc.)

---

### 2.3 — Verificar persistencia en base de datos
En una nueva terminal:
```bash
docker exec jfnn_postgres psql -U jfnn_user -d jfnn_db -c \
  "SELECT id, LEFT(contenido_md, 60) as regla, activo, fecha FROM training_examples ORDER BY fecha DESC LIMIT 10;"
```
**Esperado:** Filas con las reglas extraídas y `activo = t`

- [ ] ✅ Se ven registros en la tabla `training_examples`

---

### 2.4 — Verificar knowledge.json actualizado
```bash
cat /Users/felipenavarretenavarrete/Desktop/RepuestosJFNN/jfnn-omnicanal-saas/backend/data/knowledge.json
```
**Esperado:** JSON con las reglas aprendidas:
```json
{
  "reglas": [
    { "regla": "...", "categoria": "precio|tono|proceso|producto" }
  ],
  "ultima_actualizacion": "2026-..."
}
```

- [ ] ✅ `knowledge.json` tiene contenido (no vacío, `reglas` no es `[]`)

---

## 🗂️ PRUEBA 3 — HU-7: Persistencia y Gestión de Reglas

### 3.1 — Recargar la página y verificar que las reglas persisten
1. Presionar **F5** para recargar `http://localhost:3000/settings`
2. Ir a **"Entrenamiento IA"**
3. Revisar la sección **"Base de Conocimiento"**

- [ ] ✅ Las reglas anteriores siguen apareciendo como chips

---

### 3.2 — Eliminar una regla
1. Pasar el mouse por encima de cualquier regla (chip)
2. Aparece el ícono **✕** en el chip
3. Hacer clic en **✕**

- [ ] ✅ El chip desaparece inmediatamente de la UI
- [ ] ✅ El contador de reglas activas baja en 1

**Verificar en DB:**
```bash
docker exec jfnn_postgres psql -U jfnn_user -d jfnn_db -c \
  "SELECT id, activo FROM training_examples ORDER BY id;"
```
- [ ] ✅ El registro eliminado tiene `activo = f`

**Verificar knowledge.json actualizado:**
```bash
cat backend/data/knowledge.json
```
- [ ] ✅ La regla eliminada ya no aparece en `knowledge.json`

---

### 3.3 — Recargar para confirmar eliminación persistente
1. Presionar **F5**
2. Ir a **"Entrenamiento IA"**

- [ ] ✅ La regla eliminada **no** vuelve a aparecer

---

## 🔌 PRUEBA 4 — HU-7: Inyección en el System Prompt de Gemini

Esta prueba verifica que las reglas aprendidas se inyectan en el contexto de Gemini al procesar un mensaje real de WhatsApp.

### 4.1 — Verificar los logs del backend
Con el backend corriendo y **reglas en knowledge.json**, revisar los logs cuando llegue un mensaje de WhatsApp.

Si tienes acceso al webhook, envía un mensaje de prueba desde WhatsApp. Si no, verificar manualmente en el código:

```bash
# Ver logs del backend en tiempo real (terminal donde corre npm run dev)
# Buscar esta línea al llegar un mensaje:
# "[Gemini HU-7] ✅ Entrenamiento completado: X reglas extraídas."
```

**Para verificar manualmente sin WhatsApp:**
```bash
curl -X POST http://localhost:4000/api/settings/train \
  -H "Content-Type: application/json" \
  -d '{"texto": "[09:00] Vendedor: Los discos de freno para ese modelo son $45.000 el par. [09:01] Cliente: ok los llevo"}'
```

**Esperado:**
```json
{
  "success": true,
  "reglas": [...],
  "total": 1
}
```

- [ ] ✅ Endpoint retorna 201 con reglas extraídas
- [ ] ✅ En logs del backend se ve: `[HU-7] ✅ X reglas guardadas en DB y knowledge.json regenerado.`

---

### 4.2 — Verificar GET del knowledge
```bash
curl http://localhost:4000/api/settings/knowledge | python3 -m json.tool
```
**Esperado:**
```json
{
  "total": 3,
  "reglas": [
    { "id": 1, "regla": "...", "categoria": "precio", "fecha": "..." }
  ]
}
```

- [ ] ✅ Devuelve las reglas activas con sus IDs y categorías

---

### 4.3 — Verificar DELETE de una regla via API
```bash
# Tomar el ID de una regla del paso anterior (ej: id=1)
curl -X DELETE http://localhost:4000/api/settings/knowledge/1
```
**Esperado:**
```json
{ "success": true, "id": 1 }
```

- [ ] ✅ Regla desactivada vía API correctamente

---

## 📋 PRUEBA 5 — Lint del Dashboard (Code Quality)

```bash
cd dashboard
npm run lint
```
**Esperado:**
```
> eslint

(sin output adicional, sin errores ni warnings)
```

- [ ] ✅ `0 errors, 0 warnings`

---

## 🔄 RESUMEN DE RESULTADOS

| Prueba | Descripción | Estado |
|--------|-------------|--------|
| Pre-req P1 | Docker PostgreSQL corriendo | ⬜ |
| Pre-req P2 | Backend Node.js en 4000 | ⬜ |
| Pre-req P3 | Frontend Next.js en 3000 | ⬜ |
| 1.1 | Endpoint `/api/dashboard/metrics` responde | ⬜ |
| 1.2 | 6 KPI cards visibles en Dashboard | ⬜ |
| 1.3 | Auto-refresco cada 15s sin errores | ⬜ |
| 2.1 | Sección Entrenamiento IA visible en Settings | ⬜ |
| 2.2 | Entrenamiento con historial ficticio exitoso | ⬜ |
| 2.3 | Reglas guardadas en tabla `training_examples` | ⬜ |
| 2.4 | `knowledge.json` actualizado con reglas | ⬜ |
| 3.1 | Reglas persisten al recargar la página | ⬜ |
| 3.2 | Eliminación visual + soft-delete en DB | ⬜ |
| 3.3 | Eliminación persiste tras recarga | ⬜ |
| 4.1 | POST `/api/settings/train` vía curl | ⬜ |
| 4.2 | GET `/api/settings/knowledge` lista reglas | ⬜ |
| 4.3 | DELETE `/api/settings/knowledge/:id` funciona | ⬜ |
| 5 | Lint 0 errors 0 warnings | ⬜ |

---

## 🐛 REGISTRO DE BUGS ENCONTRADOS

> Completar durante las pruebas:

| # | Descripción del bug | Archivo/Endpoint | Estado |
|---|---------------------|-----------------|--------|
| — | — | — | — |

---

*Generado por @arquitecto.lead — Sprint 4 — 2026-03-23*
