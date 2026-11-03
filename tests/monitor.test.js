import { describe, it, expect } from 'vitest';
import { monitorService } from '../src/services/monitorService.js';

describe('MonitorService — Detecção de Consistência e Divergências', () => {
  it('deve identificar bases consistentes quando os registros forem idênticos', () => {
    const pgItems = [
      { id: 'PRD-1', name: 'Notebook', price: 3000, stock: 5, status: 'COMMITTED' },
      { id: 'PRD-2', name: 'Mouse', price: 50, stock: 20, status: 'COMMITTED' },
    ];
    const mongoItems = [
      { id: 'PRD-1', name: 'Notebook', price: 3000, stock: 5, status: 'COMMITTED' },
      { id: 'PRD-2', name: 'Mouse', price: 50, stock: 20, status: 'COMMITTED' },
    ];

    const divergences = monitorService.compareDatabases(pgItems, mongoItems);
    expect(divergences).toHaveLength(0);
  });

  it('deve acusar divergência quando um registro existir apenas no PostgreSQL', () => {
    const pgItems = [
      { id: 'PRD-1', name: 'Notebook', price: 3000, stock: 5, status: 'COMMITTED' },
      { id: 'PRD-2', name: 'Mouse', price: 50, stock: 20, status: 'COMMITTED' },
    ];
    const mongoItems = [
      { id: 'PRD-1', name: 'Notebook', price: 3000, stock: 5, status: 'COMMITTED' },
    ];

    const divergences = monitorService.compareDatabases(pgItems, mongoItems);
    expect(divergences.length).toBeGreaterThan(0);
    expect(divergences[0].type).toBe('MISSING_IN_MONGO');
    expect(divergences[0].id).toBe('PRD-2');
  });

  it('deve acusar divergência quando um registro existir apenas no MongoDB', () => {
    const pgItems = [];
    const mongoItems = [
      { id: 'PRD-3', name: 'Teclado', price: 120, stock: 15, status: 'COMMITTED' },
    ];

    const divergences = monitorService.compareDatabases(pgItems, mongoItems);
    expect(divergences.length).toBe(1);
    expect(divergences[0].type).toBe('MISSING_IN_PG');
    expect(divergences[0].id).toBe('PRD-3');
  });

  it('deve acusar divergência se houver divergência de preço ou estoque', () => {
    const pgItems = [
      { id: 'PRD-1', name: 'Notebook', price: 3000, stock: 5, status: 'COMMITTED' },
    ];
    const mongoItems = [
      { id: 'PRD-1', name: 'Notebook', price: 3500, stock: 5, status: 'COMMITTED' },
    ];

    const divergences = monitorService.compareDatabases(pgItems, mongoItems);
    expect(divergences.length).toBe(1);
    expect(divergences[0].type).toBe('FIELD_MISMATCH');
    expect(divergences[0].message).toContain('Preço diverge');
  });

  it('deve acusar divergência se o status 2PC for divergente (ex: PENDING vs COMMITTED)', () => {
    const pgItems = [
      { id: 'PRD-1', name: 'Notebook', price: 3000, stock: 5, status: 'PENDING' },
    ];
    const mongoItems = [
      { id: 'PRD-1', name: 'Notebook', price: 3000, stock: 5, status: 'COMMITTED' },
    ];

    const divergences = monitorService.compareDatabases(pgItems, mongoItems);
    expect(divergences.length).toBe(1);
    expect(divergences[0].type).toBe('FIELD_MISMATCH');
    expect(divergences[0].message).toContain('Status 2PC diverge');
  });
});
