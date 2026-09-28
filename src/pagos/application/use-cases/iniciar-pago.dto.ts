export interface IniciarPagoInput {
  usuarioId: string;
  productoId: string;
  cantidad: number;
}

export interface IniciarPagoOutput {
  ordenId: string;
  transaccionId: string;
  desglose: {
    subtotalEnCentavos: number;
    tarifaBaseEnCentavos: number;
    tarifaEnvioEnCentavos: number;
    totalEnCentavos: number;
  };
}
