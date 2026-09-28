export const TARIFA_BASE_PORCENTAJE = 0.05; // 5%
export const TARIFA_ENVIO_PORCENTAJE = 0.02; // 2%

export interface DesglosePago {
  subtotalEnCentavos: number;
  tarifaBaseEnCentavos: number;
  tarifaEnvioEnCentavos: number;
  totalEnCentavos: number;
}

/**
 * Única fuente de verdad de cuánto se cobra. El frontend NUNCA recalcula esto:
 * solo muestra lo que este servicio devolvió en /pagos/iniciar.
 */
export function calcularDesglosePago(subtotalEnCentavos: number): DesglosePago {
  const tarifaBaseEnCentavos = Math.round(subtotalEnCentavos * TARIFA_BASE_PORCENTAJE);
  const tarifaEnvioEnCentavos = Math.round(subtotalEnCentavos * TARIFA_ENVIO_PORCENTAJE);

  return {
    subtotalEnCentavos,
    tarifaBaseEnCentavos,
    tarifaEnvioEnCentavos,
    totalEnCentavos: subtotalEnCentavos + tarifaBaseEnCentavos + tarifaEnvioEnCentavos,
  };
}
