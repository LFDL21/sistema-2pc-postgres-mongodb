import { Router } from 'express';
import { monitorService } from '../services/monitorService.js';

const router = Router();

// Obter status do monitoramento e última checagem de consistência
router.get('/monitor/status', (req, res) => {
  res.json(monitorService.getStatus());
});

// Iniciar o monitoramento contínuo
router.post('/monitor/start', (req, res) => {
  const { intervalMs } = req.body || {};
  const result = monitorService.start(intervalMs);
  res.json(result);
});

// Parar o monitoramento contínuo
router.post('/monitor/stop', (req, res) => {
  const result = monitorService.stop();
  res.json(result);
});

export default router;
