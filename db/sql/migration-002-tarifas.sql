-- Ejecutar solo si tu base ya existía ANTES del flujo iniciar/confirmar.
-- Si vas a crear la base desde cero, con schema.sql ya te alcanza.

ALTER TABLE ordenes ADD COLUMN IF NOT EXISTS subtotal_en_centavos BIGINT NOT NULL DEFAULT 0;
ALTER TABLE ordenes ADD COLUMN IF NOT EXISTS tarifa_base_en_centavos BIGINT NOT NULL DEFAULT 0;
ALTER TABLE ordenes ADD COLUMN IF NOT EXISTS tarifa_envio_en_centavos BIGINT NOT NULL DEFAULT 0;
