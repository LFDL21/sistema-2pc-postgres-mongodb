import { v4 as uuidv4 } from 'uuid';
import { queryPostgres } from '../database/postgres.js';
import { getMongoCollection } from '../database/mongo.js';
import {
  TransactionState,
  ParticipantState,
  OperationType,
  ScenarioType,
  FaultType,
} from './stateMachine.js';
import {
  logTransactionStart,
  logTransactionUpdate,
} from './transactionLog.js';

export class TwoPhaseCoordinator {
  // ==========================================
  // CENÁRIO 1: POSTGRESQL PRIMEIRO (INSERT)
  // ==========================================
  static async executeScenario1(productData, options = {}) {
    const txId = options.txId || `tx_${uuidv4().substring(0, 8)}`;
    const fault = options.simulateFault || FaultType.NONE;

    const timeline = [];
    timeline.push({ step: 'START', message: `Iniciando Cenário 1 (PG primeiro) - TX: ${txId}`, timestamp: new Date().toISOString() });

    // 1. Registra no log de transações
    await logTransactionStart({
      tx_id: txId,
      scenario: ScenarioType.SCENARIO_1_PG_FIRST,
      operation: OperationType.INSERT,
      payload: productData,
    });
    timeline.push({ step: 'LOG_INIT', message: 'Transação registrada como PREPARING', timestamp: new Date().toISOString() });

    let pgPrepared = false;
    let mongoPrepared = false;
    let abortReason = null;

    try {
      // 2. Prepare no PostgreSQL
      timeline.push({ step: 'PREPARE_PG_START', message: 'Fase 1: Preparando inserção pendente no PostgreSQL', timestamp: new Date().toISOString() });
      if (fault === FaultType.POSTGRES_PREPARE) {
        throw new Error('[Simulação] Falha forçada na gravação pendente do PostgreSQL');
      }
      await this.preparePostgresInsert(productData, txId);
      pgPrepared = true;
      await logTransactionUpdate(txId, { participant_pg: ParticipantState.PREPARED });
      timeline.push({ step: 'PREPARE_PG_OK', message: 'PostgreSQL: Registro gravado com status PENDING', timestamp: new Date().toISOString() });

      // 3. Prepare no MongoDB
      timeline.push({ step: 'PREPARE_MONGO_START', message: 'Fase 1: Preparando inserção pendente no MongoDB', timestamp: new Date().toISOString() });
      if (fault === FaultType.MONGO_PREPARE) {
        throw new Error('[Simulação] Falha forçada na gravação pendente do MongoDB');
      }
      await this.prepareMongoInsert(productData, txId);
      mongoPrepared = true;
      await logTransactionUpdate(txId, { participant_mongo: ParticipantState.PREPARED });
      timeline.push({ step: 'PREPARE_MONGO_OK', message: 'MongoDB: Registro gravado com status PENDING', timestamp: new Date().toISOString() });

      // 4. Verificação de falha antes do COMMIT
      if (fault === FaultType.BEFORE_COMMIT) {
        throw new Error('[Simulação] Falha forçada pelo coordenador imediatamente antes do COMMIT');
      }

    } catch (err) {
      abortReason = err.message;
      timeline.push({ step: 'PREPARE_ERROR', message: `Erro na Fase 1: ${abortReason}`, timestamp: new Date().toISOString() });
    }

    // Ponto de Decisão
    if (pgPrepared && mongoPrepared && !abortReason) {
      // DECISÃO: COMMIT
      timeline.push({ step: 'DECISION_COMMIT', message: 'Todos os participantes votaram SIM. Decisão: COMMIT', timestamp: new Date().toISOString() });
      await logTransactionUpdate(txId, { status: TransactionState.COMMITTED });

      // Fase 2: Efetivação
      try {
        if (fault === FaultType.POSTGRES_COMMIT) {
          throw new Error('[Simulação] Falha forçada no COMMIT do PostgreSQL');
        }
        await this.commitPostgres(productData.id, txId);
        await logTransactionUpdate(txId, { participant_pg: ParticipantState.COMMITTED });
        timeline.push({ step: 'COMMIT_PG_OK', message: 'PostgreSQL: Registro efetivado (status COMMITTED)', timestamp: new Date().toISOString() });
      } catch (err) {
        timeline.push({ step: 'COMMIT_PG_ERROR', message: `Erro ao efetivar PG: ${err.message}`, timestamp: new Date().toISOString() });
      }

      try {
        if (fault === FaultType.MONGO_COMMIT) {
          throw new Error('[Simulação] Falha forçada no COMMIT do MongoDB');
        }
        await this.commitMongo(productData.id, txId);
        await logTransactionUpdate(txId, { participant_mongo: ParticipantState.COMMITTED });
        timeline.push({ step: 'COMMIT_MONGO_OK', message: 'MongoDB: Registro efetivado (status COMMITTED)', timestamp: new Date().toISOString() });
      } catch (err) {
        timeline.push({ step: 'COMMIT_MONGO_ERROR', message: `Erro ao efetivar Mongo: ${err.message}`, timestamp: new Date().toISOString() });
      }

      return {
        success: true,
        txId,
        decision: TransactionState.COMMITTED,
        scenario: ScenarioType.SCENARIO_1_PG_FIRST,
        timeline,
        states: {
          postgres: pgPrepared ? 'COMMITTED' : 'FAILED',
          mongo: mongoPrepared ? 'COMMITTED' : 'FAILED',
        },
      };
    } else {
      // DECISÃO: ABORT
      timeline.push({ step: 'DECISION_ABORT', message: `Decisão: ABORT (Motivo: ${abortReason})`, timestamp: new Date().toISOString() });
      await logTransactionUpdate(txId, {
        status: TransactionState.ABORTED,
        error_message: abortReason,
      });

      // Fase 2: Compensação / Rollback
      if (pgPrepared) {
        timeline.push({ step: 'COMPENSATE_PG_START', message: 'Desfazendo operação pendente no PostgreSQL (Rollback)', timestamp: new Date().toISOString() });
        await this.rollbackPostgresInsert(productData.id, txId);
        await logTransactionUpdate(txId, { participant_pg: ParticipantState.ABORTED });
        timeline.push({ step: 'COMPENSATE_PG_OK', message: 'PostgreSQL: Registro pendente removido/compensado com sucesso', timestamp: new Date().toISOString() });
      }

      if (mongoPrepared) {
        timeline.push({ step: 'COMPENSATE_MONGO_START', message: 'Desfazendo operação pendente no MongoDB (Rollback)', timestamp: new Date().toISOString() });
        await this.rollbackMongoInsert(productData.id, txId);
        await logTransactionUpdate(txId, { participant_mongo: ParticipantState.ABORTED });
        timeline.push({ step: 'COMPENSATE_MONGO_OK', message: 'MongoDB: Registro pendente removido/compensado com sucesso', timestamp: new Date().toISOString() });
      }

      return {
        success: false,
        txId,
        decision: TransactionState.ABORTED,
        reason: abortReason,
        scenario: ScenarioType.SCENARIO_1_PG_FIRST,
        timeline,
        states: {
          postgres: pgPrepared ? 'ROLLED_BACK' : 'NOT_WRITTEN',
          mongo: mongoPrepared ? 'ROLLED_BACK' : 'NOT_WRITTEN',
        },
      };
    }
  }

