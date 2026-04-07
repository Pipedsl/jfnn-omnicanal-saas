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
| `backend/services/sessions.service.js` | State machine, entity merging, session CRUD, metrics |
| `backend/services/whatsapp.service.js` | Meta WhatsApp API wrapper |
| `backend/routes/dashboard.routes.js` | All `/api/dashboard/*` endpoints |

### State Machine

Defined in `sessions.service.js` lines 7-21. Flow:

```
PERFILANDO → ESPERANDO_VENDEDOR → CONFIRMANDO_COMPRA → ESPERANDO_COMPROBANTE
→ ESPERANDO_APROBACION_ADMIN → PAGO_VERIFICADO → ESPERANDO_RETIRO → ENTREGADO → ARCHIVADO
```

Branch states: `ABONO_VERIFICADO`, `ENCARGO_SOLICITADO`, `ESPERANDO_SALDO`, `CICLO_COMPLETO`

### Database

PostgreSQL 16 via Docker. Schema in `backend/sql/init.sql`. Core tables:
- `user_sessions` — Active conversations (phone as tenant key, JSONB `entidades` for all customer data)
- `pedidos` — Archived completed sales
- `clientes` — Recurring customer profiles
- `training_examples` — HU-7 learned AI rules (soft-delete with `activo` boolean)

### Knowledge Base (HU-7)

Two-tier system:
- `knowledge-base.md` (root) — **Permanent** business rules, never auto-modified
- `backend/data/knowledge.json` — **Dynamic** learned rules from training, gitignored, regenerated from DB

Both are injected into Gemini's system prompt on every call.

## Critical Rules

- **Never modify Gemini model versions** (`gemini-3.1-pro-preview`, `gemini-3-flash-preview`) without explicit approval
- **Gemini returns a single string** `mensaje_cliente` — NOT an array. Responses are split into multiple WhatsApp messages by the controller based on newlines/length.
- **The AI agent never gives prices to customers** — prices are set exclusively by the seller via dashboard
- **Quantity merging uses `cantidad_fijada` flag**: when `true`, Gemini can only change quantity if it returns a non-null value explicitly (client-requested change). `Math.max` is only used when `cantidad_fijada` is `false`.
- **Price merging**: `viejo.precio != null ? viejo.precio : nuevo.precio` — seller's price is NEVER overwritten once set
- **Multi-vehicle**: Gemini uses `vehiculos[]` array when client mentions 2+ vehicles. Never concatenate with "/". Each vehicle has its own `repuestos_solicitados[]`.
- **Repuesto deduplication**: `isSameRepuesto()` strips parenthetical vehicle annotations before comparing names, uses token overlap ≥60% for fuzzy match. Avoids duplicates when Gemini refines part names across calls.
- **Webhook must respond fast** (<30s) — heavy processing (image downloads, Gemini calls) runs asynchronously
- **24h Meta message window** — code handles error 130472 gracefully
- **All state transitions** go through `sessionsService.setEstado()` to ensure cache invalidation

## Patterns

- **Logging**: Prefixed with `[ServiceName]` and status emoji for console output
- **DB queries**: Always parameterized (`$1`, `$2`, etc.)
- **Session caching**: 5s TTL per session, 2.5s for global pending list — invalidated on writes
- **Dashboard polling**: 10s interval on pendientes view, manual refresh for historial
- **Frontend API calls**: axios with cache-busting `?t=${Date.now()}`
- **Status badges**: `bg-[color]/10 text-[color] border-[color]/20` pattern in Tailwind
- **Agent rules**: Role-specific prompts in `.agent/rules/` (arquitecto.lead.md, backend-node.md, etc.)

## API Route Mounting

Routes are mounted in `backend/index.js`:
- `/api/whatsapp` → `whatsapp.routes.js`
- `/api/dashboard` → `dashboard.routes.js`

So `router.get('/cotizaciones')` in dashboard.routes.js is accessed at `/api/dashboard/cotizaciones`.
