import { Inject, Injectable } from '@nestjs/common';
import { Result } from '@shared/result';
import { NotFoundError, PersistenceError, ValidationError } from '@shared/domain/domain-error';

import { TarjetaCredito } from '../../domain/tarjeta-credito.entity';
import { TransaccionPago } from '../../domain/transaccion-pago.entity';
import { PasarelaRechazoError, PasarelaNoDisponibleError, StockInsuficienteError } from '../../domain/pagos.errors';

import { ORDEN_REPOSITORY_PORT, OrdenRepositoryPort } from '../ports/orden-repository.port';
import { TRANSACCION_PAGO_REPOSITORY_PORT, TransaccionPagoRepositoryPort } from '../ports/transaccion-pago-repository.port';
import { PRODUCTO_REPOSITORY_PORT, ProductoRepositoryPort } from '../../../productos/application/ports/producto-repository.port';
import { PASARELA_PAGO_PORT, PasarelaPagoPort } from '../ports/pasarela-pago.port';
import { AplicarResultadoPasarelaService } from '../services/aplicar-resultado-pasarela.service';

import { ConfirmarPagoInput, ConfirmarPagoOutput } from './confirmar-pago.dto';

const LOG = '[ConfirmarPago]';

export type ConfirmarPagoError =
  | ValidationError
  | NotFoundError
  | StockInsuficienteError
  | PasarelaRechazoError
  | PasarelaNoDisponibleError
  | PersistenceError;

function mapearEstadoOrdenASalida(estado: string): 'APROBADA' | 'RECHAZADA' | 'PENDIENTE' {
  if (estado === 'APROBADA') return 'APROBADA';
  if (estado === 'RECHAZADA' || estado === 'FALLIDA') return 'RECHAZADA';
  return 'PENDIENTE';
}

@Injectable()
export class ConfirmarPagoUseCase {
  constructor(
    @Inject(ORDEN_REPOSITORY_PORT) private readonly ordenes: OrdenRepositoryPort,
    @Inject(TRANSACCION_PAGO_REPOSITORY_PORT) private readonly transacciones: TransaccionPagoRepositoryPort,
    @Inject(PRODUCTO_REPOSITORY_PORT) private readonly productos: ProductoRepositoryPort,
    @Inject(PASARELA_PAGO_PORT) private readonly pasarela: PasarelaPagoPort,
    private readonly aplicarResultado: AplicarResultadoPasarelaService,
  ) {}