  // ==========================================
  // CENÁRIO 2: MONGODB PRIMEIRO (INSERT)
  // ==========================================
  static async executeScenario2(productData, options = {}) {
    const txId = options.txId || `tx_${uuidv4().substring(0, 8)}`;
    const fault = options.simulateFault || FaultType.NONE;

    const timeline = [];
    timeline.push({ step: 'START', message: `Iniciando Cenário 2 (Mongo primeiro) - TX: ${txId}`, timestamp: new Date().toISOString() });

    // 1. Registra no log de transações
    await logTransactionStart({
      tx_id: txId,
      scenario: ScenarioType.SCENARIO_2_MONGO_FIRST,
      operation: OperationType.INSERT,
      payload: productData,
    });
    timeline.push({ step: 'LOG_INIT', message: 'Transação registrada como PREPARING', timestamp: new Date().toISOString() });

    let mongoPrepared = false;
    let pgPrepared = false;
    let abortReason = null;

    try {
      // 2. Prepare no MongoDB
      timeline.push({ step: 'PREPARE_MONGO_START', message: 'Fase 1: Preparando inserção pendente no MongoDB', timestamp: new Date().toISOString() });
      if (fault === FaultType.MONGO_PREPARE) {
        throw new Error('[Simulação] Falha forçada na gravação pendente do MongoDB');
      }
      await this.prepareMongoInsert(productData, txId);
      mongoPrepared = true;
      await logTransactionUpdate(txId, { participant_mongo: ParticipantState.PREPARED });
      timeline.push({ step: 'PREPARE_MONGO_OK', message: 'MongoDB: Registro gravado com status PENDING', timestamp: new Date().toISOString() });

      // 3. Prepare no PostgreSQL
      timeline.push({ step: 'PREPARE_PG_START', message: 'Fase 1: Preparando inserção pendente no PostgreSQL', timestamp: new Date().toISOString() });
      if (fault === FaultType.POSTGRES_PREPARE) {
        throw new Error('[Simulação] Falha forçada na gravação pendente do PostgreSQL');
      }
      await this.preparePostgresInsert(productData, txId);
      pgPrepared = true;
      await logTransactionUpdate(txId, { participant_pg: ParticipantState.PREPARED });
      timeline.push({ step: 'PREPARE_PG_OK', message: 'PostgreSQL: Registro gravado com status PENDING', timestamp: new Date().toISOString() });

      // 4. Verificação de falha antes do COMMIT
      if (fault === FaultType.BEFORE_COMMIT) {
        throw new Error('[Simulação] Falha forçada pelo coordenador imediatamente antes do COMMIT');
      }

    } catch (err) {
      abortReason = err.message;
      timeline.push({ step: 'PREPARE_ERROR', message: `Erro na Fase 1: ${abortReason}`, timestamp: new Date().toISOString() });
    }

    // Ponto de Decisão
    if (mongoPrepared && pgPrepared && !abortReason) {
      // DECISÃO: COMMIT
      timeline.push({ step: 'DECISION_COMMIT', message: 'Todos os participantes votaram SIM. Decisão: COMMIT', timestamp: new Date().toISOString() });
      await logTransactionUpdate(txId, { status: TransactionState.COMMITTED });

      // Fase 2: Efetivação
      try {
        if (fault === FaultType.MONGO_COMMIT) {
          throw new Error('[Simulação] Falha forçada no COMMIT do MongoDB');
        }
        await this.commitMongo(productData.id, txId);
        await logTransactionUpdate(txId, { participant_mongo: ParticipantState.COMMITTED });
        timeline.push({ step: 'COMMIT_MONGO_OK', message: 'MongoDB: Registro efetivado (status COMMITTED)', timestamp: new Date().toISOString() });
      } catch (err) {
        timeline.push({ step: 'COMMIT_MONGO_ERROR', message: `Erro ao efetivar Mongo: ${err.message}`, timestamp: new Date().toISOString() });
      }

      try {
        if (fault === FaultType.POSTGRES_COMMIT) {
          throw new Error('[Simulação] Falha forçada no COMMIT do PostgreSQL');
        }
        await this.commitPostgres(productData.id, txId);
        await logTransactionUpdate(txId, { participant_pg: ParticipantState.COMMITTED });
        timeline.push({ step: 'COMMIT_PG_OK', message: 'PostgreSQL: Registro efetivado (status COMMITTED)', timestamp: new Date().toISOString() });
      } catch (err) {
        timeline.push({ step: 'COMMIT_PG_ERROR', message: `Erro ao efetivar PG: ${err.message}`, timestamp: new Date().toISOString() });
      }

      return {
        success: true,
        txId,
        decision: TransactionState.COMMITTED,
        scenario: ScenarioType.SCENARIO_2_MONGO_FIRST,
        timeline,
        states: {
          mongo: mongoPrepared ? 'COMMITTED' : 'FAILED',
          postgres: pgPrepared ? 'COMMITTED' : 'FAILED',
        },
      };
    } else {
      // DECISÃO: ABORT
      timeline.push({ step: 'DECISION_ABORT', message: `Decisão: ABORT (Motivo: ${abortReason})`, timestamp: new Date().toISOString() });
      await logTransactionUpdate(txId, {
        status: TransactionState.ABORTED,
        error_message: abortReason,
      });

      // Fase 2: Compensação / Rollback
      if (mongoPrepared) {
        timeline.push({ step: 'COMPENSATE_MONGO_START', message: 'Desfazendo operação pendente no MongoDB (Rollback)', timestamp: new Date().toISOString() });
        await this.rollbackMongoInsert(productData.id, txId);
        await logTransactionUpdate(txId, { participant_mongo: ParticipantState.ABORTED });
        timeline.push({ step: 'COMPENSATE_MONGO_OK', message: 'MongoDB: Registro pendente removido/compensado com sucesso', timestamp: new Date().toISOString() });
      }

      if (pgPrepared) {
        timeline.push({ step: 'COMPENSATE_PG_START', message: 'Desfazendo operação pendente no PostgreSQL (Rollback)', timestamp: new Date().toISOString() });
        await this.rollbackPostgresInsert(productData.id, txId);
        await logTransactionUpdate(txId, { participant_pg: ParticipantState.ABORTED });
        timeline.push({ step: 'COMPENSATE_PG_OK', message: 'PostgreSQL: Registro pendente removido/compensado com sucesso', timestamp: new Date().toISOString() });
      }

      return {
        success: false,
        txId,
        decision: TransactionState.ABORTED,
        reason: abortReason,
        scenario: ScenarioType.SCENARIO_2_MONGO_FIRST,
        timeline,
        states: {
          mongo: mongoPrepared ? 'ROLLED_BACK' : 'NOT_WRITTEN',
          postgres: pgPrepared ? 'ROLLED_BACK' : 'NOT_WRITTEN',
        },
      };
    }
  }

