import { performance } from 'perf_hooks';
import { config } from '../config/env.js';
import { ProductService } from './productService.js';

class MonitorService {
  constructor() {
    this.isRunning = false;
    this.isCycleExecuting = false;
    this.intervalTimer = null;
    this.intervalMs = config.monitor.intervalMs || 10;
    this.maxHistorySize = 100;
    this.history = [];

    this.latestSnapshot = {
      timestamp: null,
      durationMs: 0,
      isConsistent: true,
      postgresCount: 0,
      mongoCount: 0,
      divergences: [],
      postgresData: [],
      mongoData: [],
    };

    this.stats = {
      totalCycles: 0,
      consistentCycles: 0,
      divergentCycles: 0,
      avgDurationMs: 0,
      maxDurationMs: 0,
      minDurationMs: 999999,
    };
  }

  setInterval(ms) {
    if (ms && ms > 0) {
      this.intervalMs = parseInt(ms, 10);
    }
  }

  start(customIntervalMs) {
    if (customIntervalMs) {
      this.setInterval(customIntervalMs);
    }
    if (this.isRunning) {
      return { message: 'Monitoramento já está em execução.', isRunning: true, intervalMs: this.intervalMs };
    }

    this.isRunning = true;
    console.log(`[MonitorService] Iniciando monitoramento a cada ${this.intervalMs}ms...`);
    this.scheduleNextCycle();

    return { message: 'Monitoramento iniciado com sucesso.', isRunning: true, intervalMs: this.intervalMs };
  }

  stop() {
    this.isRunning = false;
    if (this.intervalTimer) {
      clearTimeout(this.intervalTimer);
      this.intervalTimer = null;
    }
    console.log('[MonitorService] Monitoramento parado.');
    return { message: 'Monitoramento interrompido.', isRunning: false };
  }

  scheduleNextCycle() {
    if (!this.isRunning) return;

    this.intervalTimer = setTimeout(async () => {
      try {
        await this.runCycle();
      } catch (err) {
        console.error('[MonitorService] Erro no ciclo:', err.message);
      } finally {
        if (this.isRunning) {
          this.scheduleNextCycle();
        }
      }
    }, this.intervalMs);
  }

  async runCycle() {
    // Regra 8: Evitar que uma nova consulta comece enquanto a anterior ainda estiver em execução
    if (this.isCycleExecuting) {
      return;
    }

    this.isCycleExecuting = true;
    const startTime = performance.now();
    const cycleTimestamp = new Date().toISOString();

    try {
      // Consulta simultânea das duas bases
      const [pgItemsRaw, mongoItemsRaw] = await Promise.all([
        ProductService.listFromPostgres(),
        ProductService.listFromMongo(),
      ]);

      const endTime = performance.now();
      const durationMs = parseFloat((endTime - startTime).toFixed(2));

      const pgItems = Array.isArray(pgItemsRaw) ? pgItemsRaw : [];
      const mongoItems = Array.isArray(mongoItemsRaw) ? mongoItemsRaw : [];

      // Análise de consistência e divergências
      const divergences = this.compareDatabases(pgItems, mongoItems);
      const isConsistent = divergences.length === 0;

      // Atualiza métricas
      this.stats.totalCycles++;
      if (isConsistent) {
        this.stats.consistentCycles++;
      } else {
        this.stats.divergentCycles++;
      }
      this.stats.maxDurationMs = Math.max(this.stats.maxDurationMs, durationMs);
      this.stats.minDurationMs = Math.min(this.stats.minDurationMs, durationMs);
      this.stats.avgDurationMs = parseFloat(
        ((this.stats.avgDurationMs * (this.stats.totalCycles - 1) + durationMs) / this.stats.totalCycles).toFixed(2)
      );

      // Snapshot atual
      this.latestSnapshot = {
        timestamp: cycleTimestamp,
        durationMs,
        isConsistent,
        postgresCount: pgItems.length,
        mongoCount: mongoItems.length,
        divergences,
        postgresData: pgItems,
        mongoData: mongoItems,
      };

      // Adiciona ao histórico circular
      this.history.unshift({
        timestamp: cycleTimestamp,
        durationMs,
        isConsistent,
        postgresCount: pgItems.length,
        mongoCount: mongoItems.length,
        divergenceCount: divergences.length,
        divergencesSummary: divergences.map(d => d.message),
      });

      if (this.history.length > this.maxHistorySize) {
        this.history.pop();
      }

    } finally {
      this.isCycleExecuting = false;
    }
  }

  compareDatabases(pgItems, mongoItems) {
    const divergences = [];

    const pgMap = new Map(pgItems.map(item => [item.id, item]));
    const mongoMap = new Map(mongoItems.map(item => [item.id, item]));

    // 1. Verifica itens presentes no PG mas ausentes ou diferentes no Mongo
    for (const [id, pgItem] of pgMap.entries()) {
      if (!mongoMap.has(id)) {
        divergences.push({
          id,
          type: 'MISSING_IN_MONGO',
          message: `Registro [${id}] existe no PostgreSQL mas não foi encontrado no MongoDB.`,
          postgres: pgItem,
          mongo: null,
        });
      } else {
        const mongoItem = mongoMap.get(id);
        const fieldDiffs = [];

        if (pgItem.name !== mongoItem.name) {
          fieldDiffs.push(`Nome diverge: PG="${pgItem.name}" vs Mongo="${mongoItem.name}"`);
        }
        if (Math.abs(Number(pgItem.price) - Number(mongoItem.price)) > 0.001) {
          fieldDiffs.push(`Preço diverge: PG=${pgItem.price} vs Mongo=${mongoItem.price}`);
        }
        if (Number(pgItem.stock) !== Number(mongoItem.stock)) {
          fieldDiffs.push(`Estoque diverge: PG=${pgItem.stock} vs Mongo=${mongoItem.stock}`);
        }
        if (pgItem.status !== mongoItem.status) {
          fieldDiffs.push(`Status 2PC diverge: PG="${pgItem.status}" vs Mongo="${mongoItem.status}"`);
        }

        if (fieldDiffs.length > 0) {
          divergences.push({
            id,
            type: 'FIELD_MISMATCH',
            message: `Registro [${id}] possui dados divergentes: ${fieldDiffs.join('; ')}`,
            diffs: fieldDiffs,
            postgres: pgItem,
            mongo: mongoItem,
          });
        }
      }
    }

    // 2. Verifica itens presentes no Mongo mas ausentes no PG
    for (const [id, mongoItem] of mongoMap.entries()) {
      if (!pgMap.has(id)) {
        divergences.push({
          id,
          type: 'MISSING_IN_PG',
          message: `Registro [${id}] existe no MongoDB mas não foi encontrado no PostgreSQL.`,
          postgres: null,
          mongo: mongoItem,
        });
      }
    }

    return divergences;
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      intervalMs: this.intervalMs,
      stats: this.stats,
      latestSnapshot: this.latestSnapshot,
      history: this.history.slice(0, 30),
    };
  }
}

export const monitorService = new MonitorService();
