import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import type { Response } from 'express';

import { ProcesarPagoUseCase } from '../../application/use-cases/procesar-pago.use-case';
import { ConsultarEstadoTransaccionUseCase } from '../../application/use-cases/consultar-estado-transaccion.use-case';
import { ProcesarWebhookWompiUseCase } from '../../application/use-cases/procesar-webhook-wompi.use-case';
import { IniciarPagoUseCase } from '../../application/use-cases/iniciar-pago.use-case';
import { ConfirmarPagoUseCase } from '../../application/use-cases/confirmar-pago.use-case';
import { ProcesarPagoRequestDto } from './procesar-pago.request.dto';
import { IniciarPagoRequestDto } from './iniciar-pago.request.dto';
import { ConfirmarPagoRequestDto } from './confirmar-pago.request.dto';
import { mapearErrorDominioAHttp } from '@shared/http/error-http.mapper';
import { WompiEventoPayload } from '../wompi/wompi-evento.dto';

@Controller('pagos')
export class PagoController {
  constructor(
    private readonly procesarPago: ProcesarPagoUseCase,
    private readonly iniciarPago: IniciarPagoUseCase,
    private readonly confirmarPago: ConfirmarPagoUseCase,
    private readonly consultarEstadoTransaccion: ConsultarEstadoTransaccionUseCase,
    private readonly procesarWebhookWompi: ProcesarWebhookWompiUseCase,
  ) {}

  /** @deprecated Usa /pagos/iniciar + /pagos/:id/confirmar (flujo con wizard). Se deja por compatibilidad. */
  @Post()
  @HttpCode(200)
  async procesar(@Body() dto: ProcesarPagoRequestDto, @Res() res: Response) {
    const resultado = await this.procesarPago.ejecutar(dto);

    // El controlador es el ÚNICO lugar donde el Result se traduce a HTTP.
    // El caso de uso y el dominio no conocen Express ni códigos de estado.
    return resultado.match({
      onSuccess: (output) =>
        res.status(200).json({
          status: 'OK',
          data: output,
        }),
      onFailure: (error) => {
        const { status, body } = mapearErrorDominioAHttp(error);
        return res.status(status).json(body);
      },
    });
  }

  /**
   * Paso 1 del flujo con wizard: crea Orden+Transacción PENDIENTE y calcula
   * el desglose de tarifas. No toca Wompi todavía (no hay tarjeta aún).
   */
  @Post('iniciar')
  @HttpCode(200)
  async iniciar(@Body() dto: IniciarPagoRequestDto, @Res() res: Response) {
    const resultado = await this.iniciarPago.ejecutar(dto);

    return resultado.match({
      onSuccess: (output) => res.status(200).json({ status: 'OK', data: output }),
      onFailure: (error) => {
        const { status, body } = mapearErrorDominioAHttp(error);
        return res.status(status).json(body);
      },
    });
  }

  /**
   * Paso 2 del flujo con wizard: recibe los datos de tarjeta y ejecuta el
   * cobro real contra Wompi. Idempotente: seguro de reintentar.
   */
  @Post(':transaccionId/confirmar')
  @HttpCode(200)
  async confirmar(
    @Param('transaccionId', new ParseUUIDPipe()) transaccionId: string,
    @Body() dto: ConfirmarPagoRequestDto,
    @Res() res: Response,
  ) {
    const resultado = await this.confirmarPago.ejecutar({ transaccionId, ...dto });

    return resultado.match({
      onSuccess: (output) => res.status(200).json({ status: 'OK', data: output }),
      onFailure: (error) => {
        const { status, body } = mapearErrorDominioAHttp(error);
        return res.status(status).json(body);
      },
    });
  }

  /** Pensado para polling desde el frontend React mientras el pago está PENDING. */
  @Get(':transaccionId/estado')
  @HttpCode(200)
  async consultarEstado(@Param('transaccionId', new ParseUUIDPipe()) transaccionId: string, @Res() res: Response) {
    const resultado = await this.consultarEstadoTransaccion.ejecutar(transaccionId);

    return resultado.match({
      onSuccess: (output) =>
        res.status(200).json({
          status: 'OK',
          data: output,
        }),
      onFailure: (error) => {
        const { status, body } = mapearErrorDominioAHttp(error);
        return res.status(status).json(body);
      },
    });
  }

  /**
   * Endpoint público que Wompi llama cuando el estado de una transacción cambia.
   * Configúralo en el Dashboard de Wompi (Sandbox y Producción por separado):
   *   https://tu-dominio.com/pagos/webhook
   * Debe responder 200 rápido; si responde error, Wompi reintenta el evento.
   */
  @Post('webhook')
  @HttpCode(200)
  async webhook(@Body() payload: WompiEventoPayload, @Res() res: Response) {
    const resultado = await this.procesarWebhookWompi.ejecutar(payload);

    return resultado.match({
      onSuccess: () => res.status(200).json({ status: 'OK' }),
      onFailure: (error) => {
        const { status, body } = mapearErrorDominioAHttp(error);
        return res.status(status).json(body);
      },
    });
  }
}
