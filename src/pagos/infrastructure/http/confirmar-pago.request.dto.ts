import { IsBoolean, IsInt, IsNotEmpty, IsString, Max, Min } from 'class-validator';

export class ConfirmarPagoRequestDto {
  @IsString()
  @IsNotEmpty()
  numeroTarjeta: string;

  @IsInt()
  @Min(1)
  @Max(12)
  mesExpiracion: number;

  @IsInt()
  anioExpiracion: number;

  @IsString()
  @IsNotEmpty()
  cvc: string;

  @IsString()
  @IsNotEmpty()
  nombreEnTarjeta: string;

  @IsString()
  @IsNotEmpty()
  tipoIdentificacion: string;

  @IsString()
  @IsNotEmpty()
  numeroIdentificacion: string;

  @IsInt()
  @Min(1)
  @Max(36)
  numeroCuotas: number;

  @IsBoolean()
  aceptaTerminosYCondiciones: boolean;
}
