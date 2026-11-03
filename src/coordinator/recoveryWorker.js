import { listRecentTransactions, logTransactionUpdate } from './transactionLog.js';
import { TransactionState, ParticipantState, ScenarioType, OperationType } from './stateMachine.js';
import { TwoPhaseCoordinator } from './twoPhaseCoordinator.js';

export class RecoveryWorker {
  static async runRecovery() {
    const report = {
      timestamp: new Date().toISOString(),
      recoveredTransactions: 0,
      abortedOrphans: 0,
      completedCommits: 0,
      details: [],
    };

    const recent = await listRecentTransactions(100);
    const now = Date.now();

    for (const tx of recent) {
      const createdAt = new Date(tx.created_at).getTime();
      const ageMs = now - createdAt;

      // 1. Caso PREPARING orfã (> 10 segundos):
      // Coordenador caiu antes de persistir a decisão de COMMIT -> Regra do 2PC: abortar e compensar
      if (tx.status === TransactionState.PREPARING && ageMs > 10000) {
        report.abortedOrphans++;
        const detail = {
          txId: tx.tx_id,
          action: 'ABORT_ORPHAN_PREPARE',
          reason: `Transação estagnada em PREPARING por ${Math.round(ageMs / 1000)}s`,
        };

        const productId = tx.payload?.id;
        if (productId) {
          if (tx.participant_pg === ParticipantState.PREPARED) {
            await TwoPhaseCoordinator.rollbackPostgresInsert(productId, tx.tx_id).catch(() => {});
          }
          if (tx.participant_mongo === ParticipantState.PREPARED) {
            await TwoPhaseCoordinator.rollbackMongoInsert(productId, tx.tx_id).catch(() => {});
          }
        }

        await logTransactionUpdate(tx.tx_id, {
          status: TransactionState.ABORTED,
          participant_pg: ParticipantState.ABORTED,
          participant_mongo: ParticipantState.ABORTED,
          error_message: 'Recuperado por timeout no RecoveryWorker (Rollback preventivo)',
        });

        report.details.push(detail);
        report.recoveredTransactions++;
      }

      // 2. Caso COMMITTED com participante pendente (falha parcial na Fase 2):
      // Decisão foi COMMIT, então recovery deve forçar a efetivação no participante que faltou
      else if (tx.status === TransactionState.COMMITTED) {
        const pgNeedsCommit = tx.participant_pg !== ParticipantState.COMMITTED;
        const mongoNeedsCommit = tx.participant_mongo !== ParticipantState.COMMITTED;

        if (pgNeedsCommit || mongoNeedsCommit) {
          const detail = {
            txId: tx.tx_id,
            action: 'RETRY_COMMIT',
            pgUpdated: false,
            mongoUpdated: false,
          };

          const productId = tx.payload?.id;
          if (productId) {
            if (pgNeedsCommit) {
              await TwoPhaseCoordinator.commitPostgres(productId, tx.tx_id).catch(() => {});
              await logTransactionUpdate(tx.tx_id, { participant_pg: ParticipantState.COMMITTED });
              detail.pgUpdated = true;
            }
            if (mongoNeedsCommit) {
              await TwoPhaseCoordinator.commitMongo(productId, tx.tx_id).catch(() => {});
              await logTransactionUpdate(tx.tx_id, { participant_mongo: ParticipantState.COMMITTED });
              detail.mongoUpdated = true;
            }
          }

          report.completedCommits++;
          report.details.push(detail);
          report.recoveredTransactions++;
        }
      }
    }

    return report;
  }
}