  // ==========================================
  // CENÁRIO 3: ATUALIZAÇÃO COORDENADA (UPDATE)
  // ==========================================
  static async executeUpdate(productId, updateData, options = {}) {
    const txId = options.txId || `tx_${uuidv4().substring(0, 8)}`;
    const fault = options.simulateFault || FaultType.NONE;

    const timeline = [];
    timeline.push({ step: 'START', message: `Iniciando Cenário 3 (Atualização coordenada) para produto ${productId} - TX: ${txId}`, timestamp: new Date().toISOString() });

    // 1. Snapshot do estado anterior de ambos para permitir rollback confiável
    const previousState = await this.fetchProductFromBoth(productId);
    timeline.push({ step: 'SNAPSHOT', message: 'Snapshot do estado anterior capturado em ambos os bancos', timestamp: new Date().toISOString() });

    // 2. Registra no log de transações
    await logTransactionStart({
      tx_id: txId,
      scenario: ScenarioType.SCENARIO_3_UPDATE,
      operation: OperationType.UPDATE,
      payload: { id: productId, ...updateData },
      previous_state: previousState,
    });
    timeline.push({ step: 'LOG_INIT', message: 'Transação registrada como PREPARING', timestamp: new Date().toISOString() });

    let pgPrepared = false;
    let mongoPrepared = false;
    let abortReason = null;

    try {
      // 3. Prepare Update PostgreSQL
      timeline.push({ step: 'PREPARE_PG_UPDATE', message: 'Fase 1: Aplicando atualização com status PENDING_UPDATE no PostgreSQL', timestamp: new Date().toISOString() });
      if (fault === FaultType.POSTGRES_PREPARE) {
        throw new Error('[Simulação] Falha forçada no prepare update do PostgreSQL');
      }
      await this.preparePostgresUpdate(productId, updateData, txId);
      pgPrepared = true;
      await logTransactionUpdate(txId, { participant_pg: ParticipantState.PREPARED });
      timeline.push({ step: 'PREPARE_PG_OK', message: 'PostgreSQL: Registro atualizado como PENDING_UPDATE', timestamp: new Date().toISOString() });

      // 4. Prepare Update MongoDB
      timeline.push({ step: 'PREPARE_MONGO_UPDATE', message: 'Fase 1: Aplicando atualização com status PENDING_UPDATE no MongoDB', timestamp: new Date().toISOString() });
      if (fault === FaultType.MONGO_PREPARE) {
        throw new Error('[Simulação] Falha forçada no prepare update do MongoDB');
      }
      await this.prepareMongoUpdate(productId, updateData, txId);
      mongoPrepared = true;
      await logTransactionUpdate(txId, { participant_mongo: ParticipantState.PREPARED });
      timeline.push({ step: 'PREPARE_MONGO_OK', message: 'MongoDB: Registro atualizado como PENDING_UPDATE', timestamp: new Date().toISOString() });

      // 5. Falha simulada antes do commit
      if (fault === FaultType.BEFORE_COMMIT) {
        throw new Error('[Simulação] Falha forçada antes do COMMIT da atualização');
      }

    } catch (err) {
      abortReason = err.message;
      timeline.push({ step: 'PREPARE_ERROR', message: `Erro na Fase 1: ${abortReason}`, timestamp: new Date().toISOString() });
    }

    // Ponto de Decisão
    if (pgPrepared && mongoPrepared && !abortReason) {
      // DECISÃO: COMMIT
      timeline.push({ step: 'DECISION_COMMIT', message: 'Atualização validada nos dois bancos. Decisão: COMMIT', timestamp: new Date().toISOString() });
      await logTransactionUpdate(txId, { status: TransactionState.COMMITTED });

      await this.commitPostgres(productId, txId);
      await logTransactionUpdate(txId, { participant_pg: ParticipantState.COMMITTED });
      timeline.push({ step: 'COMMIT_PG_OK', message: 'PostgreSQL: Atualização efetivada (status COMMITTED)', timestamp: new Date().toISOString() });

      await this.commitMongo(productId, txId);
      await logTransactionUpdate(txId, { participant_mongo: ParticipantState.COMMITTED });
      timeline.push({ step: 'COMMIT_MONGO_OK', message: 'MongoDB: Atualização efetivada (status COMMITTED)', timestamp: new Date().toISOString() });

      return {
        success: true,
        txId,
        decision: TransactionState.COMMITTED,
        scenario: ScenarioType.SCENARIO_3_UPDATE,
        timeline,
      };
    } else {
      // DECISÃO: ABORT
      timeline.push({ step: 'DECISION_ABORT', message: `Decisão: ABORT (Motivo: ${abortReason}). Revertendo para snapshot`, timestamp: new Date().toISOString() });
      await logTransactionUpdate(txId, {
        status: TransactionState.ABORTED,
        error_message: abortReason,
      });

      // Rollback para o snapshot original
      if (pgPrepared && previousState.postgres) {
        timeline.push({ step: 'COMPENSATE_PG', message: 'PostgreSQL: Restaurando valores anteriores', timestamp: new Date().toISOString() });
        await this.rollbackPostgresUpdate(productId, previousState.postgres);
        await logTransactionUpdate(txId, { participant_pg: ParticipantState.ABORTED });
      }

      if (mongoPrepared && previousState.mongo) {
        timeline.push({ step: 'COMPENSATE_MONGO', message: 'MongoDB: Restaurando valores anteriores', timestamp: new Date().toISOString() });
        await this.rollbackMongoUpdate(productId, previousState.mongo);
        await logTransactionUpdate(txId, { participant_mongo: ParticipantState.ABORTED });
      }

      return {
        success: false,
        txId,
        decision: TransactionState.ABORTED,
        reason: abortReason,
        scenario: ScenarioType.SCENARIO_3_UPDATE,
        timeline,
      };
    }
  }

