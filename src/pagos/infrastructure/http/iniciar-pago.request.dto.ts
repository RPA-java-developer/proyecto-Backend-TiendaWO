import { IsInt, IsUUID, Min } from 'class-validator';

export class IniciarPagoRequestDto {
  @IsUUID()
  usuarioId: string;

  @IsUUID()
  productoId: string;

  @IsInt()
  @Min(1)
  cantidad: number;
}
