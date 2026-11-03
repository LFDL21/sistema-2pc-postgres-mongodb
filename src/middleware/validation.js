import { FaultType } from '../coordinator/stateMachine.js';

export function validateProductPayload(req, res, next) {
  const { id, name, price, stock, simulateFault } = req.body;

  if (!id || typeof id !== 'string' || id.trim().length === 0) {
    return res.status(400).json({
      error: 'ID do produto é obrigatório e deve ser uma string não vazia.',
    });
  }

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({
      error: 'Nome do produto é obrigatório.',
    });
  }

  if (price === undefined || isNaN(Number(price)) || Number(price) < 0) {
    return res.status(400).json({
      error: 'Preço deve ser um número válido maior ou igual a zero.',
    });
  }

  if (stock !== undefined && (isNaN(parseInt(stock, 10)) || parseInt(stock, 10) < 0)) {
    return res.status(400).json({
      error: 'Estoque deve ser um número inteiro maior ou igual a zero.',
    });
  }

  if (simulateFault && !Object.values(FaultType).includes(simulateFault)) {
    return res.status(400).json({
      error: `Falha simulada inválida. Opções permitidas: ${Object.values(FaultType).join(', ')}`,
    });
  }

  // Sanitização e formatação básica
  req.body.id = id.trim();
  req.body.name = name.trim();
  req.body.description = req.body.description ? String(req.body.description).trim() : '';
  req.body.price = parseFloat(Number(price).toFixed(2));
  req.body.stock = stock !== undefined ? parseInt(stock, 10) : 0;
  req.body.simulateFault = simulateFault || FaultType.NONE;

  next();
}

export function validateUpdatePayload(req, res, next) {
  const { name, price, stock, simulateFault } = req.body;
  const updates = {};

  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Nome não pode ser vazio.' });
    }
    updates.name = name.trim();
  }

  if (price !== undefined) {
    if (isNaN(Number(price)) || Number(price) < 0) {
      return res.status(400).json({ error: 'Preço inválido.' });
    }
    updates.price = parseFloat(Number(price).toFixed(2));
  }

  if (stock !== undefined) {
    if (isNaN(parseInt(stock, 10)) || parseInt(stock, 10) < 0) {
      return res.status(400).json({ error: 'Estoque inválido.' });
    }
    updates.stock = parseInt(stock, 10);
  }

  if (req.body.description !== undefined) {
    updates.description = String(req.body.description).trim();
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'Nenhum campo fornecido para atualização.' });
  }

  if (simulateFault && !Object.values(FaultType).includes(simulateFault)) {
    return res.status(400).json({
      error: `Falha simulada inválida. Opções permitidas: ${Object.values(FaultType).join(', ')}`,
    });
  }

  req.validatedUpdates = updates;
  req.simulateFault = simulateFault || FaultType.NONE;
  next();
}
