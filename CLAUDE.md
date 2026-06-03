# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

JFNN Omnicanal SaaS — WhatsApp-powered auto parts sales assistant with admin dashboard. Customers chat via WhatsApp, an AI agent (Google Gemini) profiles their vehicle and parts needs, then a human seller quotes prices via the dashboard. The system handles payment verification, logistics, and Google review requests.

## Development Commands

```bash
# Start everything (from root)
npm run dev                    # Backend (port 4000) + Dashboard (port 3000)

# Backend only
cd backend && npm run dev      # nodemon index.js
cd backend && npm test         # jest --verbose

# Dashboard only
cd dashboard && npm run dev    # next dev
cd dashboard && npm run lint   # eslint (must pass with 0 errors)

# Database (PostgreSQL 16 in Docker)
docker-compose up -d           # Start PostgreSQL (port 5433, user: jfnn_user, db: jfnn_db)
docker exec jfnn_postgres psql -U jfnn_user -d jfnn_db -c "SELECT ..."  # Run queries
```

## Architecture

**Monorepo** with two workspaces:
- `backend/` — Node.js/Express (port 4000), handles WhatsApp webhook, Gemini AI, PostgreSQL sessions
- `dashboard/` — Next.js 16 + React 19 (port 3000), seller/admin UI with Tailwind CSS

**Data flow**: WhatsApp message → webhook (20s debounce buffer) → Gemini AI → structured entities stored in PostgreSQL JSONB → dashboard displays for seller action → WhatsApp response to customer

### Key Service Files

| File | Responsibility |
|------|---------------|
| `backend/controllers/whatsapp.controller.js` | Webhook handler, debounce buffer, image/receipt processing |
| `backend/services/gemini.service.js` | AI prompt construction, dual-model routing (Flash vs Pro) |
| `backend/services/sessions.service.js` | State machine, entity merging, session CRUD, metrics, helpers (`derivarSucursal`, `tieneRepuestosPorEncargo`, claim/release lock) |
| `backend/services/whatsapp.service.js` | Meta WhatsApp API wrapper |
| `backend/services/vendedores.service.js` | CRUD vendedores por sucursal (consumido por `/settings`) |
| `backend/utils/sucursales.js` | Catálogo Melipilla/San Felipe + `getDireccionSucursal()` + `esPagoPresencial()` — reusado en mensajes WhatsApp |
| `backend/routes/dashboard.routes.js` | All `/api/dashboard/*` endpoints |
| `dashboard/lib/encargo.ts` | TS port de `tieneRepuestosPorEncargo` para QuoteCard/Bandeja |
| `dashboard/hooks/useQuoteLock.ts` | Hook de lock pesimista (claim/release/renew) usado en QuoteCard |
| `dashboard/components/IdentitySelector.tsx` | Modal "¿Quién está cotizando hoy?" — selector de vendedor activo por turno |

### State Machine

Defined in `sessions.service.js` lines 7-21. Flow principal:

```
PERFILANDO → ESPERANDO_VENDEDOR → CONFIRMANDO_COMPRA → ESPERANDO_COMPROBANTE
→ ESPERANDO_APROBACION_ADMIN → PAGO_VERIFICADO → ESPERANDO_RETIRO → ENTREGADO → ARCHIVADO
```

**Sub-flujo POR_ENCARGO (REQ-06)** — activado cuando algún repuesto tiene `disponibilidad: 'POR_ENCARGO'`:

```
ESPERANDO_COMPROBANTE → (admin verifica como abono) → ABONO_VERIFICADO
→ (vendedor pulsa "Solicitar a proveedor") → ENCARGO_SOLICITADO
→ (vendedor pulsa "Repuestos Llegaron") → ESPERANDO_SALDO o PAGO_VERIFICADO (si saldo=0)
→ (cliente paga saldo: transferencia → admin verifica) o (presencial → vendedor pulsa "Saldo Pagado en Local") → ENTREGADO
```