  // ==========================================
  // MÉTODOS DE PARTICIPANTE — POSTGRESQL
  // ==========================================
  static async preparePostgresInsert(product, txId) {
    const query = `
      INSERT INTO products (id, name, description, price, stock, status, tx_id, updated_at)
      VALUES ($1, $2, $3, $4, $5, 'PENDING', $6, NOW())
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        price = EXCLUDED.price,
        stock = EXCLUDED.stock,
        status = 'PENDING',
        tx_id = EXCLUDED.tx_id,
        updated_at = NOW()
    `;
    await queryPostgres(query, [
      product.id,
      product.name,
      product.description || '',
      product.price,
      product.stock || 0,
      txId,
    ]);
  }

  static async commitPostgres(productId, txId) {
    const query = `
      UPDATE products
      SET status = 'COMMITTED', updated_at = NOW()
      WHERE id = $1 AND tx_id = $2
    `;
    await queryPostgres(query, [productId, txId]);
  }

  static async rollbackPostgresInsert(productId, txId) {
    const query = `
      DELETE FROM products
      WHERE id = $1 AND tx_id = $2 AND status = 'PENDING'
    `;
    await queryPostgres(query, [productId, txId]);
  }

  static async preparePostgresUpdate(productId, updateData, txId) {
    const query = `
      UPDATE products
      SET name = COALESCE($1, name),
          description = COALESCE($2, description),
          price = COALESCE($3, price),
          stock = COALESCE($4, stock),
          status = 'PENDING_UPDATE',
          tx_id = $5,
          updated_at = NOW()
      WHERE id = $6
    `;
    await queryPostgres(query, [
      updateData.name || null,
      updateData.description || null,
      updateData.price !== undefined ? updateData.price : null,
      updateData.stock !== undefined ? updateData.stock : null,
      txId,
      productId,
    ]);
  }

