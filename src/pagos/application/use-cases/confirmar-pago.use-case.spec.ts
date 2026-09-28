import { Result } from '@shared/result';

import { Orden } from '../../domain/orden.entity';
import { TransaccionPago } from '../../domain/transaccion-pago.entity';
import { PasarelaRechazoError } from '../../domain/pagos.errors';
import { Producto } from '../../../productos/domain/producto.entity';
import { ProductoRepositoryPort } from '../../../productos/application/ports/producto-repository.port';
import { OrdenRepositoryPort } from '../ports/orden-repository.port';
import { TransaccionPagoRepositoryPort } from '../ports/transaccion-pago-repository.port';
import { PasarelaPagoPort } from '../ports/pasarela-pago.port';
import { AplicarResultadoPasarelaService } from '../services/aplicar-resultado-pasarela.service';

import { ConfirmarPagoUseCase } from './confirmar-pago.use-case';
import { ConfirmarPagoInput } from './confirmar-pago.dto';

function ordenDePrueba(estado: 'PENDIENTE' | 'APROBADA' | 'RECHAZADA' | 'FALLIDA' = 'PENDIENTE'): Orden {
  const r = Orden.create({
    id: 'orden-1',
    usuarioId: 'usuario-1',
    productoId: 'producto-1',
    cantidad: 2,
    subtotalEnCentavos: 2000000,
    tarifaBaseEnCentavos: 100000,
    tarifaEnvioEnCentavos: 40000,
    montoTotalEnCentavos: 2140000,
    moneda: 'COP',
  });
  if (r.isFailure) throw new Error('setup');
  const orden = r.getValue();
  if (estado === 'APROBADA') orden.marcarAprobada();
  if (estado === 'RECHAZADA') orden.marcarRechazada();
  if (estado === 'FALLIDA') orden.marcarFallida();
  return orden;
}

function transaccionDePrueba(referenciaPasarela = ''): TransaccionPago {
  return TransaccionPago.crear({
    id: 'transaccion-1',
    ordenId: 'orden-1',
    referenciaPasarela,
    estado: 'PENDING',
    ultimosCuatroDigitos: '',
    numeroCuotas: 0,
  });
}

function productoDePrueba(stock = 10): Producto {
  const r = Producto.create({ id: 'producto-1', nombre: 'Camiseta', descripcion: '', stock, precioEnCentavos: 1000000 });
  if (r.isFailure) throw new Error('setup');
  return r.getValue();
}

function inputValido(overrides: Partial<ConfirmarPagoInput> = {}): ConfirmarPagoInput {
  const anioFuturo = new Date().getFullYear() + 2;
  return {
    transaccionId: 'transaccion-1',
    numeroTarjeta: '4242424242424242',
    mesExpiracion: 12,
    anioExpiracion: anioFuturo,
    cvc: '123',
    nombreEnTarjeta: 'Juan Perez',
    tipoIdentificacion: 'CC',
    numeroIdentificacion: '1020304050',
    numeroCuotas: 1,
    aceptaTerminosYCondiciones: true,
    ...overrides,
  };
}

function crearMocks(ordenInicial: Orden = ordenDePrueba(), transaccionInicial: TransaccionPago = transaccionDePrueba()) {
  const ordenes: jest.Mocked<OrdenRepositoryPort> = {
    guardar: jest.fn().mockResolvedValue(Result.ok(undefined)),
    buscarPorId: jest.fn().mockResolvedValue(Result.ok(ordenInicial)),
  };
  const transacciones: jest.Mocked<TransaccionPagoRepositoryPort> = {
    guardar: jest.fn().mockResolvedValue(Result.ok(undefined)),
    buscarPorId: jest.fn().mockResolvedValue(Result.ok(transaccionInicial)),
    buscarPorOrdenId: jest.fn(),
  };
  const productos: jest.Mocked<ProductoRepositoryPort> = {
    buscarPorId: jest.fn().mockResolvedValue(Result.ok(productoDePrueba())),
    guardar: jest.fn().mockResolvedValue(Result.ok(undefined)),
    listarTodos: jest.fn(),
  };
  const pasarela: jest.Mocked<PasarelaPagoPort> = {
    obtenerTokenAceptacion: jest.fn().mockResolvedValue(Result.ok({ acceptanceToken: 'accept-token' })),
    tokenizarTarjeta: jest.fn().mockResolvedValue(Result.ok({ cardToken: 'card-token' })),
    crearTransaccion: jest
      .fn()
      .mockResolvedValue(Result.ok({ idTransaccionPasarela: 'wompi-tx-1', estado: 'APPROVED', respuestaCruda: {} })),
    consultarTransaccion: jest.fn(),
  };

  // Fake del servicio compartido: simula su efecto real (mutar la orden) sin re-testear su lógica interna.
  const aplicarResultado = {
    aplicar: jest.fn(async (orden: Orden) => {
      orden.marcarAprobada();
      return Result.ok(undefined);
    }),
  } as unknown as jest.Mocked<AplicarResultadoPasarelaService>;

  const useCase = new ConfirmarPagoUseCase(ordenes, transacciones, productos, pasarela, aplicarResultado);
  return { ordenes, transacciones, productos, pasarela, aplicarResultado, useCase };
}

