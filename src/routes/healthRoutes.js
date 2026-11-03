import { Router } from 'express';
import { checkPostgresConnection } from '../database/postgres.js';
import { checkMongoConnection } from '../database/mongo.js';

const router = Router();

router.get('/health', async (req, res) => {
  const [pgStatus, mongoStatus] = await Promise.all([
    checkPostgresConnection(),
    checkMongoConnection(),
  ]);

  res.json({
    status: pgStatus.connected && mongoStatus.connected ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    databases: {
      postgres: pgStatus,
      mongodb: mongoStatus,
    },
  });
});

export default router;
