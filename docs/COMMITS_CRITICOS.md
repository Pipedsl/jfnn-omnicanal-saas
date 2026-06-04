# Commits críticos — Guía de rollback

Registro de los commits que tocan flujos sensibles del agente WhatsApp + dashboard.
Cada entrada incluye **qué hace**, **qué archivos toca**, y **cómo revertir** si rompe algo en producción.

Convención: si necesitas revertir, primero intentá `git revert <hash>`. Si el hash es un merge commit (los que empiezan por "Merge ..."), usar `git revert -m 1 <hash>` para mantener la rama base.

---

## 2026-06-04 — Fix: padron reconoce screenshots de consulta vehicular

**Commit**: (siguiente push)

**Bug**: cliente +56 9 8312 2389 envió screenshot de Autoseguros.cl / app de consulta vehicular con datos KIA Frontier 2019 (Tipo/Marca/Modelo/Año/Color/N° Motor/N° Chasis). La IA respondió "Recibí tu foto. ¿Me das marca, año y patente?" — no reconoció que ya tenía todos los datos.

**Causa**: el prompt de `analyzeImage` solo definía `padron` como Permiso de Circulación o Certificado de Anotaciones Vigentes (documentos físicos). Screenshots de apps/webs caían a `parte` u `otro`.

**Fix**: ampliar la definición de `padron` para incluir screenshots de Autoseguros.cl, Autohelper, Permisos.cl, app Registro Civil, etc. con estructura tabular reconocible (Marca/Modelo/Año/Patente/RUT propietario).

**Archivo**: `backend/services/gemini.service.js` (regla en `analyzeImage`).

**Riesgo**: bajo. El handler de padrón ya valida que la imagen tenga al menos `marca_modelo`, `patente` o `vin` antes de capturar datos (línea 395 del controller). Si Gemini falsea un positivo y la imagen no tiene esos campos, el flujo cae al fallback normal.

**Cómo revertir**: `git revert <hash>` después del push.

---

## 2026-06-04 — `46772cc` — Merge feature/cotizaciones-persistentes

**Commits internos** en la rama (no en main aún):

| Hash | Cambio | Archivos principales |
|------|--------|----------------------|
| `7303176` | Tabla `cotizaciones` (PK quote_id, validez 5d, estados) + service + endpoints `/cotizaciones-store/*` + upsert al enviar `/cotizaciones/responder` + cron expiración cada 1h. Migración aplicada en Supabase prod. | `backend/services/cotizaciones.service.js` (nuevo), `backend/routes/dashboard.routes.js`, `backend/index.js`, `backend/sql/migrations/20260604_cotizaciones.sql` |
| `6787eaf` | Fix audio batch: helper `persistirAudiosDelBatch` con reintento; ejecutado al inicio de los 2 handlers de imagen. Endpoint `/reprocesar-media` ahora soporta audio. Botón "🔄 Recuperar audio" en chat. | `backend/controllers/whatsapp.controller.js`, `backend/routes/dashboard.routes.js`, `dashboard/components/ConversacionesPanel.tsx` |
| `824a606` | Re-engage tras ≥60min sin respuesta o petición textual "nueva cotización" → guard pregunta "¿continuar o nueva?" → si nueva, pregunta "¿guardar anterior?" → archiva o cierra `cotizaciones`. Flags `re_engage_pending` + `guardar_anterior_pending`. Refuerzo prompt Gemini. | `backend/controllers/whatsapp.controller.js`, `backend/services/gemini.service.js` |
| `604c28a` | Vista `/cotizaciones` para vendedores/admin: tabla con filtros, buscador, modal detalle, acciones manuales (archivar/cerrar/reactivar). | `dashboard/app/cotizaciones/page.tsx` (nuevo) |

**Riesgo combinado**: medio. Cambios coordinados pero cada commit es revertible:
- Si el guard de re-engage molesta → `git revert 824a606`.
- Si la UI causa errores → `git revert 604c28a`.
- Si el fix de audio rompe algo → `git revert 6787eaf` (vuelve al bug original, peor caso).
- Si la tabla cotizaciones tiene problemas → `git revert 7303176` (no se rompe nada, solo deja de persistir).

**Cómo revertir el merge completo** (cuando se mergee):
```bash
# Suponiendo que el merge a main tendrá hash MERGE_HASH:
git revert -m 1 MERGE_HASH && git push origin main
```

---

## 2026-06-03 — `80f04f0` — Optimización de costos Gemini

**Merge commit**: `80f04f0`
**Rama origen**: `feature/gemini-cost-optimization`
**Commits internos** (revertibles individualmente):

| Hash | Cambio | Archivo principal |
|------|--------|-------------------|
| `eaba518` | Restringe Pro 3.1 a casos con audio o síntomas técnicos. Antes CONFIRMANDO_COMPRA y length>100 forzaban Pro siempre. | `backend/services/gemini.service.js` |
| `5cb951f` | Cap `maxOutputTokens` (2048 generateResponse, 1024 clasificadores). | `backend/services/gemini.service.js` |
| `6cd7ccc` | Historial inyectado al prompt 15 → 10 mensajes. | `backend/controllers/whatsapp.controller.js` |
| `f391593` | Cache de `analyzeImage` por SHA-1 del buffer (TTL 24h, max 200 entries). | `backend/services/gemini.service.js` |
| `d6c9e03` | Documentación del nuevo criterio en CLAUDE.md. | `CLAUDE.md` |
| `eed346e` | Fix: excluye "aceite" suelto de regex de síntomas + test routing. | `backend/services/gemini.service.js`, `backend/scripts/test_gemini_routing.js` |
| `e95f5b3` | Tests de routing con 120 mensajes reales de la BD. | `backend/scripts/test_gemini_routing_real.js`, `backend/scripts/test_gemini_routing_confirmando.js` |

