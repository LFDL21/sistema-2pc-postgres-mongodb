import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  TransactionState,
  ParticipantState,
  ScenarioType,
  FaultType,
} from '../src/coordinator/stateMachine.js';
import { TwoPhaseCoordinator } from '../src/coordinator/twoPhaseCoordinator.js';

describe('2PC Protocol Coordinator — Regras e Máquina de Estados', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('deve possuir todos os estados de transação e falhas simuladas definidas', () => {
    expect(TransactionState.PREPARING).toBe('PREPARING');
    expect(TransactionState.COMMITTED).toBe('COMMITTED');
    expect(TransactionState.ABORTED).toBe('ABORTED');

    expect(ParticipantState.PREPARED).toBe('PREPARED');
    expect(ParticipantState.COMMITTED).toBe('COMMITTED');
    expect(ParticipantState.ABORTED).toBe('ABORTED');

    expect(FaultType.MONGO_PREPARE).toBe('mongo_prepare');
    expect(FaultType.POSTGRES_PREPARE).toBe('postgres_prepare');
    expect(FaultType.BEFORE_COMMIT).toBe('before_commit');
  });

  it('Cenário 1: deve executar COMMIT quando ambos os participantes preparam com sucesso', async () => {
    const mockPgPrepare = vi.spyOn(TwoPhaseCoordinator, 'preparePostgresInsert').mockResolvedValue(true);
    const mockMongoPrepare = vi.spyOn(TwoPhaseCoordinator, 'prepareMongoInsert').mockResolvedValue(true);
    const mockPgCommit = vi.spyOn(TwoPhaseCoordinator, 'commitPostgres').mockResolvedValue(true);
    const mockMongoCommit = vi.spyOn(TwoPhaseCoordinator, 'commitMongo').mockResolvedValue(true);

    const result = await TwoPhaseCoordinator.executeScenario1({
      id: 'TEST-001',
      name: 'Item Teste',
      price: 100.5,
      stock: 10,
    });

    expect(result.success).toBe(true);
    expect(result.decision).toBe(TransactionState.COMMITTED);
    expect(mockPgPrepare).toHaveBeenCalled();
    expect(mockMongoPrepare).toHaveBeenCalled();
    expect(mockPgCommit).toHaveBeenCalled();
    expect(mockMongoCommit).toHaveBeenCalled();
  });

  it('Cenário 1: se MongoDB falhar no Prepare, deve abortar e fazer Rollback no PostgreSQL', async () => {
    const mockPgPrepare = vi.spyOn(TwoPhaseCoordinator, 'preparePostgresInsert').mockResolvedValue(true);
    const mockPgRollback = vi.spyOn(TwoPhaseCoordinator, 'rollbackPostgresInsert').mockResolvedValue(true);

    const result = await TwoPhaseCoordinator.executeScenario1(
      {
        id: 'TEST-002',
        name: 'Item Falha Mongo',
        price: 200,
        stock: 5,
      },
      { simulateFault: FaultType.MONGO_PREPARE }
    );

    expect(result.success).toBe(false);
    expect(result.decision).toBe(TransactionState.ABORTED);
    expect(mockPgPrepare).toHaveBeenCalled();
    expect(mockPgRollback).toHaveBeenCalled();
    expect(result.states.postgres).toBe('ROLLED_BACK');
  });

  it('Cenário 2: deve preparar MongoDB primeiro e efetivar ambos no fluxo feliz', async () => {
    const orderOfCalls = [];
    vi.spyOn(TwoPhaseCoordinator, 'prepareMongoInsert').mockImplementation(async () => {
      orderOfCalls.push('mongo_prepare');
    });
    vi.spyOn(TwoPhaseCoordinator, 'preparePostgresInsert').mockImplementation(async () => {
      orderOfCalls.push('pg_prepare');
    });
    vi.spyOn(TwoPhaseCoordinator, 'commitMongo').mockResolvedValue(true);
    vi.spyOn(TwoPhaseCoordinator, 'commitPostgres').mockResolvedValue(true);

    const result = await TwoPhaseCoordinator.executeScenario2({
      id: 'TEST-003',
      name: 'Item Cenário 2',
      price: 350,
      stock: 2,
    });

    expect(result.success).toBe(true);
    expect(result.decision).toBe(TransactionState.COMMITTED);
    expect(orderOfCalls).toEqual(['mongo_prepare', 'pg_prepare']);
  });

  it('Cenário 2: se PostgreSQL falhar no Prepare, deve abortar e fazer Rollback no MongoDB', async () => {
    const mockMongoPrepare = vi.spyOn(TwoPhaseCoordinator, 'prepareMongoInsert').mockResolvedValue(true);
    const mockMongoRollback = vi.spyOn(TwoPhaseCoordinator, 'rollbackMongoInsert').mockResolvedValue(true);

    const result = await TwoPhaseCoordinator.executeScenario2(
      {
        id: 'TEST-004',
        name: 'Item Falha PG',
        price: 450,
        stock: 3,
      },
      { simulateFault: FaultType.POSTGRES_PREPARE }
    );

    expect(result.success).toBe(false);
    expect(result.decision).toBe(TransactionState.ABORTED);
    expect(mockMongoPrepare).toHaveBeenCalled();
    expect(mockMongoRollback).toHaveBeenCalled();
    expect(result.states.mongo).toBe('ROLLED_BACK');
  });

  it('Cenário 1: falha antes do COMMIT deve abortar e compensar ambos os bancos', async () => {
    const mockPgPrepare = vi.spyOn(TwoPhaseCoordinator, 'preparePostgresInsert').mockResolvedValue(true);
    const mockMongoPrepare = vi.spyOn(TwoPhaseCoordinator, 'prepareMongoInsert').mockResolvedValue(true);
    const mockPgRollback = vi.spyOn(TwoPhaseCoordinator, 'rollbackPostgresInsert').mockResolvedValue(true);
    const mockMongoRollback = vi.spyOn(TwoPhaseCoordinator, 'rollbackMongoInsert').mockResolvedValue(true);

    const result = await TwoPhaseCoordinator.executeScenario1(
      {
        id: 'TEST-005',
        name: 'Item Crash Pré-Commit',
        price: 99,
        stock: 1,
      },
      { simulateFault: FaultType.BEFORE_COMMIT }
    );

    expect(result.success).toBe(false);
    expect(result.decision).toBe(TransactionState.ABORTED);
    expect(mockPgRollback).toHaveBeenCalled();
    expect(mockMongoRollback).toHaveBeenCalled();
  });
});
