// Estado local da interface
let isMonitoring = false;
let monitorPollingInterval = null;

// Elementos do DOM
const pgDot = document.getElementById('pg-dot');
const pgStatusText = document.getElementById('pg-status-text');
const mongoDot = document.getElementById('mongo-dot');
const mongoStatusText = document.getElementById('mongo-status-text');
const btnRefreshHealth = document.getElementById('btn-refresh-health');

const alertBanner = document.getElementById('alert-banner');
const alertIcon = document.getElementById('alert-icon');
const alertContent = document.getElementById('alert-content');
const alertClose = document.getElementById('alert-close');

// Formulário Cenários 1 e 2
const prodIdInput = document.getElementById('prod-id');
const prodNameInput = document.getElementById('prod-name');
const prodDescInput = document.getElementById('prod-desc');
const prodPriceInput = document.getElementById('prod-price');
const prodStockInput = document.getElementById('prod-stock');
const simulateFaultSelect = document.getElementById('simulate-fault');
const btnScenario1 = document.getElementById('btn-scenario-1');
const btnScenario2 = document.getElementById('btn-scenario-2');
const btnQuickFill = document.getElementById('btn-quick-fill');

// Painel de Timeline da Transação
const lastTxBadge = document.getElementById('last-tx-badge');
const txEmptyState = document.getElementById('tx-empty-state');
const txDetailsPanel = document.getElementById('tx-details-panel');
const txSummaryId = document.getElementById('tx-summary-id');
const txSummaryDecision = document.getElementById('tx-summary-decision');
const txSummaryPg = document.getElementById('tx-summary-pg');
const txSummaryMongo = document.getElementById('tx-summary-mongo');
const txTimelineList = document.getElementById('tx-timeline-list');

// Cenário 3 - Monitor e Atualização
const monitorIntervalInput = document.getElementById('monitor-interval-input');
const btnStartMonitor = document.getElementById('btn-start-monitor');
const btnStopMonitor = document.getElementById('btn-stop-monitor');

const metricConsistencyBadge = document.getElementById('metric-consistency-badge');
const metricLastCheck = document.getElementById('metric-last-check');
const metricDuration = document.getElementById('metric-duration');
const metricAvgDuration = document.getElementById('metric-avg-duration');
const metricTotalCycles = document.getElementById('metric-total-cycles');
const metricDivergentCount = document.getElementById('metric-divergent-count');
const metricPgCount = document.getElementById('metric-pg-count');
const metricMongoCount = document.getElementById('metric-mongo-count');
const metricCountStatus = document.getElementById('metric-count-status');
const divergenceBox = document.getElementById('divergence-box');
const divergenceList = document.getElementById('divergence-list');

// Atualização do Cenário 3
const upIdInput = document.getElementById('up-id');
const upPriceInput = document.getElementById('up-price');
const upStockInput = document.getElementById('up-stock');
const btnScenario3Update = document.getElementById('btn-scenario-3-update');

// Tabelas e Ações
const tbodyPostgres = document.getElementById('tbody-postgres');
const tbodyMongodb = document.getElementById('tbody-mongodb');
const tbodyTxHistory = document.getElementById('tbody-tx-history');
const btnRefreshTables = document.getElementById('btn-refresh-tables');
const btnRefreshTxLog = document.getElementById('btn-refresh-tx-log');
const btnRecoveryWorker = document.getElementById('btn-recovery-worker');
const btnClearDatabases = document.getElementById('btn-clear-databases');

// ==========================================
// INICIALIZAÇÃO
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  checkHealth();
  refreshTables();
  refreshTransactionHistory();
  checkMonitorStatus();
  generateRandomProduct();

  // Polling de saúde a cada 15 segundos
  setInterval(checkHealth, 15000);
});

// ==========================================
// FUNÇÕES DE ALERTA E FEEDBACK
// ==========================================
function showAlert(message, type = 'info') {
  alertBanner.className = `alert-banner ${type}`;
  alertIcon.textContent = type === 'success' ? '✅' : type === 'danger' ? '❌' : '⚠️';
  alertContent.innerHTML = message;
  alertBanner.classList.remove('hidden');
}

