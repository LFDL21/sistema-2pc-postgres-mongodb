import { describe, it, expect, vi } from 'vitest';
import { validateProductPayload, validateUpdatePayload } from '../src/middleware/validation.js';

describe('Middleware de Validação e Sanitização', () => {
  it('deve rejeitar payload sem ID ou sem Nome', () => {
    const req = { body: { id: '', name: 'Teste', price: 10 } };
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    const next = vi.fn();

    validateProductPayload(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it('deve rejeitar preço negativo ou inválido', () => {
    const req = { body: { id: 'PRD-1', name: 'Item', price: -5 } };
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    const next = vi.fn();

    validateProductPayload(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('deve aceitar payload válido e sanitizar campos numéricos e strings', () => {
    const req = {
      body: {
        id: '  PRD-123  ',
        name: '  Teclado Gamer  ',
        description: '  Mecânico RGB  ',
        price: '299.999',
        stock: '15',
        simulateFault: 'none',
      },
    };
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    const next = vi.fn();

    validateProductPayload(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.body.id).toBe('PRD-123');
    expect(req.body.name).toBe('Teclado Gamer');
    expect(req.body.price).toBe(300.00);
    expect(req.body.stock).toBe(15);
  });

  it('deve rejeitar falha simulada desconhecida', () => {
    const req = {
      body: {
        id: 'PRD-1',
        name: 'Item',
        price: 10,
        simulateFault: 'invalid_fault_name',
      },
    };
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    const next = vi.fn();

    validateProductPayload(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
