import { queryPostgres, checkPostgresConnection } from './postgres.js';
import { getMongoDb, checkMongoConnection } from './mongo.js';

export async function initPostgresSchema() {
  const conn = await checkPostgresConnection();
  if (!conn.connected) {
    console.warn('[PostgreSQL] Não foi possível inicializar schema: conexão indisponível (' + conn.error + ')');
    return false;
  }

  const createProductsTable = `
    CREATE TABLE IF NOT EXISTS products (
      id VARCHAR(64) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      price NUMERIC(10, 2) NOT NULL,
      stock INTEGER NOT NULL DEFAULT 0,
      status VARCHAR(30) NOT NULL DEFAULT 'COMMITTED',
      tx_id VARCHAR(64),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_products_tx_id ON products(tx_id);
    CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
  `;

  const createTransactionsTable = `
    CREATE TABLE IF NOT EXISTS coordinator_transactions (
      tx_id VARCHAR(64) PRIMARY KEY,
      scenario VARCHAR(50) NOT NULL,
      operation VARCHAR(20) NOT NULL,
      status VARCHAR(30) NOT NULL,
      participant_pg VARCHAR(30),
      participant_mongo VARCHAR(30),
      payload JSONB,
      previous_state JSONB,
      error_message TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_coordinator_status ON coordinator_transactions(status);
  `;

  await queryPostgres(createProductsTable);
  await queryPostgres(createTransactionsTable);
  console.log('[PostgreSQL] Tabelas e índices verificados/criados com sucesso.');
  return true;
}

export async function initMongoSchema() {
  const conn = await checkMongoConnection();
  if (!conn.connected) {
    console.warn('[MongoDB] Não foi possível inicializar schema: conexão indisponível (' + conn.error + ')');
    return false;
  }

  const db = await getMongoDb();
  const products = db.collection('products');
  await products.createIndex({ tx_id: 1 });
  await products.createIndex({ status: 1 });

  const txLogs = db.collection('coordinator_transactions');
  await txLogs.createIndex({ tx_id: 1 }, { unique: true });
  await txLogs.createIndex({ status: 1 });

  console.log('[MongoDB] Coleções e índices verificados/criados com sucesso.');
  return true;
}

export async function initDatabases() {
  console.log('[Init] Inicializando bancos de dados...');
  const pgOk = await initPostgresSchema().catch((err) => {
    console.warn('[PostgreSQL Init Error]:', err.message);
    return false;
  });
  const mongoOk = await initMongoSchema().catch((err) => {
    console.warn('[MongoDB Init Error]:', err.message);
    return false;
  });
  return { postgres: pgOk, mongo: mongoOk };
}