El flag `disponibilidad: 'POR_ENCARGO'` se setea en el QuoteCard al cotizar (selector "🟡 Abono"). El helper `tieneRepuestosPorEncargo(entidades)` detecta si la sesión tiene al menos un repuesto en encargo (usado por Gemini, banner UI, filtro bandeja "📦 Por Llegar").

Branch states: `CICLO_COMPLETO`

### Database

PostgreSQL 16 via Docker (local) + Supabase prod (project ID `uzsrvigcuehtzhwzuaer`). Schema in `backend/sql/init.sql`. Core tables:
- `user_sessions` — Active conversations (phone as tenant key, JSONB `entidades` for all customer data). Columnas multi-sucursal: `sucursal`, `lock_token`, `lock_vendedor`, `lock_expires_at`, `vendedor_nombre`.
- `pedidos` — Archived completed sales. Columnas multi-sucursal: `sucursal`, `vendedor_nombre`.
- `vendedores` — Equipo por sucursal (`nombre`, `sucursal`, `activo`). Editable desde `/settings` por admin.
- `clientes` — Recurring customer profiles
- `training_examples` — HU-7 learned AI rules (soft-delete with `activo` boolean)

**Migraciones a producción**: usar MCP Supabase `apply_migration` (NO `psql` directo — el rol `jfnn_app` no tiene permisos DDL sobre tablas existentes).

### Knowledge Base (HU-7)

Two-tier system:
- `knowledge-base.md` (root) — **Permanent** business rules, never auto-modified
- `backend/data/knowledge.json` — **Dynamic** learned rules from training, gitignored, regenerated from DB

Both are injected into Gemini's system prompt on every call.

## Critical Rules

- **Never modify Gemini model versions** (`gemini-3.1-pro-preview`, `gemini-3-flash-preview`) without explicit approval
- **Pro vs Flash — criterio actual de costos (junio 2026)**: Pro 3.1 solo cuando hay audio (transcripción robusta) o el texto contiene síntomas técnicos reales (regex: `calienta|recalienta|ruido|fall(a|o)|vibra|golpe|no enciende|no parte|no prende|humo|aceite|chirrido|temblor|p[eé]rdida|fuga`). Todo el resto va a Flash 3. Cambiar este criterio puede triplicar el costo (Pro es ~5x Flash en output tokens). Ver `backend/services/gemini.service.js` línea ~146.
- **Cap de output tokens**: `generateResponse` usa `maxOutputTokens: 2048`; clasificadores (`analyzeImage`, `extractVoucherData`, `classifyIntent`, `identifyPartFromImage`, `formularPreguntaAlCliente`) usan `1024`. Sin cap el modelo puede divagar y consumir tokens innecesarios.
- **Cache `analyzeImage` por hash de buffer** (`ANALYZE_IMAGE_CACHE`, TTL 24h, max 200 entries). Evita re-procesar imágenes reenviadas por el cliente.
- **Historial al prompt**: 10 mensajes en `listarPorPhone(phone, { limit: 10 })`. 3-5 turnos de conversación, suficiente contexto sin engordar input tokens.
- **Gemini returns a single string** `mensaje_cliente` — NOT an array. Responses are split into multiple WhatsApp messages by the controller based on newlines/length.
- **The AI agent never gives prices to customers** — prices are set exclusively by the seller via dashboard
- **Direcciones de sucursal NO van en el prompt** — Gemini debe abstenerse de incluirlas. La inyección al cliente se hace en backend usando `getDireccionSucursal()` post-respuesta (BUG-POST04 fix). Esto evita alucinaciones y mensajes inconsistentes.
- **Saludo único por sesión**: el flag `entidades.saludo_dado` (sticky truthy) controla que el agente salude SOLO en el primer turno. Una vez `true`, no se sobreescribe a `false` en el merge.
- **Quantity merging uses `cantidad_fijada` flag**: when `true`, Gemini can only change quantity if it returns a non-null value explicitly (client-requested change). `Math.max` is only used when `cantidad_fijada` is `false`.
- **Price merging**: `viejo.precio != null ? viejo.precio : nuevo.precio` — seller's price is NEVER overwritten once set
- **Multi-vehicle**: Gemini uses `vehiculos[]` array when client mentions 2+ vehicles. Never concatenate with "/". Each vehicle has its own `repuestos_solicitados[]`.
- **Repuesto deduplication**: `isSameRepuesto()` strips parenthetical vehicle annotations before comparing names, uses token overlap ≥75% for fuzzy match (con stopwords filtradas: `de, la, el, los, las, y, con, para, sin, a`). Avoids duplicates when Gemini refines part names across calls.
- **Webhook must respond fast** (<30s) — heavy processing (image downloads, Gemini calls) runs asynchronously
- **24h Meta message window** — code handles error 130472 gracefully
- **All state transitions** go through `sessionsService.setEstado()` to ensure cache invalidation
- **Re-engage clean**: cuando un cliente con sesión ENTREGADO/ARCHIVADO escribe nuevamente, `archiveSession` invalida cache + `whatsapp.controller.js` valida defensivamente que la sesión nueva no traiga repuestos viejos. Sin esta protección hay riesgo de mergear datos de sesiones antiguas (BUG-POST03).
- **POR_ENCARGO fuerza transferencia**: si la cotización tiene ≥1 repuesto `disponibilidad: 'POR_ENCARGO'`, el prompt CONFIRMANDO_COMPRA bloquea pago en local y exige abono por transferencia. Para escape manual existen botones "💵 Saldo Pagado en Local" (BUG-POST07) y futuro "💵 Abono Pagado en Local" (BUG-POST10 pendiente).

