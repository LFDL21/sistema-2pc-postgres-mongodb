import { MongoClient } from 'mongodb';
import { config } from '../config/env.js';

let client = null;
let db = null;

export async function getMongoDb() {
  if (!client) {
    client = new MongoClient(config.mongodb.uri, {
      serverSelectionTimeoutMS: 3000,
      connectTimeoutMS: 3000,
    });
    await client.connect();
    db = client.db();
    console.log('[MongoDB] Conectado com sucesso ao banco:', db.databaseName);
  }
  return db;
}

export async function getMongoCollection(collectionName) {
  const database = await getMongoDb();
  return database.collection(collectionName);
}

export async function checkMongoConnection() {
  try {
    const database = await getMongoDb();
    const pingResult = await database.command({ ping: 1 });
    return {
      connected: pingResult.ok === 1,
      database: database.databaseName,
    };
  } catch (error) {
    return {
      connected: false,
      database: 'sistema_2pc',
      error: error.message,
    };
  }
}

export async function closeMongo() {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}
