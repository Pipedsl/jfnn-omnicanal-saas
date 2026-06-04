-- 2026-06-04 — Tabla de cotizaciones persistentes (REQ: cotizaciones independientes del chat)
-- Permite al agente recordar cotizaciones sin parsear historial. Validez 5 días.
-- Aplicada vía MCP Supabase en producción el 2026-06-04.

CREATE TABLE IF NOT EXISTS cotizaciones (
    quote_id            VARCHAR(30) PRIMARY KEY,
    phone               VARCHAR(20) NOT NULL,
    nombre_cliente      VARCHAR(100),
    sucursal            VARCHAR(50),
    vendedor_nombre     VARCHAR(100),
    repuestos           JSONB NOT NULL DEFAULT '[]'::jsonb,
    vehiculos           JSONB DEFAULT '[]'::jsonb,
    total_aproximado    INTEGER DEFAULT 0,
    metodo_pago         VARCHAR(20),
    metodo_entrega      VARCHAR(20),
    direccion_envio     TEXT,
    tipo_documento      VARCHAR(20),
    datos_factura       JSONB,
    tiene_encargo       BOOLEAN DEFAULT FALSE,
    abono_minimo        INTEGER,
    estado_cotizacion   VARCHAR(30) NOT NULL DEFAULT 'ACTIVA',
    valida_hasta        TIMESTAMPTZ NOT NULL,
    cerrada_en          TIMESTAMPTZ,
    enviada_en          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notas               TEXT,
    CONSTRAINT estado_cotizacion_valido CHECK (estado_cotizacion IN ('ACTIVA','ARCHIVADA','EXPIRADA','CERRADA'))
);

CREATE INDEX IF NOT EXISTS idx_cotizaciones_phone ON cotizaciones(phone);
CREATE INDEX IF NOT EXISTS idx_cotizaciones_estado_valida ON cotizaciones(estado_cotizacion, valida_hasta);
CREATE INDEX IF NOT EXISTS idx_cotizaciones_enviada ON cotizaciones(enviada_en DESC);