  async ejecutar(input: ConfirmarPagoInput): Promise<Result<ConfirmarPagoOutput, ConfirmarPagoError>> {
    console.log(`${LOG} Inicio | transaccionId=${input.transaccionId}`);

    // --- Paso 1: la transacción y la orden deben existir (las creó /iniciar) ---
    const transaccionResult = await this.transacciones.buscarPorId(input.transaccionId);
    if (transaccionResult.isFailure) {
      console.error(`${LOG} FALLÓ - transacción no encontrada`);
      return Result.fail(transaccionResult.getError());
    }
    const transaccionExistente = transaccionResult.getValue();

    const ordenResult = await this.ordenes.buscarPorId(transaccionExistente.ordenId);
    if (ordenResult.isFailure) {
      console.error(`${LOG} FALLÓ - orden no encontrada`);
      return Result.fail(ordenResult.getError());
    }
    const orden = ordenResult.getValue();

    // --- Paso 2: idempotencia - si la orden YA llegó a un estado definitivo, no se repite el cobro ---
    if (orden.estado === 'APROBADA' || orden.estado === 'RECHAZADA') {
      console.log(`${LOG} Orden ${orden.id} ya estaba en estado "${orden.estado}" - devolviendo resultado existente (idempotencia).`);
      return Result.ok({
        ordenId: orden.id,
        transaccionId: transaccionExistente.id,
        estado: mapearEstadoOrdenASalida(orden.estado),
        referenciaPasarela: transaccionExistente.referenciaPasarela,
        montoTotalEnCentavos: orden.montoTotalEnCentavos,
      });
    }
    if (orden.estado === 'FALLIDA') {
      console.error(`${LOG} Orden ${orden.id} ya había FALLADO antes - no se reintenta automáticamente.`);
      return Result.fail(new PasarelaNoDisponibleError('Este intento de pago ya falló antes. Inicia un pago nuevo.'));
    }

    // --- Paso 3: si Wompi YA fue llamado antes (quedó PENDING), NO se vuelve a cobrar ---
    if (transaccionExistente.referenciaPasarela !== '') {
      console.log(`${LOG} Ya existe una llamada previa a Wompi (referencia=${transaccionExistente.referenciaPasarela}). No se cobra de nuevo.`);
      return Result.ok({
        ordenId: orden.id,
        transaccionId: transaccionExistente.id,
        estado: 'PENDIENTE',
        referenciaPasarela: transaccionExistente.referenciaPasarela,
        montoTotalEnCentavos: orden.montoTotalEnCentavos,
      });
    }

    // --- Paso 4: validar la tarjeta ---
    const tarjetaResult = TarjetaCredito.create({
      numeroTarjeta: input.numeroTarjeta,
      mesExpiracion: input.mesExpiracion,
      anioExpiracion: input.anioExpiracion,
      cvc: input.cvc,
      nombreEnTarjeta: input.nombreEnTarjeta,
      tipoIdentificacion: input.tipoIdentificacion,
      numeroIdentificacion: input.numeroIdentificacion,
      numeroCuotas: input.numeroCuotas,
      aceptaTerminosYCondiciones: input.aceptaTerminosYCondiciones,
    });
    if (tarjetaResult.isFailure) {
      console.error(`${LOG} FALLÓ - ${tarjetaResult.getError().message}`);
      return Result.fail(tarjetaResult.getError());
    }
    const tarjeta = tarjetaResult.getValue();

    // --- Paso 5: revalidar stock (pudo cambiar mientras el usuario llenaba el formulario) ---
    const productoResult = await this.productos.buscarPorId(orden.productoId);
    if (productoResult.isFailure) {
      return Result.fail(productoResult.getError());
    }
    if (productoResult.getValue().stock < orden.cantidad) {
      console.error(`${LOG} FALLÓ - el stock se agotó mientras se confirmaba el pago.`);
      return Result.fail(new StockInsuficienteError(productoResult.getValue().nombre));
    }

    // --- Paso 6: coreografía con Wompi ---
    const tokenAceptacionResult = await this.pasarela.obtenerTokenAceptacion();
    if (tokenAceptacionResult.isFailure) {
      return Result.fail(tokenAceptacionResult.getError());
    }

    console.log(`${LOG} Paso 5/6 - Tokenizando tarjeta en Wompi...`);
    const tokenTarjetaResult = await this.pasarela.tokenizarTarjeta(tarjeta);
    if (tokenTarjetaResult.isFailure) {
      return Result.fail(tokenTarjetaResult.getError());
    }
    console.log(`${LOG} Paso 5/6 - Tarjeta tokenizada OK`);

    console.log(`${LOG} Paso 5/6 - Creando transacción en Wompi | ordenId=${orden.id} monto=${orden.montoTotalEnCentavos}...`);
    const transaccionPasarelaResult = await this.pasarela.crearTransaccion(
      {
        referencia: orden.id,
        montoEnCentavos: orden.montoTotalEnCentavos,
        moneda: orden.moneda,
        numeroCuotas: input.numeroCuotas,
      },
      tokenTarjetaResult.getValue(),
      tokenAceptacionResult.getValue(),
    );
    if (transaccionPasarelaResult.isFailure) {
      console.error(`${LOG} FALLÓ al crear la transacción en Wompi - ${transaccionPasarelaResult.getError().message}`);
      orden.marcarFallida();
      await this.ordenes.guardar(orden);
      console.log(`${LOG} Orden ${orden.id} guardada con estado FALLIDA`);
      return Result.fail(transaccionPasarelaResult.getError());
    }
    const resultadoPasarela = transaccionPasarelaResult.getValue();

    console.log();

    console.log(resultadoPasarela);

    console.log();

    console.log(
      `${LOG} Paso 5/6 OK - respuesta Wompi | idTransaccion=${resultadoPasarela.idTransaccionPasarela} estado=${resultadoPasarela.estado}`,
    );



    // --- Paso 7: aplicar el resultado (mismo servicio que usan webhook y consulta activa) ---
    // Antes de aplicar, "completamos" la transacción con los datos reales de la tarjeta
    // (en /iniciar quedó con ultimosCuatroDigitos y numeroCuotas vacíos/placeholder).
    const transaccionConDatosReales = TransaccionPago.crear({
      id: transaccionExistente.id,
      ordenId: transaccionExistente.ordenId,
      referenciaPasarela: transaccionExistente.referenciaPasarela,
      estado: transaccionExistente.estado,
      ultimosCuatroDigitos: tarjeta.numero.ultimosCuatro(),
      numeroCuotas: input.numeroCuotas,
      respuestaCruda: resultadoPasarela.respuestaCruda,
    });

    const aplicarResult = await this.aplicarResultado.aplicar(orden, transaccionConDatosReales, resultadoPasarela);
    if (aplicarResult.isFailure) {
      return Result.fail(aplicarResult.getError());
    }

    console.log(`${LOG} Fin | ordenId=${orden.id} estadoFinal=${orden.estado}`);

    return Result.ok({
      ordenId: orden.id,
      transaccionId: transaccionExistente.id,
      estado: mapearEstadoOrdenASalida(orden.estado),
      referenciaPasarela: resultadoPasarela.idTransaccionPasarela,
      montoTotalEnCentavos: orden.montoTotalEnCentavos,
    });
  }
}
