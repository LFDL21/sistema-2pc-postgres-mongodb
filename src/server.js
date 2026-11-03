import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config/env.js';
import { initDatabases } from './database/init.js';
import { closePostgres } from './database/postgres.js';
import { closeMongo } from './database/mongo.js';
import { monitorService } from './services/monitorService.js';

import healthRoutes from './routes/healthRoutes.js';
import transactionRoutes from './routes/transactionRoutes.js';
import productRoutes from './routes/productRoutes.js';
import monitorRoutes from './routes/monitorRoutes.js';
import { errorHandler } from './middleware/errorHandler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Middlewares globais
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir frontend estático puro da pasta public
app.use(express.static(path.resolve(__dirname, '../public')));

// Rotas da API
app.use('/api', healthRoutes);
app.use('/api', transactionRoutes);
app.use('/api', productRoutes);
app.use('/api', monitorRoutes);

// Tratamento de erros
app.use(errorHandler);

// Inicia servidor
const PORT = config.port;

async function bootstrap() {
  console.log('='.repeat(70));
  console.log('Sistema de Persistência Distribuída (PostgreSQL + MongoDB - 2PC)');
  console.log('='.repeat(70));

  // Tenta inicializar tabelas e coleções
  try {
    await initDatabases();
  } catch (err) {
    console.warn('[Bootstrap] Aviso ao inicializar bancos:', err.message);
  }

  const server = app.listen(PORT, () => {
    console.log(`[Servidor] Aplicação executando em: http://localhost:${PORT}`);
    console.log(`[Servidor] Monitor configurado para intervalo de ${config.monitor.intervalMs}ms`);
  });

  // Encerramento gracioso
  const gracefulShutdown = async () => {
    console.log('\n[Servidor] Encerrando serviços...');
    monitorService.stop();
    await closePostgres();
    await closeMongo();
    server.close(() => {
      console.log('[Servidor] Aplicação finalizada.');
      process.exit(0);
    });
  };

  process.on('SIGINT', gracefulShutdown);
  process.on('SIGTERM', gracefulShutdown);
}

// Inicia se executado diretamente
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  bootstrap();
}

export { app, bootstrap };
