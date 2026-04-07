# Task List - Sprint 4: Dashboard AI y Analítica

Este documento mantiene el estado de las tareas restantes correspondientes al Plan de Implementación de la fase actual, que integran **Módulo de Métricas (P0)** y **Entrenador de IA (P2 HU-7)**.

## 📊 1. Módulo de Métricas de Negocio
- [x] **Backend**: Diseñar consulta SQL analizando tablas `user_sessions` y `pedidos` (`getDashboardMetrics` en *sessions.service.js*).
- [x] **Backend**: Exponer Endpoint securizado (`GET /api/dashboard/metrics`).
- [x] **Frontend**: Escribir componente `DashboardMetrics.tsx` (Premium Design, Hover UI, Icons).
- [x] **Frontend**: Sustituir mocks estáticos y refactorizar `app/page.tsx` para inyectar este nuevo `<DashboardMetrics/>`.
- [x] **Code Quality**: Reparar cualquier error de sintaxis que revele `npm run lint` sobre estos últimos cambios y dejarlo con 0 errors. ✅ PROBADO
- [x] **Validación de Funcionalidad**: Endpoint responde 200 con 6 métricas, 6 KPI cards visibles, auto-refresco cada 15s sin errores. ✅ PROBADO

## 🧠 2. Entrenador IA - Knowledge Base (HU-7)
- [x] **Configuración File System**: Archivo `data/knowledge.json` creado, `.gitignore` actualizado. ✅ PROBADO
- [x] **Backend (Routes)**: Endpoints `POST /api/dashboard/settings/train`, `GET /api/dashboard/settings/knowledge`, `DELETE /api/dashboard/settings/knowledge/:id` funcionando. ✅ PROBADO
- [x] **Backend (AI Core)**: `trainAgentWithHistory()` en gemini.service.js extrae reglas con metaprompt, guarda en DB y regenera knowledge.json. ✅ PROBADO
- [x] **Backend (System Prompt)**: `getLearnedRules()` lee knowledge.json en cada llamada, inyecta reglas en system prompt. ✅ PROBADO
- [x] **Frontend (UI Settings)**: Textarea para historial, botón "Entrenar Agente", spinner loader "Gemini analizando chat...". ✅ PROBADO
- [x] **Frontend (Brain Review)**: Chips de reglas con categorías de color (precio=verde, tono=azul, etc.), botón X para eliminar. ✅ PROBADO
- [ ] **Test Real WhatsApp**: Pendiente verificar vía webhook real de WhatsApp (pero API probada 100%)