alertClose.addEventListener('click', () => {
  alertBanner.classList.add('hidden');
});

// ==========================================
// 1. CHECAGEM DE SAÚDE DOS BANCOS
// ==========================================
async function checkHealth() {
  try {
    const res = await fetch('/api/health');
    const data = await res.json();

    const pg = data.databases.postgres;
    if (pg.connected) {
      pgDot.className = 'status-indicator status-online';
      pgStatusText.textContent = `Online (${pg.database})`;
    } else {
      pgDot.className = 'status-indicator status-offline';
      pgStatusText.textContent = 'Offline (Verifique .env)';
    }

    const mongo = data.databases.mongodb;
    if (mongo.connected) {
      mongoDot.className = 'status-indicator status-online';
      mongoStatusText.textContent = `Online (${mongo.database})`;
    } else {
      mongoDot.className = 'status-indicator status-offline';
      mongoStatusText.textContent = 'Offline';
    }
  } catch (err) {
    pgDot.className = 'status-indicator status-offline';
    pgStatusText.textContent = 'Servidor inacessível';
    mongoDot.className = 'status-indicator status-offline';
    mongoStatusText.textContent = 'Servidor inacessível';
  }
}

btnRefreshHealth.addEventListener('click', () => {
  checkHealth();
  showAlert('Status de conexões atualizado.', 'info');
});

// ==========================================
// 2. CENÁRIO 1 E 2: EXECUÇÃO 2PC
// ==========================================
btnQuickFill.addEventListener('click', generateRandomProduct);

function generateRandomProduct() {
  const num = Math.floor(100 + Math.random() * 900);
  const items = ['Notebook Dell', 'Monitor Ultrawide', 'Teclado Mecânico', 'Mouse Sem Fio', 'Servidor Rack', 'Switch Gigabit'];
  const chosen = items[Math.floor(Math.random() * items.length)];

  prodIdInput.value = `PRD-${num}`;
  prodNameInput.value = `${chosen} mod.${num}`;
  prodDescInput.value = `Item de teste gerado automaticamente #${num}`;
  prodPriceInput.value = (Math.random() * 800 + 100).toFixed(2);
  prodStockInput.value = Math.floor(Math.random() * 50) + 5;
}

btnScenario1.addEventListener('click', () => executeScenario('/api/transactions/scenario1', 'Cenário 1 (PG primeiro)'));
btnScenario2.addEventListener('click', () => executeScenario('/api/transactions/scenario2', 'Cenário 2 (Mongo primeiro)'));

async function executeScenario(endpoint, scenarioLabel) {
  const payload = {
    id: prodIdInput.value.trim(),
    name: prodNameInput.value.trim(),
    description: prodDescInput.value.trim(),
    price: parseFloat(prodPriceInput.value),
    stock: parseInt(prodStockInput.value, 10),
    simulateFault: simulateFaultSelect.value,
  };

  if (!payload.id || !payload.name || isNaN(payload.price)) {
    showAlert('Preencha os campos obrigatórios (ID, Nome e Preço).', 'warning');
    return;
  }

  showAlert(`Executando ${scenarioLabel} com protocolo 2PC...`, 'info');

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    renderTransactionResult(data);
    refreshTables();
    refreshTransactionHistory();

    if (data.decision === 'COMMITTED') {
      showAlert(`Transação <strong>${data.txId}</strong> efetivada com <strong>COMMIT</strong> nos dois bancos!`, 'success');
      // Preenche o ID no formulário de atualização para facilitar o Cenário 3
      upIdInput.value = payload.id;
      upPriceInput.value = (payload.price * 1.1).toFixed(2);
      upStockInput.value = payload.stock + 10;
    } else {
      showAlert(`Transação <strong>${data.txId}</strong> cancelada com <strong>ABORT</strong>. Motivo: ${data.reason || 'Falha na Fase 1'}`, 'danger');
    }
  } catch (err) {
    showAlert(`Erro ao comunicar com a API: ${err.message}`, 'danger');
  }
}

