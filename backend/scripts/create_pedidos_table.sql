-- ============================================================
-- Tabla: pedidos
-- Propósito: Historial permanente de ventas completadas.
-- Se inserta automáticamente cuando un cliente en estado
-- ENTREGADO o ARCHIVADO vuelve a iniciar una nueva cotización.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.pedidos (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone           TEXT NOT NULL,
    quote_id        TEXT,                        -- Ej: JFNN-2026-A1B2C3
    estado_final    TEXT NOT NULL,               -- Estado al momento del archivo: ENTREGADO | ARCHIVADO
    
    -- Datos del vehículo
    marca_modelo    TEXT,
    ano             TEXT,
    patente         TEXT,
    vin             TEXT,
    
    -- Productos y cotización
    repuestos       JSONB DEFAULT '[]'::jsonb,   -- Array de { nombre, precio, codigo, disponibilidad }
    total_cotizacion INTEGER DEFAULT 0,
    
    -- Datos de pago y despacho
    metodo_pago     TEXT,                        -- 'online' | 'local'
    metodo_entrega  TEXT,                        -- 'retiro' | 'domicilio'
    direccion_envio TEXT,
    tipo_documento  TEXT,                        -- 'boleta' | 'factura'
    datos_factura   JSONB DEFAULT '{}'::jsonb,
    
    -- Comprobante de pago (si aplica)
    comprobante_url TEXT,
    datos_comprobante JSONB DEFAULT '{}'::jsonb, -- Datos extraídos por IA del comprobante
    
    -- Metadata
    entidades_completas JSONB DEFAULT '{}'::jsonb, -- Snapshot completo de entidades al momento del archivo
    archivado_en    TIMESTAMPTZ DEFAULT NOW(),
    
    -- Índices para consultas del Dashboard
    CONSTRAINT pedidos_phone_not_empty CHECK (phone <> '')
);

-- Índices para el historial del Dashboard
CREATE INDEX IF NOT EXISTS idx_pedidos_phone        ON public.pedidos (phone);
CREATE INDEX IF NOT EXISTS idx_pedidos_archivado_en ON public.pedidos (archivado_en DESC);
CREATE INDEX IF NOT EXISTS idx_pedidos_quote_id     ON public.pedidos (quote_id);

-- Política RLS: Solo el service_role puede insertar/leer
ALTER TABLE public.pedidos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_on_pedidos"
    ON public.pedidos
    FOR ALL
    USING (auth.role() = 'service_role');

-- ============================================================
-- INSTRUCCIONES DE EJECUCIÓN
-- 1. Abrir el SQL Editor en Supabase Dashboard
-- 2. Copiar y pegar este script completo
-- 3. Hacer clic en "Run"
-- 4. Verificar que aparece la tabla "pedidos" en Table Editor
-- ============================================================
