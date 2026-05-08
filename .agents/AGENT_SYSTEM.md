# Sistema de Agentes — Agente-omnicanal-saas

> Equipo de agentes con definiciones para Claude Code Y Google Antigravity (Gemini).

---

## Roles + tier mapping

| Rol | Claude Code | Antigravity (Gemini) | Cuándo Felipe lo usa |
|---|---|---|---|
| **Secretary** | Haiku 4.5 | gemini-3-flash | "secretary: <pedido>" |
| **CTO/CEO** | Opus 4.7 | gemini-3-pro deep-thinking | "cto: <pedido>" o auto-escalado |
| **Subagentes** | Sonnet/Haiku/Opus | gemini-3-flash-preview/lite/pro | CTO los "contrata" on-demand |

---

## Token economy (mismo principio en ambas plataformas)

| Tier | Claude | Gemini | Uso (% ideal) |
|---|---|---|---|
| Cheap mecánico | Haiku 4.5 | gemini-3-flash-lite | docs, boilerplate, format |
| Default desarrollo | Sonnet 4.6 | gemini-3-flash-preview | 80% del trabajo técnico |
| Bugs complejos blocking | Opus 4.6 | gemini-3-pro standard | escalation Sonnet/flash falló |
| Planning crítico irreversible | Opus 4.7 | gemini-3-pro deep-thinking | ADR, arquitectura, security audit (máx 1-2 por sesión) |

---

## Flujo

```
Felipe ──> Secretary (cheap) ──> .agents/backlog/INBOX.md
              │
              └──> "✅ Anotado"

CTO/CEO (planning) lee INBOX ──> decide ──> contrata subagente cheap/default/escalation
              │
              └──> .agents/reports/secretary-log.md
              └──> .agents/reports/HUMAN_ACTIONS.md
```

---

## Cómo invocar (Claude Code)

Escribir en chat:
- `secretary: <pedido>` → invoca Haiku
- `cto: <pedido>` o `ceo: <pedido>` → invoca Opus 4.7
- Mensaje libre → CTO decide si escalar

## Cómo invocar (Antigravity)

Mismas convenciones — el dispatcher de Antigravity lee `.antigravity/agents/*.md` y matchea por `name` + `description`.

---

## Archivos clave

```
.claude/agents/secretary.md         ← Claude Haiku
.claude/agents/cto-ceo.md           ← Claude Opus 4.7
.antigravity/agents/secretary.md    ← Gemini flash
.antigravity/agents/cto-ceo.md      ← Gemini pro deep-thinking
.agents/backlog/INBOX.md            ← items pendientes
.agents/backlog/IN_PROGRESS.md      ← items ejecutándose
.agents/backlog/DONE.md             ← items completados
.agents/backlog/REGISTRO.md         ← memoria pasiva info-only
.agents/reports/secretary-log.md    ← feed cronológico (Felipe lee esto)
.agents/reports/HUMAN_ACTIONS.md    ← acciones humanas pendientes (Felipe lee esto)
```

---

## Cuándo crear nuevos subagentes especializados

Cuando un task se repite 3+ veces, el CTO crea `.claude/agents/<nombre>.md` Y `.antigravity/agents/<nombre>.md` con frontmatter (`name`, `description`, `model`) + system prompt enfocado.

Ejemplos sugeridos: `backend-dev`, `frontend-dev`, `qa-tester`, `database-dev`, `devops`, `bug-reporter`, `documenter`, `security-auditor`.

---

## Reglas inviolables

1. Secretary nunca ejecuta tareas técnicas — solo captura.
2. CTO nunca escribe código directamente — siempre delega.
3. Sin commits/push sin autorización Felipe.
4. Sin acceso a producción sin autorización Felipe.
5. Token economy es ley — usar el modelo más barato que cumpla.
