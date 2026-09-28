export interface ConfirmarPagoInput {
  transaccionId: string;
  numeroTarjeta: string;
  mesExpiracion: number;
  anioExpiracion: number;
  cvc: string;
  nombreEnTarjeta: string;
  tipoIdentificacion: string;
  numeroIdentificacion: string;
  numeroCuotas: number;
  aceptaTerminosYCondiciones: boolean;
}

export interface ConfirmarPagoOutput {
  ordenId: string;
  transaccionId: string;
  estado: 'APROBADA' | 'RECHAZADA' | 'PENDIENTE';
  referenciaPasarela: string;
  montoTotalEnCentavos: number;
}