function renderTransactionResult(result) {
  txEmptyState.classList.add('hidden');
  txDetailsPanel.classList.remove('hidden');

  txSummaryId.textContent = result.txId || '-';
  txSummaryDecision.textContent = result.decision || 'INDEFINIDO';
  txSummaryDecision.className = `badge-decision ${result.decision}`;

  txSummaryPg.textContent = result.states?.postgres || '-';
  txSummaryMongo.textContent = result.states?.mongo || '-';

  lastTxBadge.textContent = `${result.decision} (${result.scenario || '2PC'})`;
  lastTxBadge.className = `badge-status badge-decision ${result.decision}`;

  txTimelineList.innerHTML = '';
  if (Array.isArray(result.timeline)) {
    result.timeline.forEach(item => {
      const el = document.createElement('div');
      let stepClass = 'step-ok';
      if (item.step.includes('ERROR') || item.step.includes('ABORT')) {
        stepClass = 'step-err';
      } else if (item.step.includes('COMPENSATE') || item.step.includes('WARN')) {
        stepClass = 'step-warn';
      }

      const timeStr = item.timestamp ? new Date(item.timestamp).toLocaleTimeString() : '';

      el.className = `timeline-item ${stepClass}`;
      el.innerHTML = `
        <span class="timeline-time">${timeStr}</span>
        <span class="timeline-step">${item.step}</span>
        <span class="timeline-msg">${item.message}</span>
      `;
      txTimelineList.appendChild(el);
    });
  }
}

