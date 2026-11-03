export const TransactionState = {
  PREPARING: 'PREPARING',
  COMMITTED: 'COMMITTED',
  ABORTED: 'ABORTED',
  FAILED: 'FAILED',
};

export const ParticipantState = {
  NOT_STARTED: 'NOT_STARTED',
  PREPARED: 'PREPARED',
  COMMITTED: 'COMMITTED',
  ABORTED: 'ABORTED',
  FAILED: 'FAILED',
};

export const OperationType = {
  INSERT: 'INSERT',
  UPDATE: 'UPDATE',
};

export const ScenarioType = {
  SCENARIO_1_PG_FIRST: 'SCENARIO_1_PG_FIRST',
  SCENARIO_2_MONGO_FIRST: 'SCENARIO_2_MONGO_FIRST',
  SCENARIO_3_UPDATE: 'SCENARIO_3_UPDATE',
};

export const FaultType = {
  NONE: 'none',
  POSTGRES_PREPARE: 'postgres_prepare',
  MONGO_PREPARE: 'mongo_prepare',
  BEFORE_COMMIT: 'before_commit',
  POSTGRES_COMMIT: 'postgres_commit',
  MONGO_COMMIT: 'mongo_commit',
};
