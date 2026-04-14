-- ═══════════════════════════════════════════════════════════════
-- Dataset de imágenes de piezas para entrenamiento futuro
-- Ejecutar una vez: psql -U jfnn_user -d jfnn_db -f part_image_dataset.sql
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS part_image_dataset (
    id                      SERIAL PRIMARY KEY,
    phone                   VARCHAR(30) NOT NULL,
    image_url               TEXT NOT NULL,
    identificacion_ia       TEXT,           -- Descripción que generó la IA
    nombre_ia               VARCHAR(200),   -- Nombre sugerido por la IA
    confianza_ia            SMALLINT,       -- 1-10
    nombre_confirmado        VARCHAR(200),   -- Nombre confirmado por el vendedor
    session_id              INTEGER,        -- FK a user_sessions.id (referencial, sin constraint)
    created_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_part_image_dataset_phone ON part_image_dataset(phone);
CREATE INDEX IF NOT EXISTS idx_part_image_dataset_created ON part_image_dataset(created_at DESC);
