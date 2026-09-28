-- Datos de ejemplo para probar el flujo de pago end-to-end.
-- Ejecutar después de schema.sql.
-- IDs generados como UUID v4 reales y válidos (no placeholders como "1111...1111").

INSERT INTO usuarios (id, nombre_completo, correo_electronico, telefono, tipo_documento, numero_documento)
VALUES ('5aef51b8-3ab3-4546-812e-db995d70586f', 'Juan Pérez', 'juan.perez@example.com', '3001234567', 'CC', '1020304050')
ON CONFLICT (id) DO NOTHING;

INSERT INTO productos (id, nombre, descripcion, stock, precio_en_centavos)
VALUES ('c3e96122-0cc9-4ae0-ac1a-4455e19cfb86', 'Camiseta básica', 'Camiseta 100% algodón', 50, 5000000)
ON CONFLICT (id) DO NOTHING;