// ==========================================
// 3. CENÁRIO 3: ATUALIZAÇÃO COORDENADA
// ==========================================
btnScenario3Update.addEventListener('click', async () => {
  const id = upIdInput.value.trim();
  if (!id) {
    showAlert('Informe o ID do produto para atualizar no Cenário 3.', 'warning');
    return;
  }

  const updates = {};
  if (upPriceInput.value) updates.price = parseFloat(upPriceInput.value);
  if (upStockInput.value) updates.stock = parseInt(upStockInput.value, 10);
  updates.simulateFault = simulateFaultSelect.value;

  showAlert(`Executando atualização coordenada 2PC para o produto [${id}]...`, 'info');

  try {
    const res = await fetch(`/api/products/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });

    const data = await res.json();
    renderTransactionResult(data);
    refreshTables();
    refreshTransactionHistory();

    if (data.decision === 'COMMITTED') {
      showAlert(`Produto <strong>${id}</strong> atualizado com sucesso via 2PC nos dois bancos!`, 'success');
    } else {
      showAlert(`Atualização do produto <strong>${id}</strong> sofreu <strong>ABORT</strong> e foi revertida para o snapshot anterior.`, 'danger');
    }
  } catch (err) {
    showAlert(`Erro na atualização coordenada: ${err.message}`, 'danger');
  }
});

// ==========================================
// 4. CENÁRIO 3: SERVIÇO DE MONITORAMENTO (10ms)
// ==========================================
btnStartMonitor.addEventListener('click', async () => {
  const intervalMs = parseInt(monitorIntervalInput.value, 10) || 10;
  try {
    const res = await fetch('/api/monitor/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intervalMs }),
    });
    const data = await res.json();
    isMonitoring = true;
    updateMonitorUIState();
    startMonitorPolling();
    showAlert(`Monitoramento de consistência iniciado a cada ${intervalMs}ms.`, 'success');
  } catch (err) {
    showAlert(`Falha ao iniciar monitor: ${err.message}`, 'danger');
  }
});

btnStopMonitor.addEventListener('click', async () => {
  try {
    const res = await fetch('/api/monitor/stop', { method: 'POST' });
    const data = await res.json();
    isMonitoring = false;
    updateMonitorUIState();
    stopMonitorPolling();
    showAlert('Monitoramento pausado.', 'warning');
  } catch (err) {
    showAlert(`Falha ao parar monitor: ${err.message}`, 'danger');
  }
});

async function checkMonitorStatus() {
  try {
    const res = await fetch('/api/monitor/status');
    const data = await res.json();
    isMonitoring = data.isRunning;
    if (data.intervalMs) {
      monitorIntervalInput.value = data.intervalMs;
    }
    updateMonitorUIState();
    updateMonitorMetrics(data);

    if (isMonitoring && !monitorPollingInterval) {
      startMonitorPolling();
    }
  } catch {}
}

function updateMonitorUIState() {
  if (isMonitoring) {
    btnStartMonitor.classList.add('hidden');
    btnStopMonitor.classList.remove('hidden');
    monitorIntervalInput.disabled = true;
  } else {
    btnStartMonitor.classList.remove('hidden');
    btnStopMonitor.classList.add('hidden');
    monitorIntervalInput.disabled = false;
  }
}

function startMonitorPolling() {
  stopMonitorPolling();
  // Consulta as métricas do monitor no backend a cada 250ms para atualizar o painel visual
  monitorPollingInterval = setInterval(async () => {
    try {
      const res = await fetch('/api/monitor/status');
      const data = await res.json();
      updateMonitorMetrics(data);
    } catch {}
  }, 250);
}

function stopMonitorPolling() {
  if (monitorPollingInterval) {
    clearInterval(monitorPollingInterval);
    monitorPollingInterval = null;
  }
}

function updateMonitorMetrics(data) {
  const snap = data.latestSnapshot || {};
  const stats = data.stats || {};

  // Badge de consistência
  if (snap.isConsistent) {
    metricConsistencyBadge.textContent = 'CONSISTENTE';
    metricConsistencyBadge.className = 'metric-value badge-consistent ok';
  } else {
    metricConsistencyBadge.textContent = 'DIVERGENTE';
    metricConsistencyBadge.className = 'metric-value badge-consistent divergent';
  }

  metricLastCheck.textContent = snap.timestamp
    ? `Última checagem: ${new Date(snap.timestamp).toLocaleTimeString()}`
    : 'Aguardando primeiro ciclo';

  metricDuration.textContent = snap.durationMs ? snap.durationMs.toFixed(2) : '0.00';
  metricAvgDuration.textContent = stats.avgDurationMs ? stats.avgDurationMs.toFixed(2) : '0.00';
  metricTotalCycles.textContent = stats.totalCycles || 0;
  metricDivergentCount.textContent = stats.divergentCycles || 0;

  metricPgCount.textContent = snap.postgresCount || 0;
  metricMongoCount.textContent = snap.mongoCount || 0;

  if (snap.postgresCount === snap.mongoCount) {
    metricCountStatus.textContent = 'Contagem igual';
    metricCountStatus.style.color = '#10b981';
  } else {
    metricCountStatus.textContent = `Diferença de ${Math.abs(snap.postgresCount - snap.mongoCount)} registro(s)`;
    metricCountStatus.style.color = '#ef4444';
  }

  // Lista de divergências
  if (snap.divergences && snap.divergences.length > 0) {
    divergenceBox.classList.remove('hidden');
    divergenceList.innerHTML = '';
    snap.divergences.forEach(div => {
      const li = document.createElement('li');
      li.textContent = div.message;
      divergenceList.appendChild(li);
    });
  } else {
    divergenceBox.classList.add('hidden');
    divergenceList.innerHTML = '';
  }
}

// ==========================================
// 5. TABELAS COMPARATIVAS (POSTGRES VS MONGO)
// ==========================================
btnRefreshTables.addEventListener('click', refreshTables);

async function refreshTables() {
  try {
    const res = await fetch('/api/products');
    const data = await res.json();
    const products = data.products || [];

    // Tabela Postgres
    tbodyPostgres.innerHTML = '';
    const pgRows = products.filter(p => p.postgres !== null).map(p => p.postgres);
    if (pgRows.length === 0) {
      tbodyPostgres.innerHTML = '<tr><td colspan="6" class="text-center">Nenhum registro no PostgreSQL.</td></tr>';
    } else {
      pgRows.forEach(p => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong>${p.id}</strong></td>
          <td>${escapeHtml(p.name)}</td>
          <td>R$ ${Number(p.price).toFixed(2)}</td>
          <td>${p.stock}</td>
          <td><span class="badge-2pc ${p.status}">${p.status}</span></td>
          <td><span class="code-tag">${p.tx_id || '-'}</span></td>
        `;
        tbodyPostgres.appendChild(tr);
      });
    }

    // Tabela MongoDB
    tbodyMongodb.innerHTML = '';
    const mongoRows = products.filter(p => p.mongo !== null).map(p => p.mongo);
    if (mongoRows.length === 0) {
      tbodyMongodb.innerHTML = '<tr><td colspan="6" class="text-center">Nenhum registro no MongoDB.</td></tr>';
    } else {
      mongoRows.forEach(p => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong>${p.id}</strong></td>
          <td>${escapeHtml(p.name)}</td>
          <td>R$ ${Number(p.price).toFixed(2)}</td>
          <td>${p.stock}</td>
          <td><span class="badge-2pc ${p.status}">${p.status}</span></td>
          <td><span class="code-tag">${p.tx_id || '-'}</span></td>
        `;
        tbodyMongodb.appendChild(tr);
      });
    }
  } catch (err) {
    tbodyPostgres.innerHTML = `<tr><td colspan="6" class="text-center" style="color:#ef4444">Erro ao carregar: ${err.message}</td></tr>`;
    tbodyMongodb.innerHTML = `<tr><td colspan="6" class="text-center" style="color:#ef4444">Erro ao carregar: ${err.message}</td></tr>`;
  }
}

// ==========================================
// 6. HISTÓRICO DE TRANSAÇÕES
// ==========================================
btnRefreshTxLog.addEventListener('click', refreshTransactionHistory);

async function refreshTransactionHistory() {
  try {
    const res = await fetch('/api/transactions?limit=25');
    const data = await res.json();
    const list = data.transactions || [];

    tbodyTxHistory.innerHTML = '';
    if (list.length === 0) {
      tbodyTxHistory.innerHTML = '<tr><td colspan="8" class="text-center">Nenhuma transação registrada.</td></tr>';
      return;
    }

    list.forEach(tx => {
      const tr = document.createElement('tr');
      const timeStr = tx.created_at ? new Date(tx.created_at).toLocaleTimeString() : '-';

      tr.innerHTML = `
        <td class="code-tag">${timeStr}</td>
        <td><span class="code-tag">${tx.tx_id}</span></td>
        <td><small>${tx.scenario || '-'}</small></td>
        <td><strong>${tx.operation || '-'}</strong></td>
        <td><span class="badge-decision ${tx.status}">${tx.status}</span></td>
        <td><small>${tx.participant_pg || '-'}</small></td>
        <td><small>${tx.participant_mongo || '-'}</small></td>
        <td><small style="color:${tx.error_message ? '#ef4444' : '#94a3b8'}">${escapeHtml(tx.error_message || 'OK')}</small></td>
      `;
      tbodyTxHistory.appendChild(tr);
    });
  } catch (err) {
    tbodyTxHistory.innerHTML = `<tr><td colspan="8" class="text-center" style="color:#ef4444">Falha ao buscar log: ${err.message}</td></tr>`;
  }
}

// ==========================================
// 7. RECUPERAÇÃO E LIMPEZA
// ==========================================
btnRecoveryWorker.addEventListener('click', async () => {
  showAlert('Disparando rotina de recuperação 2PC para transações pendentes/órfãs...', 'info');
  try {
    const res = await fetch('/api/recovery/run', { method: 'POST' });
    const data = await res.json();
    const rep = data.report;
    showAlert(
      `Recuperação concluída! Recuperadas: ${rep.recoveredTransactions} (Órfãs abortadas: ${rep.abortedOrphans}, Commits concluídos: ${rep.completedCommits})`,
      'success'
    );
    refreshTables();
    refreshTransactionHistory();
  } catch (err) {
    showAlert(`Erro na recuperação: ${err.message}`, 'danger');
  }
});

btnClearDatabases.addEventListener('click', async () => {
  if (!confirm('Deseja realmente limpar todos os produtos e logs de transações em ambas as bases?')) {
    return;
  }
  try {
    const res = await fetch('/api/products', { method: 'DELETE' });
    const data = await res.json();
    showAlert('Bancos de dados esvaziados para novos testes.', 'info');
    refreshTables();
    refreshTransactionHistory();
  } catch (err) {
    showAlert(`Falha ao limpar bancos: ${err.message}`, 'danger');
  }
});

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
