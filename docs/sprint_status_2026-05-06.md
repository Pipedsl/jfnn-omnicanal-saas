# Estado del proyecto — Cierre 2026-05-06

> **Para retomar mañana**: leer este archivo + `/Users/felipenavarretenavarrete/.claude/plans/noble-painting-spindle.md` (plan vigente) + `docs/bugs_e2e_2026-05-04.md` (todos los bugs/REQs documentados).

---

## Sprints completados hoy

### Sprint A — 4 bugs post-multisucursal (commit `e7f2229`)
- ✅ A.1 BUG-POST04 — postprocesado dirección sucursal en mensaje cierre presencial
- ✅ A.2 BUG-POST03 — re-engage no trae repuestos viejos (cache + validación defensiva)
- ✅ A.3 BUG-POST05 — saludo único (flag `saludo_dado` en INITIAL_ENTITIES)
- ✅ A.4 BUG-POST02 — VIN responsive en QuoteCard (grid + tooltip + copiar)

### Sprint B — REQ-06 Workflow encargo/abono (commits `ca29e62` + `8544904` + `bd4095b`)
- ✅ B.1 Helper `tieneRepuestosPorEncargo` (backend `sessions.service.js` + frontend `dashboard/lib/encargo.ts` + 4 tests)
- ✅ B.2 Prompt Gemini fuerza transferencia con POR_ENCARGO
- ✅ B.3 Dirección sucursal en `/encargos/recibido`
- ✅ B.4 Filtro "📦 Por Llegar" agrupando ABONO_VERIFICADO + ENCARGO_SOLICITADO + ESPERANDO_SALDO
- ✅ B.5 Banner "📦 Sub-flujo: Por Encargo" en QuoteCard
- ✅ Fix BUG-POST06 — texto cotización POR_ENCARGO con nota explicativa al pie
- ✅ Fix BUG-POST07 — botón "💵 Saldo Pagado en Local" (cierra a ENTREGADO + reseña Google)

### Migraciones DB aplicadas en Supabase prod (vía MCP `apply_migration`)
- `multisucursal_mvp_columns` (Sprint A — Oleada 0): columnas sucursal, lock_token, lock_vendedor, lock_expires_at en user_sessions; sucursal + vendedor_nombre en pedidos; tabla vendedores
- `add_vendedor_nombre_to_user_sessions` (hoy, durante E2E REQ-06): agregada columna `vendedor_nombre` también a `user_sessions` (faltaba — el endpoint `/saldo-pagado-local` la usaba)

---

## Validaciones E2E hechas hoy

### Sprint A (mañana 2026-05-06)
- ✅ Saludo único validado (Carlos recurrente)
- ✅ Re-engage limpio validado (sesiones nuevas sin repuestos viejos)
- ✅ Dirección sucursal en cierre presencial validado
- ✅ VIN responsive validado en QuoteCard

### REQ-06 (tarde 2026-05-06) — DOS demos
**Demo 1**: cliente paga abono por transferencia → admin aprueba como ABONO ($45.000=total) → encargo solicitado → marcar recibido → directo a PAGO_VERIFICADO (saldo=0) → confirmar logística → ENTREGADO + reseña Google.

**Demo 2 (con saldo pendiente)**: cliente paga abono parcial $25.000 de $80.000 → ABONO_VERIFICADO → encargo solicitado → marcar recibido → ESPERANDO_SALDO con saldo $55.000 + dirección Melipilla → **botón "💵 Saldo Pagado en Local"** → directo a ENTREGADO + reseña.

---

## Bugs nuevos detectados durante los E2E (PARTE 4 del doc bugs)

| Bug | Severidad | Estado | Fix planeado |
|---|---|---|---|
| **BUG-POST06** | Media | ✅ FIXED hoy | Texto "(Requiere abono previo)" reemplazado por nota al pie |
| **BUG-POST07** | Alta | ✅ FIXED hoy | Botón "Saldo Pagado en Local" + endpoint nuevo |
| **BUG-POST08** | Media | ⏳ PENDIENTE | Cotización firma "Asesor JFNN" en vez del nombre real (Sergio, Feña, Kano) |
| **BUG-POST09** | Baja-Media | ⏳ PENDIENTE | Datos bancarios con abreviaturas confusas ("Cta. Cte.") |
| **BUG-POST10** | Alta | ⏳ PENDIENTE | Cliente paga **abono** en local — vendedor sin botón para desestancar (gemelo de BUG-POST07) |
| **BUG-POST11** | Media-Alta | ⏳ PENDIENTE | Modal "Verificar Comprobante" no responsive — botón RECHAZAR se corta |
| **BUG-POST12** | Baja | ⏳ PENDIENTE | Agente pregunta "¿te envío datos bancarios?" en vez de enviarlos directamente |

