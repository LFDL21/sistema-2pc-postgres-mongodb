import { Router } from 'express';
import { TwoPhaseCoordinator } from '../coordinator/twoPhaseCoordinator.js';
import { listRecentTransactions, getTransaction } from '../coordinator/transactionLog.js';
import { RecoveryWorker } from '../coordinator/recoveryWorker.js';
import { validateProductPayload } from '../middleware/validation.js';

const router = Router();

// Cenário 1: PostgreSQL Primeiro
router.post('/transactions/scenario1', validateProductPayload, async (req, res, next) => {
  try {
    const result = await TwoPhaseCoordinator.executeScenario1(req.body, {
      simulateFault: req.body.simulateFault,
    });
    res.status(result.success ? 200 : 409).json(result);
  } catch (err) {
    next(err);
  }
});

// Cenário 2: MongoDB Primeiro
router.post('/transactions/scenario2', validateProductPayload, async (req, res, next) => {
  try {
    const result = await TwoPhaseCoordinator.executeScenario2(req.body, {
      simulateFault: req.body.simulateFault,
    });
    res.status(result.success ? 200 : 409).json(result);
  } catch (err) {
    next(err);
  }
});

// Listagem do histórico de transações
router.get('/transactions', async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 50;
    const transactions = await listRecentTransactions(limit);
    res.json({ transactions });
  } catch (err) {
    next(err);
  }
});

// Detalhes de uma transação específica
router.get('/transactions/:txId', async (req, res, next) => {
  try {
    const tx = await getTransaction(req.params.txId);
    if (!tx) {
      return res.status(404).json({ error: 'Transação não encontrada.' });
    }
    res.json(tx);
  } catch (err) {
    next(err);
  }
});

// Disparo manual do processo de recuperação de transações órfãs
router.post('/recovery/run', async (req, res, next) => {
  try {
    const report = await RecoveryWorker.runRecovery();
    res.json({
      message: 'Rotina de recuperação 2PC executada.',
      report,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
