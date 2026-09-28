import { Result } from '@shared/result';
import { NotFoundError } from '@shared/domain/domain-error';

import { Usuario } from '../../../usuarios/domain/usuario.entity';
import { UsuarioRepositoryPort } from '../../../usuarios/application/ports/usuario-repository.port';
import { Producto } from '../../../productos/domain/producto.entity';
import { ProductoRepositoryPort } from '../../../productos/application/ports/producto-repository.port';
import { OrdenRepositoryPort } from '../ports/orden-repository.port';
import { TransaccionPagoRepositoryPort } from '../ports/transaccion-pago-repository.port';

import { IniciarPagoUseCase } from './iniciar-pago.use-case';

function usuarioDePrueba(): Usuario {
  const r = Usuario.create({
    id: 'usuario-1',
    nombreCompleto: 'Juan Perez',
    correoElectronico: 'juan@example.com',
    telefono: '3001234567',
    tipoDocumento: 'CC',
    numeroDocumento: '1020304050',
  });
  if (r.isFailure) throw new Error('setup');
  return r.getValue();
}

function productoDePrueba(stock = 10, precioEnCentavos = 1000000): Producto {
  const r = Producto.create({ id: 'producto-1', nombre: 'Camiseta', descripcion: '', stock, precioEnCentavos });
  if (r.isFailure) throw new Error('setup');
  return r.getValue();
}

function crearMocks() {
  const usuarios: jest.Mocked<UsuarioRepositoryPort> = { buscarPorId: jest.fn() };
  const productos: jest.Mocked<ProductoRepositoryPort> = { buscarPorId: jest.fn(), guardar: jest.fn(), listarTodos: jest.fn() };
  const ordenes: jest.Mocked<OrdenRepositoryPort> = { guardar: jest.fn(), buscarPorId: jest.fn() };
  const transacciones: jest.Mocked<TransaccionPagoRepositoryPort> = {
    guardar: jest.fn(),
    buscarPorId: jest.fn(),
    buscarPorOrdenId: jest.fn(),
  };

  usuarios.buscarPorId.mockResolvedValue(Result.ok(usuarioDePrueba()));
  productos.buscarPorId.mockResolvedValue(Result.ok(productoDePrueba()));
  ordenes.guardar.mockResolvedValue(Result.ok(undefined));
  transacciones.guardar.mockResolvedValue(Result.ok(undefined));

  const useCase = new IniciarPagoUseCase(usuarios, productos, ordenes, transacciones);
  return { usuarios, productos, ordenes, transacciones, useCase };
}

describe('IniciarPagoUseCase', () => {
  it('calcula el desglose (subtotal + 5% + 2%) y crea Orden+Transacción PENDIENTE', async () => {
    const { ordenes, transacciones, useCase } = crearMocks();

    const resultado = await useCase.ejecutar({ usuarioId: 'usuario-1', productoId: 'producto-1', cantidad: 2 });

    expect(resultado.isSuccess).toBe(true);
    const salida = resultado.getValue();
    // subtotal = 1.000.000 x 2 = 2.000.000; base 5% = 100.000; envío 2% = 40.000; total = 2.140.000
    expect(salida.desglose).toEqual({
      subtotalEnCentavos: 2000000,
      tarifaBaseEnCentavos: 100000,
      tarifaEnvioEnCentavos: 40000,
      totalEnCentavos: 2140000,
    });
    expect(ordenes.guardar).toHaveBeenCalledTimes(1);
    expect(transacciones.guardar).toHaveBeenCalledTimes(1);
  });

  it('la transacción placeholder se crea con referenciaPasarela vacía (Wompi aún no fue llamado)', async () => {
    const { transacciones, useCase } = crearMocks();
    await useCase.ejecutar({ usuarioId: 'usuario-1', productoId: 'producto-1', cantidad: 1 });

    const transaccionGuardada = transacciones.guardar.mock.calls[0][0];
    expect(transaccionGuardada.referenciaPasarela).toBe('');
    expect(transaccionGuardada.estado).toBe('PENDING');
  });

  it('rechaza si el stock es insuficiente, sin crear orden ni transacción', async () => {
    const { productos, ordenes, transacciones, useCase } = crearMocks();
    productos.buscarPorId.mockResolvedValue(Result.ok(productoDePrueba(1)));

    const resultado = await useCase.ejecutar({ usuarioId: 'usuario-1', productoId: 'producto-1', cantidad: 5 });

    expect(resultado.isFailure).toBe(true);
    expect(resultado.getError().code).toBe('STOCK_INSUFICIENTE');
    expect(ordenes.guardar).not.toHaveBeenCalled();
    expect(transacciones.guardar).not.toHaveBeenCalled();
  });

  it('rechaza si el usuario no existe', async () => {
    const { usuarios, useCase } = crearMocks();
    usuarios.buscarPorId.mockResolvedValue(Result.fail(new NotFoundError('Usuario', 'usuario-1')));

    const resultado = await useCase.ejecutar({ usuarioId: 'usuario-1', productoId: 'producto-1', cantidad: 1 });

    expect(resultado.isFailure).toBe(true);
    expect(resultado.getError().code).toBe('NOT_FOUND');
  });
});