## Patterns

- **Logging**: Prefixed with `[ServiceName]` and status emoji for console output
- **DB queries**: Always parameterized (`$1`, `$2`, etc.)
- **Session caching**: 5s TTL per session, 2.5s for global pending list — invalidated on writes
- **Dashboard polling**: 3s en vista pendientes (necesario para que el lock pesimista se vea casi-instantáneo), manual refresh en historial
- **Frontend API calls**: axios con cache-busting `?t=${Date.now()}`
- **Status badges**: `bg-[color]/10 text-[color] border-[color]/20` pattern in Tailwind
- **Agent rules**: Role-specific prompts in `.agent/rules/` (arquitecto.lead.md, backend-node.md, etc.)

## Auth, roles y multi-sucursal

- **3 cuentas en `.env`** (Vercel prod): `AUTH_VENDEDOR_MELIPILLA_PIN`, `AUTH_VENDEDOR_SAN_FELIPE_PIN`, `AUTH_ADMIN_PIN`. JWT carga `{role, sucursal}`.
- **localStorage del cliente**: `jfnn_role` (`'vendedor' | 'admin'`), `jfnn_sucursal` (`'Melipilla' | 'San Felipe' | ''`), `jfnn_token`, `jfnn_vendedor_nombre` (identidad declarada al login del vendedor).
- **Identidad por turno**: vendedores comparten cuenta por sucursal. Al login se abre `IdentitySelector` que carga vendedores activos de la sucursal y guarda el nombre elegido en localStorage. Esto sirve para REQ-03 (atribución de comisiones) y para el lock.
- **Bandeja filtrada**: backend fuerza `?sucursal=X` según `x-user-sucursal` del JWT (vendedor solo ve su sucursal). Admin ve selector "Todas / Melipilla / San Felipe".
- **Lock pesimista en QuoteCard**: hook `useQuoteLock(phone, vendedor)` hace claim al abrir el card, renew cada 4 min, release en cleanup/`beforeunload`. Si otro vendedor tiene el lock, overlay "🔒 Cotizando como X" + inputs deshabilitados. Validación en PATCH `/cotizaciones/estado` rechaza si `lock_token` no coincide (409 `locked_by_other`).

