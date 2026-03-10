-- =====================================================
-- Script: Crear Bucket 'comprobantes' en Supabase Storage
-- Ejecutar en el SQL Editor de tu proyecto Supabase
-- =====================================================

-- 1. Crear el bucket (privado por defecto para seguridad)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'comprobantes',
    'comprobantes',
    true,         -- público para que Next.js pueda renderizar la imagen directamente
    5242880,      -- Límite de 5 MB por archivo
    ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;


-- 2. Política RLS: Solo el service_role del backend puede subir archivos
CREATE POLICY "service_role puede subir comprobantes"
ON storage.objects
FOR INSERT
TO authenticated, service_role
WITH CHECK (bucket_id = 'comprobantes');


-- 3. Política RLS: Lectura pública (para el Dashboard de Next.js)
CREATE POLICY "lectura publica comprobantes"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'comprobantes');


-- 4. Política RLS: Solo service_role puede eliminar archivos
CREATE POLICY "service_role puede eliminar comprobantes"
ON storage.objects
FOR DELETE
TO service_role
USING (bucket_id = 'comprobantes');
