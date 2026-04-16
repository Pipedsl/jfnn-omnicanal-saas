-- ═══════════════════════════════════════════════════════════════
-- JFNN Omnicanal SaaS — Esquema de Base de Datos (PostgreSQL local)
-- ═══════════════════════════════════════════════════════════════

-- Tabla principal de sesiones de WhatsApp
CREATE TABLE IF NOT EXISTS user_sessions (
    id          SERIAL PRIMARY KEY,
    phone       VARCHAR(30) NOT NULL UNIQUE,
    estado      VARCHAR(50) NOT NULL DEFAULT 'PERFILANDO',
    entidades   JSONB       NOT NULL DEFAULT '{}',
    ultimo_mensaje TIMESTAMPTZ DEFAULT NOW(),
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_phone  ON user_sessions(phone);
CREATE INDEX IF NOT EXISTS idx_user_sessions_estado ON user_sessions(estado);

-- Tabla principal de clientes recurrentes (MEJORA-3 + Mejora #7)
CREATE TABLE IF NOT EXISTS clientes (
    phone       VARCHAR(30) PRIMARY KEY,
    nombre      VARCHAR(100),
    email       VARCHAR(100),
    rut         VARCHAR(20),
    historial_cotizaciones_ids TEXT[] DEFAULT '{}',
    -- Mejora #7: Cliente recurrente
    total_compras        INTEGER     DEFAULT 0,
    total_gastado        NUMERIC(12,0) DEFAULT 0,
    ultima_compra        TIMESTAMPTZ,
    vehiculos_historicos JSONB       DEFAULT '[]',
    es_recurrente        BOOLEAN     DEFAULT FALSE,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Mejora #7: ALTER TABLE idempotente para instalaciones existentes
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS total_compras INTEGER DEFAULT 0;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS total_gastado NUMERIC(12,0) DEFAULT 0;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS ultima_compra TIMESTAMPTZ;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS vehiculos_historicos JSONB DEFAULT '[]';
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS es_recurrente BOOLEAN DEFAULT FALSE;

-- Tabla de historial/pedidos archivados
CREATE TABLE IF NOT EXISTS pedidos (
    id                  SERIAL PRIMARY KEY,
    phone               VARCHAR(30) NOT NULL,
    quote_id            VARCHAR(50),
    estado_final        VARCHAR(50),
    -- Vehículo
    marca_modelo        VARCHAR(100),
    ano                 VARCHAR(50),
    patente             VARCHAR(20),
    vin                 VARCHAR(50),
    -- Productos
    repuestos           JSONB DEFAULT '[]',
    total_cotizacion    INTEGER DEFAULT 0,
    -- Pago y despacho
    metodo_pago         VARCHAR(50),
    metodo_entrega      VARCHAR(50),
    direccion_envio     TEXT,
    tipo_documento      VARCHAR(20),
    datos_factura       JSONB DEFAULT '{}',
    -- Comprobante
    comprobante_url     TEXT,
    datos_comprobante   JSONB DEFAULT '{}',
    -- Snapshot completo
    entidades_completas JSONB DEFAULT '{}',
    archivado_en        TIMESTAMPTZ DEFAULT NOW(),
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pedidos_phone    ON pedidos(phone);
CREATE INDEX IF NOT EXISTS idx_pedidos_archivado ON pedidos(archivado_en DESC);

-- Tabla de ejemplos de entrenamiento del agente IA (HU-7)
CREATE TABLE IF NOT EXISTS training_examples (
    id          SERIAL PRIMARY KEY,
    contenido_md TEXT NOT NULL,
    fecha       TIMESTAMPTZ DEFAULT NOW(),
    activo      BOOLEAN DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_training_activo ON training_examples(activo);

-- Tabla de feriados chilenos (Fix #5 — Horario inteligente)
CREATE TABLE IF NOT EXISTS feriados (
    id          SERIAL PRIMARY KEY,
    fecha       DATE NOT NULL UNIQUE,
    nombre      VARCHAR(200) NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feriados_fecha ON feriados(fecha);

-- Seed inicial feriados Chile 2026 (idempotente)
INSERT INTO feriados (fecha, nombre) VALUES
('2026-01-01', 'Año Nuevo'),
('2026-04-03', 'Viernes Santo'),
('2026-04-04', 'Sábado Santo'),
('2026-05-01', 'Día del Trabajo'),
('2026-05-21', 'Día de las Glorias Navales'),
('2026-06-20', 'Día Nacional de los Pueblos Indígenas'),
('2026-06-29', 'San Pedro y San Pablo'),
('2026-07-16', 'Día de la Virgen del Carmen'),
('2026-08-15', 'Asunción de la Virgen'),
('2026-09-18', 'Fiestas Patrias'),
('2026-09-19', 'Día de las Glorias del Ejército'),
('2026-10-12', 'Encuentro de Dos Mundos'),
('2026-10-31', 'Día de las Iglesias Evangélicas'),
('2026-11-01', 'Día de Todos los Santos'),
('2026-12-08', 'Inmaculada Concepción'),
('2026-12-25', 'Navidad')
ON CONFLICT (fecha) DO NOTHING;