---

## Estado actual de la sesión de Carlos (+56974792499)

Sesión en mitad del demo 2 (no completado):
- Estado: `ESPERANDO_COMPROBANTE`
- Quote ID: `JFNN-2026-4BD8D8`
- Sucursal: Melipilla
- Producto: bomba de agua $60.000 (POR_ENCARGO)
- El agente pidió datos bancarios con la pregunta "¿te envío los datos?" (BUG-POST12 detectado)

**Para mañana**: o se descarta esta sesión y se arranca demo limpio, o se continúa enviando comprobante simulado.

---

## Plan para mañana (orden recomendado)

### Mini-sprint C — Fixes pendientes E2E REQ-06 (~3-4 horas)
Ejecutables con Sonnet/Haiku. Todos juntos en un commit.

| Ticket | Bug | Esfuerzo | Modelo |
|---|---|---|---|
| C.1 | BUG-POST08 — firmar cotización con nombre vendedor real | 30 min | Haiku |
| C.2 | BUG-POST09 — formato vertical claro de datos bancarios | 15 min | Haiku |
| C.3 | BUG-POST10 — botón "💵 Abono Pagado en Local" (gemelo de POST07) | 2 hrs | Sonnet |
| C.4 | BUG-POST11 — modal Verificar Comprobante responsive | 30 min | Haiku |
| C.5 | BUG-POST12 — quitar pregunta innecesaria en prompt | 5 min | Haiku |

### Sprint D — REQ-07 Optimización tokens IA (después de fixes)
Ya planificado y priorizado en el doc bugs (PARTE 4 — REQ-07). Quick wins primero:
- REQ-07.G — Instrumentar métricas tokens (necesario antes)
- REQ-07.E — Auditar routing Flash/Pro (puede recortar 50-60% del costo)
- REQ-07.C — Prompt slimming
- Luego REQ-07.A — Context caching de Gemini

---

## REQs pendientes (priorización del plan)

1. **REQ-07** Optimización tokens IA (próximo sprint después de fixes C)
2. **REQ-08** Cliente memory + auto-derivación sucursal (UX/fidelización)
3. **REQ-01** Métricas mes/año en `/admin/estadisticas`
4. **REQ-03** Reporte de comisiones por vendedor (ya guardamos `vendedor_nombre`, falta el reporte)
5. **REQ-04** Conversaciones tiempo real (el más caro, solo si demanda)

---

## Comandos útiles para retomar mañana

```bash
# Cwd del proyecto
cd /Users/felipenavarretenavarrete/Desktop/RepuestosJFNN/jfnn-omnicanal-saas

# Ver últimos commits
git log --oneline -10

# Sesión Carlos en producción
# (desde Claude con MCP supabase)
SELECT phone, estado, sucursal, entidades->>'quote_id' FROM user_sessions WHERE phone = '56974792499';

# Limpiar sesión Carlos (para arrancar nuevo demo)
DELETE FROM user_sessions WHERE phone = '56974792499';

# Logs Railway (vía MCP) — buscar errores recientes
filter: "@level:error" o "Error en"

# Stack
- Backend: Railway (auto-deploy desde main)
- Dashboard: Vercel (auto-deploy desde main)
- DB: Supabase project uzsrvigcuehtzhwzuaer
- WhatsApp: Meta Business API (vía /api/whatsapp webhook)
```

## PINs en producción (Vercel env)

- `AUTH_VENDEDOR_MELIPILLA_PIN` = `7421`
- `AUTH_VENDEDOR_SAN_FELIPE_PIN` = `3865`
- `AUTH_ADMIN_PIN` = `repuestos*2026`

## Vendedores creados en producción (tabla `vendedores`)

- Melipilla: Sergio, Feña, Blake (uno desactivado quizás)
- San Felipe: Kano

## Plan vigente

`/Users/felipenavarretenavarrete/.claude/plans/noble-painting-spindle.md`
Última versión: REQ-06 Sprint B (ejecutado y validado).

---

**Estado al cierre 2026-05-06**: 2 sprints completados + 7 bugs nuevos documentados. 5 fixes pendientes para mini-sprint C mañana. Producción estable, multi-sucursal + workflow encargo operativos.
