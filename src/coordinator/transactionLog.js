import { queryPostgres } from '../database/postgres.js';
import { getMongoCollection } from '../database/mongo.js';
import { config } from '../config/env.js';
import { TransactionState, ParticipantState } from './stateMachine.js';

// Fallback in-memory cache para garantir histórico acessível mesmo se um banco estiver offline
const memoryTxCache = new Map();

export async function logTransactionStart({
  tx_id,
  scenario,
  operation,
  payload,
  previous_state = null,
}) {
  const record = {
    tx_id,
    scenario,
    operation,
    status: TransactionState.PREPARING,
    participant_pg: ParticipantState.NOT_STARTED,
    participant_mongo: ParticipantState.NOT_STARTED,
    payload,
    previous_state,
    error_message: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  memoryTxCache.set(tx_id, { ...record });

  // Tenta persistir no MongoDB
  try {
    const col = await getMongoCollection('coordinator_transactions');
    await col.updateOne(
      { tx_id },
      { $set: { ...record, created_at: new Date(), updated_at: new Date() } },
      { upsert: true }
    );
  } catch (err) {
    console.warn(`[TxLog] Não foi possível persistir início de transação ${tx_id} no MongoDB:`, err.message);
  }

  // Tenta persistir no PostgreSQL somente se configurado
  if (config.postgres.password) {
    try {
      await queryPostgres(
        `INSERT INTO coordinator_transactions 
          (tx_id, scenario, operation, status, participant_pg, participant_mongo, payload, previous_state, error_message, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
         ON CONFLICT (tx_id) DO UPDATE SET
          status = EXCLUDED.status,
          participant_pg = EXCLUDED.participant_pg,
          participant_mongo = EXCLUDED.participant_mongo,
          updated_at = NOW()`,
        [
          tx_id,
          scenario,
          operation,
          record.status,
          record.participant_pg,
          record.participant_mongo,
          JSON.stringify(payload),
          previous_state ? JSON.stringify(previous_state) : null,
          null,
        ]
      );
    } catch (err) {
      console.warn(`[TxLog] Não foi possível persistir início de transação ${tx_id} no PostgreSQL:`, err.message);
    }
  }

  return record;
}

export async function logTransactionUpdate(tx_id, updates) {
  const current = memoryTxCache.get(tx_id) || {};
  const updated = {
    ...current,
    ...updates,
    updated_at: new Date().toISOString(),
  };
  memoryTxCache.set(tx_id, updated);

  // Atualiza no MongoDB
  try {
    const col = await getMongoCollection('coordinator_transactions');
    const mongoUpdate = { ...updates, updated_at: new Date() };
    await col.updateOne({ tx_id }, { $set: mongoUpdate });
  } catch (err) {
    console.warn(`[TxLog] Falha ao atualizar transação ${tx_id} no MongoDB:`, err.message);
  }

  // Atualiza no PostgreSQL somente se configurado
  if (config.postgres.password) {
    try {
      const fields = [];
      const values = [tx_id];
      let idx = 2;

      if (updates.status !== undefined) {
        fields.push(`status = $${idx++}`);
        values.push(updates.status);
      }
      if (updates.participant_pg !== undefined) {
        fields.push(`participant_pg = $${idx++}`);
        values.push(updates.participant_pg);
      }
      if (updates.participant_mongo !== undefined) {
        fields.push(`participant_mongo = $${idx++}`);
        values.push(updates.participant_mongo);
      }
      if (updates.error_message !== undefined) {
        fields.push(`error_message = $${idx++}`);
        values.push(updates.error_message);
      }
      fields.push(`updated_at = NOW()`);

      if (fields.length > 1) {
        const sql = `UPDATE coordinator_transactions SET ${fields.join(', ')} WHERE tx_id = $1`;
        await queryPostgres(sql, values);
      }
    } catch (err) {
      console.warn(`[TxLog] Falha ao atualizar transação ${tx_id} no PostgreSQL:`, err.message);
    }
  }

  return updated;
}

export async function getTransaction(tx_id) {
  if (memoryTxCache.has(tx_id)) {
    return memoryTxCache.get(tx_id);
  }

  try {
    const res = await queryPostgres(
      'SELECT * FROM coordinator_transactions WHERE tx_id = $1',
      [tx_id]
    );
    if (res.rows.length > 0) {
      return res.rows[0];
    }
  } catch {}

  try {
    const col = await getMongoCollection('coordinator_transactions');
    const doc = await col.findOne({ tx_id });
    if (doc) return doc;
  } catch {}

  return null;
}

export async function listRecentTransactions(limit = 30) {
  // Retorna da memória e/ou bancos
  const inMemoryList = Array.from(memoryTxCache.values())
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, limit);

  // Se tivermos registros em cache, usamos
  if (inMemoryList.length > 0) {
    return inMemoryList;
  }

  // Senão tenta buscar do PostgreSQL
  try {
    const res = await queryPostgres(
      'SELECT * FROM coordinator_transactions ORDER BY created_at DESC LIMIT $1',
      [limit]
    );
    if (res.rows.length > 0) {
      return res.rows;
    }
  } catch {}

  // Senão tenta buscar do MongoDB
  try {
    const col = await getMongoCollection('coordinator_transactions');
    const docs = await col.find().sort({ created_at: -1 }).limit(limit).toArray();
    return docs;
  } catch {}

  return [];
}
