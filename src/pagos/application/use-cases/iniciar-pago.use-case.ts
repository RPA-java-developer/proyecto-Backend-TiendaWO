import { randomUUID } from 'crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Result } from '@shared/result';
import { NotFoundError, PersistenceError, ValidationError } from '@shared/domain/domain-error';

import { Orden } from '../../domain/orden.entity';
import { TransaccionPago } from '../../domain/transaccion-pago.entity';
import { StockInsuficienteError } from '../../domain/pagos.errors';
import { calcularDesglosePago } from '../../domain/calcular-desglose-pago';

import { USUARIO_REPOSITORY_PORT, UsuarioRepositoryPort } from '../../../usuarios/application/ports/usuario-repository.port';
import { PRODUCTO_REPOSITORY_PORT, ProductoRepositoryPort } from '../../../productos/application/ports/producto-repository.port';
import { ORDEN_REPOSITORY_PORT, OrdenRepositoryPort } from '../ports/orden-repository.port';
import { TRANSACCION_PAGO_REPOSITORY_PORT, TransaccionPagoRepositoryPort } from '../ports/transaccion-pago-repository.port';

import { IniciarPagoInput, IniciarPagoOutput } from './iniciar-pago.dto';

const LOG = '[IniciarPago]';
const MONEDA_POR_DEFECTO = 'COP';

export type IniciarPagoError = ValidationError | NotFoundError | StockInsuficienteError | PersistenceError;

@Injectable()
export class IniciarPagoUseCase {
  constructor(
    @Inject(USUARIO_REPOSITORY_PORT) private readonly usuarios: UsuarioRepositoryPort,
    @Inject(PRODUCTO_REPOSITORY_PORT) private readonly productos: ProductoRepositoryPort,
    @Inject(ORDEN_REPOSITORY_PORT) private readonly ordenes: OrdenRepositoryPort,
    @Inject(TRANSACCION_PAGO_REPOSITORY_PORT) private readonly transacciones: TransaccionPagoRepositoryPort,
  ) {}

  async ejecutar(input: IniciarPagoInput): Promise<Result<IniciarPagoOutput, IniciarPagoError>> {
    console.log(`${LOG} Inicio | usuarioId=${input.usuarioId} productoId=${input.productoId} cantidad=${input.cantidad}`);

    const usuarioResult = await this.usuarios.buscarPorId(input.usuarioId);
    if (usuarioResult.isFailure) {
      console.error(`${LOG} FALLÓ - ${usuarioResult.getError().message}`);
      return Result.fail(usuarioResult.getError());
    }

    const productoResult = await this.productos.buscarPorId(input.productoId);
    if (productoResult.isFailure) {
      console.error(`${LOG} FALLÓ - ${productoResult.getError().message}`);
      return Result.fail(productoResult.getError());
    }
    const producto = productoResult.getValue();

    // Solo se VERIFICA el stock; no se reserva todavía (eso ocurre al confirmar el pago).
    if (producto.stock < input.cantidad) {
      console.error(`${LOG} FALLÓ - stock insuficiente para "${producto.nombre}" (disponible=${producto.stock})`);
      return Result.fail(new StockInsuficienteError(producto.nombre));
    }

    const desglose = calcularDesglosePago(producto.calcularMontoEnCentavos(input.cantidad));
    console.log(`${LOG} Desglose calculado: ${JSON.stringify(desglose)}`);

    const ordenResult = Orden.create({
      id: randomUUID(),
      usuarioId: input.usuarioId,
      productoId: input.productoId,
      cantidad: input.cantidad,
      subtotalEnCentavos: desglose.subtotalEnCentavos,
      tarifaBaseEnCentavos: desglose.tarifaBaseEnCentavos,
      tarifaEnvioEnCentavos: desglose.tarifaEnvioEnCentavos,
      montoTotalEnCentavos: desglose.totalEnCentavos,
      moneda: MONEDA_POR_DEFECTO,
    });
    if (ordenResult.isFailure) {
      return Result.fail(ordenResult.getError());
    }
    const orden = ordenResult.getValue();

    // Transacción "placeholder": todavía no hay tarjeta ni respuesta de Wompi.
    // ConfirmarPagoUseCase la completa con los datos reales.
    const transaccion = TransaccionPago.crear({
      id: randomUUID(),
      ordenId: orden.id,
      referenciaPasarela: '',
      estado: 'PENDING',
      ultimosCuatroDigitos: '',
      numeroCuotas: 0,
    });

    const guardarOrden = await this.ordenes.guardar(orden);
    if (guardarOrden.isFailure) {
      console.error(`${LOG} FALLÓ al guardar la orden - ${guardarOrden.getError().message}`);
      return Result.fail(guardarOrden.getError());
    }

    const guardarTransaccion = await this.transacciones.guardar(transaccion);
    if (guardarTransaccion.isFailure) {
      console.error(`${LOG} FALLÓ al guardar la transacción - ${guardarTransaccion.getError().message}`);
      return Result.fail(guardarTransaccion.getError());
    }

    console.log(`${LOG} Fin | ordenId=${orden.id} transaccionId=${transaccion.id}`);

    return Result.ok({
      ordenId: orden.id,
      transaccionId: transaccion.id,
      desglose,
    });
  }
}