describe('ConfirmarPagoUseCase', () => {
  it('camino feliz: valida tarjeta, cobra en Wompi, aplica el resultado', async () => {
    const { pasarela, aplicarResultado, useCase } = crearMocks();

    const resultado = await useCase.ejecutar(inputValido());

    expect(resultado.isSuccess).toBe(true);
    expect(resultado.getValue().estado).toBe('APROBADA');
    expect(pasarela.crearTransaccion).toHaveBeenCalledTimes(1);
    expect(aplicarResultado.aplicar).toHaveBeenCalledTimes(1);
  });

  it('cobra el monto que quedó guardado en la Orden (con tarifas), no uno enviado por el cliente', async () => {
    const { pasarela, useCase } = crearMocks();

    await useCase.ejecutar(inputValido());

    expect(pasarela.crearTransaccion).toHaveBeenCalledWith(
      expect.objectContaining({ montoEnCentavos: 2140000, referencia: 'orden-1' }),
      expect.anything(),
      expect.anything(),
    );
  });

  it('IDEMPOTENCIA: si la orden ya está APROBADA, devuelve el resultado existente SIN llamar a Wompi', async () => {
    const orden = ordenDePrueba('APROBADA');
    const transaccion = transaccionDePrueba('wompi-tx-previa');
    const { pasarela, aplicarResultado, useCase } = crearMocks(orden, transaccion);

    const resultado = await useCase.ejecutar(inputValido());

    expect(resultado.isSuccess).toBe(true);
    expect(resultado.getValue().estado).toBe('APROBADA');
    expect(resultado.getValue().referenciaPasarela).toBe('wompi-tx-previa');
    expect(pasarela.obtenerTokenAceptacion).not.toHaveBeenCalled();
    expect(pasarela.crearTransaccion).not.toHaveBeenCalled();
    expect(aplicarResultado.aplicar).not.toHaveBeenCalled();
  });

  it('IDEMPOTENCIA: si la orden ya está RECHAZADA, devuelve el resultado existente SIN llamar a Wompi', async () => {
    const orden = ordenDePrueba('RECHAZADA');
    const { pasarela, useCase } = crearMocks(orden);

    const resultado = await useCase.ejecutar(inputValido());

    expect(resultado.isSuccess).toBe(true);
    expect(resultado.getValue().estado).toBe('RECHAZADA');
    expect(pasarela.crearTransaccion).not.toHaveBeenCalled();
  });

  it('si la orden ya FALLÓ antes, no se reintenta automáticamente', async () => {
    const orden = ordenDePrueba('FALLIDA');
    const { pasarela, useCase } = crearMocks(orden);

    const resultado = await useCase.ejecutar(inputValido());

    expect(resultado.isFailure).toBe(true);
    expect(pasarela.crearTransaccion).not.toHaveBeenCalled();
  });

  it('PROTECCIÓN CONTRA DOBLE COBRO: si Wompi ya fue llamado (referenciaPasarela no vacía) y la orden sigue PENDIENTE, no se vuelve a cobrar', async () => {
    const transaccionYaLlamada = transaccionDePrueba('wompi-tx-ya-existente');
    const { pasarela, aplicarResultado, useCase } = crearMocks(ordenDePrueba('PENDIENTE'), transaccionYaLlamada);

    const resultado = await useCase.ejecutar(inputValido());

    expect(resultado.isSuccess).toBe(true);
    expect(resultado.getValue().estado).toBe('PENDIENTE');
    expect(resultado.getValue().referenciaPasarela).toBe('wompi-tx-ya-existente');
    expect(pasarela.obtenerTokenAceptacion).not.toHaveBeenCalled();
    expect(pasarela.tokenizarTarjeta).not.toHaveBeenCalled();
    expect(pasarela.crearTransaccion).not.toHaveBeenCalled();
    expect(aplicarResultado.aplicar).not.toHaveBeenCalled();
  });

  it('tarjeta inválida: corta antes de llamar a Wompi', async () => {
    const { pasarela, useCase } = crearMocks();

    const resultado = await useCase.ejecutar(inputValido({ numeroTarjeta: '1234' }));

    expect(resultado.isFailure).toBe(true);
    expect(resultado.getError().code).toBe('VALIDATION_ERROR');
    expect(pasarela.obtenerTokenAceptacion).not.toHaveBeenCalled();
  });

  it('revalida el stock antes de cobrar: si ya no alcanza, corta antes de llamar a Wompi', async () => {
    const { productos, pasarela, useCase } = crearMocks();
    productos.buscarPorId.mockResolvedValue(Result.ok(productoDePrueba(1))); // la orden pide 2, solo queda 1

    const resultado = await useCase.ejecutar(inputValido());

    expect(resultado.isFailure).toBe(true);
    expect(resultado.getError().code).toBe('STOCK_INSUFICIENTE');
    expect(pasarela.obtenerTokenAceptacion).not.toHaveBeenCalled();
  });

  it('si Wompi rechaza al crear la transacción, la orden se guarda como FALLIDA', async () => {
    const { ordenes, pasarela, useCase } = crearMocks();
    pasarela.crearTransaccion.mockResolvedValue(Result.fail(new PasarelaRechazoError('fondos insuficientes')));

    const resultado = await useCase.ejecutar(inputValido());

    expect(resultado.isFailure).toBe(true);
    expect(resultado.getError().code).toBe('PASARELA_RECHAZO');
    expect(ordenes.guardar).toHaveBeenCalledTimes(1);
    expect(ordenes.guardar.mock.calls[0][0].estado).toBe('FALLIDA');
  });
});
