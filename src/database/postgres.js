import pg from 'pg';
import { config } from '../config/env.js';

const { Pool } = pg;

let pool = null;

export function getPostgresPool() {
  if (!pool) {
    pool = new Pool({
      host: config.postgres.host,
      port: config.postgres.port,
      database: config.postgres.database,
      user: config.postgres.user,
      password: config.postgres.password,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 3000,
    });

    pool.on('error', (err) => {
      console.error('[PostgreSQL] Erro inesperado no pool de conexões:', err.message);
    });
  }
  return pool;
}

export async function queryPostgres(text, params = []) {
  const currentPool = getPostgresPool();
  return currentPool.query(text, params);
}

export async function checkPostgresConnection() {
  try {
    const currentPool = getPostgresPool();
    const res = await currentPool.query('SELECT 1 AS connected, NOW() AS server_time');
    return {
      connected: true,
      database: config.postgres.database,
      serverTime: res.rows[0].server_time,
    };
  } catch (error) {
    return {
      connected: false,
      database: config.postgres.database,
      error: error.message,
    };
  }
}

export async function closePostgres() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