**Riesgo si rompe**: la mayoría de mensajes irán a Flash. En el peor caso (Flash no entiende un edge case que Pro sí entendía), la respuesta puede ser menos elegante pero no rompe el flujo (estado igual avanza, cotización igual se procesa).

**Cómo verificar post-deploy**:
- Logs Railway: buscar `[Gemini] 🤖 Modelo elegido: gemini-3-flash-preview` (debería ser la mayoría).
- Google Cloud Billing 24h después: forecast 30d de "Generate_content text output token count for gemini 3 pro short" debería bajar.

**Cómo revertir**:
```bash
# Opción A: revertir el merge completo (vuelve a costos pre-optim)
git revert -m 1 80f04f0 && git push origin main

# Opción B: revertir solo el routing (más quirúrgico — mantiene tokens cap, cache, etc.)
git revert eaba518 && git push origin main

# Opción C: revertir solo el cache si causa problemas de memoria
git revert f391593 && git push origin main
```

---

## 2026-06-03 — `c3b26d5` — 4 fixes coordinados sobre flujo de pago

**Commit único**: `c3b26d5`

**Cambios**:
1. **Renombrar contactos**: `PATCH /contactos/:phone/nombre` + UI inline ✏️ en header chat + input nombre en modal "Nueva conversación".
2. **Clasificador `datos_bancarios`**: Gemini Vision distingue comprobante real de cartel/foto con datos de cuenta. En estado de pago, imagen no-comprobante pausa IA + marca `alerta_consulta_pago`.
3. **Lock cotización en estados post-cotización**: si se extrae repuesto nuevo desde OCR/captions reenviados, se revierte automáticamente.
4. **Anti-hostigamiento ack post-solicitud**: cliente responde "Ok" tras pedido de comprobante → IA queda en silencio.

**Bonus**: `setAgentePausado` limpia alertas al reanudar IA (cierre del ciclo).

**Archivos**: `whatsapp.controller.js`, `gemini.service.js`, `dashboard.routes.js`, `sessions.service.js`, `ConversacionesPanel.tsx`, `BandejaTable.tsx`.

**Cómo revertir**:
```bash
git revert c3b26d5 && git push origin main
```

---

## 2026-06-02 — `d2b6244` — Footer compacto en QuoteCard

**Commit**: `d2b6244`

**Cambios**: Nota / Logística / Abono mínimo colapsables. Botones HSM + Archivar en una fila compacta. +50% espacio para items en laptop 1366×768.

**Archivos**: `SellerActionForm.tsx`, `QuoteCard.tsx`, `.gitignore`.

**Cómo revertir** (solo si el vendedor reporta que extraña los inputs siempre visibles):
```bash
git revert d2b6244 && git push origin main
```

---

## 2026-06-02 — `9e58d55` — Abono mínimo manual para POR_ENCARGO

**Commit**: `9e58d55`

**Cambios**: Input "🟡 Abono mínimo" en SellerActionForm (solo si hay items POR_ENCARGO). Backend persiste en `entidades.abono_minimo`. Gemini lo usa textualmente en vez del 50% calculado.

**Compatibilidad**: hacia atrás — cotizaciones sin `abono_minimo` siguen con cálculo 50%.

**Cómo revertir**:
```bash
git revert 9e58d55 && git push origin main
```

---

## 2026-06-01 — `24365e3` — Atribución cotizador + modal Layla + guard agradecimientos

**Commit**: `24365e3`

**Cambios**:
- `archiveSession`: atribución va a `e.vendedor_nombre` (cotizador) en vez de `lock_vendedor`.
- Modal "Cierre de venta" con recordatorio "Asignar centro de costos Web en Layla" + nombre cotizador.
- Guard ARCHIVADO: agradecimientos cortos no abren nueva sesión.
- Refuerzo prompt agradecimientos post-cierre.

**Archivos**: `sessions.service.js`, `dashboard.routes.js`, `whatsapp.controller.js`, `gemini.service.js`, `QuoteCard.tsx`, `CierreVentaModal.tsx` (nuevo).

**Cómo revertir**:
```bash
git revert 24365e3 && git push origin main
```

---

## Cómo agregar nuevas entradas

Cuando se mergee un cambio sensible a main:
1. Anotar el hash del merge commit (o del commit único si fue directo).
2. Listar archivos críticos tocados.
3. Describir qué hace y qué pasa si falla.
4. Comando de revert listo para copiar.
5. Ordenar de más reciente a más viejo.

Mantener este archivo bajo 500 líneas — si crece más, archivar entradas viejas en `docs/COMMITS_CRITICOS_HISTORICO.md`.