## Sub-flujo POR_ENCARGO (REQ-06)

Cuando el vendedor cotiza marcando un repuesto con `disponibilidad: 'POR_ENCARGO'` (selector "🟡 Abono"):

1. Cliente confirma → agente Gemini bloquea "pago en local" y exige abono por transferencia (regla en prompt CONFIRMANDO_COMPRA, condicional `entidadesTienenEncargo`)
2. Cliente envía comprobante → admin verifica con `accion: 'approved_abono'` (en `verify-payment`) → estado `ABONO_VERIFICADO`
3. Filtro bandeja "📦 Por Llegar" agrupa `ABONO_VERIFICADO + ENCARGO_SOLICITADO + ESPERANDO_SALDO`
4. Vendedor pulsa "Marcar Encargo Listo y Notificar" → `POST /encargos/solicitar` con días ETA → `ENCARGO_SOLICITADO`
5. Vendedor pulsa "Repuestos Llegaron" → `POST /encargos/recibido` → si saldo>0 `ESPERANDO_SALDO`, sino `PAGO_VERIFICADO`. Mensaje incluye dirección sucursal.
6. Saldo: cliente puede pagar por transferencia (admin verifica) o presencial (vendedor pulsa **"💵 Saldo Pagado en Local"** → `POST /cotizaciones/:phone/saldo-pagado-local` → directo a `ENTREGADO` + reseña Google).

## API Route Mounting

Routes are mounted in `backend/index.js`:
- `/api/whatsapp` → `whatsapp.routes.js`
- `/api/dashboard` → `dashboard.routes.js`

So `router.get('/cotizaciones')` in dashboard.routes.js is accessed at `/api/dashboard/cotizaciones`.

## WhatsApp Cloud API — Estado operacional

**Estado:** ✅ **Canal WhatsApp ACTIVO desde el 18 mayo 2026** vía Cloud API en modo Live, **tier Limited Access (sin Business Verification)**. Validado end-to-end.

**Documento completo:** `docs/PLAN_OPCION_A_EJECUCION.md` (datos de integración + notas de ejecución). Plan estratégico padre: `docs/PLAN_B_META_RECHAZO.md`.

**Datos de la integración (chip de prueba):**
- App Meta: `RepuestosOmnicanal` — App ID `2553364111727691`
- WABA: `repuestos jfnn` — ID `1003088295416438` (⚠️ hay 4 WABAs en el BM; esta es la correcta, minúsculas)
- Phone ID: `1066882779849103` — número de prueba `+56 9 5082 8842`
- System User: `jfnnbackendapi` — token permanente (sin expiración) en Railway `WHATSAPP_ACCESS_TOKEN`
- Webhook: `https://jfnn-backend-production.up.railway.app/api/whatsapp/webhook`
- Env vars que consume el backend: `WHATSAPP_PHONE_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_VERIFY_TOKEN`, `META_APP_SECRET` (opcional en dev)

**Sobre la verificación de negocio Meta:** sigue en revisión (enviada 11 mayo 2026, ver `docs/META_VERIFICACION_GUIA_DEFINITIVA.md`), pero **ya NO es bloqueante**. El modo Limited Access es permanente y legítimo; el flujo customer-initiated de JFNN no toca el límite de 250 conv./24h. Sin riesgo de ban.

**Pendiente futuro (NO urgente):**
1. Cuando Meta apruebe la verificación → migrar el **número productivo** de JFNN (mismo flujo OTP, backup de chats antes, cambiar `WHATSAPP_PHONE_ID` en Railway).
2. Auditar y limpiar las 4 WABAs duplicadas del Business Manager.
3. Configurar `META_APP_SECRET` en Railway (validación de firma X-Hub-Signature-256 — hoy en modo dev permisivo).