  static async rollbackPostgresUpdate(productId, previousState) {
    const query = `
      UPDATE products
      SET name = $1,
          description = $2,
          price = $3,
          stock = $4,
          status = 'COMMITTED',
          updated_at = NOW()
      WHERE id = $5
    `;
    await queryPostgres(query, [
      previousState.name,
      previousState.description || '',
      previousState.price,
      previousState.stock || 0,
      productId,
    ]);
  }

  // ==========================================
  // MÉTODOS DE PARTICIPANTE — MONGODB
  // ==========================================
  static async prepareMongoInsert(product, txId) {
    const col = await getMongoCollection('products');
    const doc = {
      _id: product.id,
      name: product.name,
      description: product.description || '',
      price: Number(product.price),
      stock: Number(product.stock || 0),
      status: 'PENDING',
      tx_id: txId,
      updatedAt: new Date(),
    };
    await col.replaceOne({ _id: product.id }, doc, { upsert: true });
  }

  static async commitMongo(productId, txId) {
    const col = await getMongoCollection('products');
    await col.updateOne(
      { _id: productId, tx_id: txId },
      { $set: { status: 'COMMITTED', updatedAt: new Date() } }
    );
  }

  static async rollbackMongoInsert(productId, txId) {
    const col = await getMongoCollection('products');
    await col.deleteOne({ _id: productId, tx_id: txId, status: 'PENDING' });
  }

