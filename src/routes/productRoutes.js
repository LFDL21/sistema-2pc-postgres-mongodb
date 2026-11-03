import { Router } from 'express';
import { ProductService } from '../services/productService.js';
import { TwoPhaseCoordinator } from '../coordinator/twoPhaseCoordinator.js';
import { validateUpdatePayload } from '../middleware/validation.js';

const router = Router();

// Obter listagem comparativa de produtos em ambos os bancos
router.get('/products', async (req, res, next) => {
  try {
    const combined = await ProductService.getCombinedList();
    res.json({ products: combined });
  } catch (err) {
    next(err);
  }
});

// Cenário 3: Atualização coordenada com 2PC
router.put('/products/:id', validateUpdatePayload, async (req, res, next) => {
  try {
    const productId = req.params.id;
    const result = await TwoPhaseCoordinator.executeUpdate(
      productId,
      req.validatedUpdates,
      { simulateFault: req.simulateFault }
    );
    res.status(result.success ? 200 : 409).json(result);
  } catch (err) {
    next(err);
  }
});

// Limpar tabelas para testes limpos
router.delete('/products', async (req, res, next) => {
  try {
    const result = await ProductService.clearAll();
    res.json({
      message: 'Dados limpos com sucesso.',
      result,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
