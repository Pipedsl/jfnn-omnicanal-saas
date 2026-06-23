-- 2026-06-23 — Workstream A: estados ACEPTADA y RECHAZADA para cotizaciones paralelas.
-- Permite que un cliente tenga varias cotizaciones simultáneas con estados claros:
--   ACTIVA    → pendiente (enviada, esperando respuesta del cliente)
--   ACEPTADA  → el cliente confirmó; pendiente de retiro/pago (lo que ve el vendedor en caja)
--   RECHAZADA → el cliente la descartó explícitamente
--   CERRADA   → venta finalizada/comprada (terminal)
--   ARCHIVADA / EXPIRADA → sin cambios
-- Aplicar a producción vía MCP Supabase apply_migration (NO psql — rol sin DDL).

ALTER TABLE cotizaciones DROP CONSTRAINT IF EXISTS estado_cotizacion_valido;

ALTER TABLE cotizaciones ADD CONSTRAINT estado_cotizacion_valido
    CHECK (estado_cotizacion IN ('ACTIVA','ARCHIVADA','EXPIRADA','CERRADA','ACEPTADA','RECHAZADA'));