  static async prepareMongoUpdate(productId, updateData, txId) {
    const col = await getMongoCollection('products');
    const setFields = {
      status: 'PENDING_UPDATE',
      tx_id: txId,
      updatedAt: new Date(),
    };
    if (updateData.name !== undefined) setFields.name = updateData.name;
    if (updateData.description !== undefined) setFields.description = updateData.description;
    if (updateData.price !== undefined) setFields.price = Number(updateData.price);
    if (updateData.stock !== undefined) setFields.stock = Number(updateData.stock);

    await col.updateOne({ _id: productId }, { $set: setFields });
  }

  static async rollbackMongoUpdate(productId, previousState) {
    const col = await getMongoCollection('products');
    await col.updateOne(
      { _id: productId },
      {
        $set: {
          name: previousState.name,
          description: previousState.description || '',
          price: Number(previousState.price),
          stock: Number(previousState.stock || 0),
          status: 'COMMITTED',
          updatedAt: new Date(),
        },
      }
    );
  }

  // ==========================================
  // AUXILIARES
  // ==========================================
  static async fetchProductFromBoth(productId) {
    let pgProd = null;
    let mongoProd = null;

    try {
      const res = await queryPostgres('SELECT * FROM products WHERE id = $1', [productId]);
      if (res.rows.length > 0) {
        pgProd = res.rows[0];
      }
    } catch {}

    try {
      const col = await getMongoCollection('products');
      mongoProd = await col.findOne({ _id: productId });
    } catch {}

    return { postgres: pgProd, mongo: mongoProd };
  }
}
