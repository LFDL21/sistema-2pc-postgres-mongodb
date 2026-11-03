import { queryPostgres } from '../database/postgres.js';
import { getMongoCollection } from '../database/mongo.js';

export class ProductService {
  static async listFromPostgres() {
    try {
      const res = await queryPostgres(
        'SELECT id, name, description, price, stock, status, tx_id, updated_at FROM products ORDER BY id ASC'
      );
      return res.rows.map(row => ({
        ...row,
        price: parseFloat(row.price),
      }));
    } catch (err) {
      return { error: err.message, items: [] };
    }
  }

  static async listFromMongo() {
    try {
      const col = await getMongoCollection('products');
      const docs = await col.find().sort({ _id: 1 }).toArray();
      return docs.map(doc => ({
        id: doc._id,
        name: doc.name,
        description: doc.description,
        price: parseFloat(doc.price),
        stock: doc.stock,
        status: doc.status,
        tx_id: doc.tx_id,
        updated_at: doc.updatedAt,
      }));
    } catch (err) {
      return { error: err.message, items: [] };
    }
  }

  static async getCombinedList() {
    const pgResult = await this.listFromPostgres();
    const mongoResult = await this.listFromMongo();

    const pgItems = Array.isArray(pgResult) ? pgResult : [];
    const mongoItems = Array.isArray(mongoResult) ? mongoResult : [];

    const map = new Map();

    pgItems.forEach(item => {
      map.set(item.id, {
        id: item.id,
        postgres: item,
        mongo: null,
      });
    });

    mongoItems.forEach(item => {
      if (map.has(item.id)) {
        map.get(item.id).mongo = item;
      } else {
        map.set(item.id, {
          id: item.id,
          postgres: null,
          mongo: item,
        });
      }
    });

    return Array.from(map.values());
  }

  static async clearAll() {
    let pgOk = false;
    let mongoOk = false;

    try {
      await queryPostgres('TRUNCATE TABLE products, coordinator_transactions');
      pgOk = true;
    } catch (err) {
      console.warn('[ClearAll] PostgreSQL:', err.message);
    }

    try {
      const colProd = await getMongoCollection('products');
      await colProd.deleteMany({});
      const colTx = await getMongoCollection('coordinator_transactions');
      await colTx.deleteMany({});
      mongoOk = true;
    } catch (err) {
      console.warn('[ClearAll] MongoDB:', err.message);
    }

    return { postgres: pgOk, mongo: mongoOk };
  }
}
