export function errorHandler(err, req, res, next) {
  console.error('[API Error]:', err);

  const status = err.status || 500;
  const message = err.message || 'Erro interno no servidor.';

  res.status(status).json({
    error: message,
    timestamp: new Date().toISOString(),
    path: req.originalUrl,
  });
}
