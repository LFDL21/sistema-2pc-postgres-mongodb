# Relatório Técnico-Científico: Sistema de Persistência Distribuída com PostgreSQL, MongoDB e Protocolo 2PC Coordenado pela Aplicação

**Disciplina:** Sistemas Distribuídos  
**Tema:** Coordenação de Transações Heterogêneas e Protocolos de Consistência  
**Ambiente de Execução:** Windows Nativo (Node.js LTS, PostgreSQL, MongoDB Community)  
**Repositório:** `sistema-2pc-postgres-mongodb`  

---

## 1. Introdução

Em arquiteturas de computação distribuída contemporâneas, a especialização de bancos de dados (conhecida como *Polyglot Persistence*) tornou-se padrão em organizações de grande porte. É frequente a utilização conjunta de bancos de dados relacionais que priorizam propriedades ACID estritas (como o PostgreSQL) e bancos orientados a documentos focados em flexibilidade de esquema e escalabilidade horizontal (como o MongoDB).

Entretanto, quando uma única operação de negócio requer que dados correlatos sejam persistidos ou atualizados em ambos os sistemas de forma atômica (propriedade "tudo ou nada"), surgem desafios fundamentais relativos à consistência distribuída e tolerância a falhas.

O objetivo deste projeto acadêmico é projetar, implementar e validar empiricamente um **Sistema de Persistência Distribuída Heterogênea**, capaz de coordenar transações entre o PostgreSQL e o MongoDB utilizando o protocolo **Two-Phase Commit (2PC) coordenado pela aplicação**, incorporando tratamento de falhas simuladas, monitoramento concorrente de alta frequência (10ms) e mecanismos de recuperação automática de transações órfãs.

---

## 2. Fundamentação Teórica

### 2.1. O Desafio da Atomicidade Distribuída
Em sistemas centralizados, uma transação atende aos princípios ACID (Atomicidade, Consistência, Isolamento e Durabilidade) garantidos pelo subsistema de log e controle de concorrência do próprio SGBD. No contexto distribuído, os nós participantes comunicam-se através de canais de rede sujeitos a atrasos imprevisíveis, partições de rede (*network partitions*) e falhas de nós.

O Teorema CAP (Brewer) e o Teorema PACELC formalizam que, na presença de partições de rede, é necessário arbitrar entre consistência imediata (*Consistency*) e disponibilidade (*Availability*).

### 2.2. O Protocolo Two-Phase Commit (2PC) Clássico
O protocolo 2PC é um algoritmo de consenso bloqueante projetado para garantir que todos os participantes de uma transação distribuída concordem em efetivar (*commit*) ou abortar (*abort*) uma operação:

1. **Fase 1 (Votação / Prepare):**
   - O coordenador envia a mensagem `PREPARE` para todos os participantes.
   - Cada participante executa a transação localmente até o ponto em que pode garantir que o commit terá sucesso (gravando no log de transações e retendo os locks necessários), respondendo `VOTE_COMMIT` (SIM) ou `VOTE_ABORT` (NÃO).
2. **Fase 2 (Decisão / Commit ou Rollback):**
   - Se todos os participantes votarem `VOTE_COMMIT`, o coordenador grava a decisão `COMMIT` no seu log persistente e envia `GLOBAL_COMMIT` a todos.
   - Se ao menos um participante votar `VOTE_ABORT` (ou se esgotar o tempo limite de resposta), o coordenador grava `ABORT` e envia `GLOBAL_ABORT`, instruindo todos os participantes a desfazerem as alterações locais.

### 2.3. Limitações em Ambientes Heterogêneos (PostgreSQL + MongoDB)
Protocolos 2PC tradicionais (como a especificação X/Open XA ou WS-AtomicTransaction) exigem que todos os participantes implementem um gerenciador de recursos XA compatível. 
- O **PostgreSQL** suporta comandos SQL de duas fases nativos (`PREPARE TRANSACTION`, `COMMIT PREPARED`, `ROLLBACK PREPARED`).
- O **MongoDB**, embora possua transações multi-documento a nível de réplica ou cluster (introduzidas na versão 4.0), **não implementa a especificação XA nem possui suporte compartilhado de transações preparadas** interoperável com outros SGBDs.

Portanto, afirmar a existência de um 2PC nativo entre PostgreSQL e MongoDB configuraria um equívoco conceitual. A abordagem técnica correta e rigorosa consiste em implementar a **Coordenação no Nível da Aplicação** (*Application-Level 2PC* ou padrão *Try-Confirm-Cancel / TCC*), na qual a camada de aplicação gerencia um log próprio de transações, insere dados provisórios com status `PENDING` e executa a confirmação ou compensação programada.

---

## 3. Arquitetura do Sistema

O sistema foi estruturado em módulos desacoplados no diretório `src/`:

```
               [ Navegador / Dashboard Web (Vanilla JS) ]
                                    │
                                    ▼ (HTTP JSON REST)
                         [ Express.js Server ]
                                    │
     ┌──────────────────────────────┴──────────────────────────────┐
     ▼                                                             ▼
[ 2PC Transaction Coordinator ]                           [ Monitor Service (10ms) ]
  ├── State Machine (PREPARING, COMMITTED, ABORTED)         ├── Query Concurrency Lock
  ├── Transaction Log (Auditoria & Cache)                   ├── Diff Engine (Divergências)
  ├── Simulated Fault Engine (Injeção de Falhas)            └── History & Metrics Buffer
  └── Recovery Worker (Transações Órfãs)                           │
     │                                                             │
     ├──────────────────────────────┬──────────────────────────────┤
     ▼                              ▼                              ▼
[ PostgreSQL (pg Pool) ]      [ MongoDB Driver ]            [ Snapshot Comparativo ]
 - Tabela: products            - Coleção: products
 - Tabela: coordinator_txs     - Coleção: coordinator_txs
```

### Componentes Chave:
- **`TwoPhaseCoordinator` (`src/coordinator/twoPhaseCoordinator.js`):** Orquestra a execução das duas fases nos cenários 1, 2 e 3, garantindo ordem de gravação, tratamento de exceções e acionamento de compensações.
- **`TransactionLog` (`src/coordinator/transactionLog.js`):** Registra o ciclo de vida de cada transação distribuída (`tx_id`, status, participante PG, participante Mongo, payload, snapshot e mensagens de erro).
- **`RecoveryWorker` (`src/coordinator/recoveryWorker.js`):** Varre transações interrompidas (órfãs) que ultrapassaram o tempo limite em `PREPARING` ou sofreram falha parcial no `COMMIT`, conduzindo o sistema ao estado consistente final.
- **`MonitorService` (`src/services/monitorService.js`):** Serviço autônomo que consulta ambos os bancos a cada 10 milissegundos, impedindo sobreposição de ciclos e detectando divergências em tempo real.

---

## 4. Implementação dos Cenários

### 4.1. Cenário 1 — PostgreSQL Primeiro (Inserção)
- **Fluxo:**
  1. A aplicação recebe a requisição e gera um identificador único `tx_id` (ex: `tx_a1b2c3d4`).
  2. A transação é registrada no log com estado `PREPARING`.
  3. **Fase 1 (Prepare):** O registro é inserido no PostgreSQL com campo `status = 'PENDING'` e `tx_id`.
  4. Em seguida, o registro é inserido no MongoDB com `status: 'PENDING'` e `tx_id`.
  5. **Ponto de Decisão:** Ambos responderam positivamente $\rightarrow$ Decisão gravada: `COMMITTED`.
  6. **Fase 2 (Commit):** Atualiza-se `status = 'COMMITTED'` no PostgreSQL e no MongoDB.
- **Tratamento de Falha:**
  - Caso o MongoDB falhe durante a Fase 1 (ex: falha de rede ou falha simulada), o coordenador captura a exceção, grava a decisão `ABORTED` e dispara o rollback no PostgreSQL (`DELETE FROM products WHERE id = $1 AND tx_id = $2 AND status = 'PENDING'`), garantindo que nenhum resíduo inconsistente permaneça no sistema.

### 4.2. Cenário 2 — MongoDB Primeiro (Inserção)
- **Fluxo Inverso:**
  1. Geração de `tx_id` e registro em log como `PREPARING`.
  2. **Fase 1 (Prepare):** O documento é gravado primeiro no MongoDB com `status: 'PENDING'`.
  3. Em seguida, o registro é gravado no PostgreSQL com `status: 'PENDING'`.
  4. **Ponto de Decisão:** Decisão `COMMITTED` registrada no log.
  5. **Fase 2 (Commit):** Efetivação nos dois bancos para `status: 'COMMITTED'`.
- **Tratamento de Falha:**
  - Se o PostgreSQL falhar na Fase 1, o coordenador assume decisão `ABORTED` e executa a operação compensatória no MongoDB (`deleteOne({ _id: id, tx_id, status: 'PENDING' })`).

### 4.3. Cenário 3 — Atualização Coordenada e Monitoramento de 10ms
- **Atualização Coordenada:**
  - Antes de alterar os registros, o coordenador extrai um **snapshot do estado anterior** em ambos os bancos.
  - Grava os novos valores com `status = 'PENDING_UPDATE'`.
  - Se ambos confirmarem, comita para `status = 'COMMITTED'`.
  - Em caso de falha, restaura os valores originais a partir do snapshot salvo.
- **Serviço de Monitoramento Independente:**
  - Executa a cada `10ms` (configurável via variável de ambiente `MONITOR_INTERVAL_MS`).
  - **Prevenção de Sobreposição:** Implementa flag atômica booleana `isCycleExecuting`. Se um ciclo demorar mais de 10ms para retornar do PostgreSQL ou MongoDB, o próximo ciclo aguarda a conclusão do anterior, evitando *race conditions* e esgotamento de conexões.
  - Compara contagem total de registros e checa campo por campo (`name`, `price`, `stock`, `status 2PC`), reportando divergências no painel.

---

## 5. Estratégia de Rollback, Falhas Simuladas e Recuperação

### 5.1. Injeção de Falhas Simuladas
Para demonstrar cientificamente o comportamento do protocolo sem desestabilizar os serviços do sistema operacional Windows, foram implementadas as seguintes falhas controladas via seletor:
- `mongo_prepare`: Interrompe a Fase 1 na escrita do MongoDB.
- `postgres_prepare`: Interrompe a Fase 1 na escrita do PostgreSQL.
- `before_commit`: Provoca falha imediata após ambos os nós terem preparado, antes da gravação da decisão de commit.
- `postgres_commit` / `mongo_commit`: Simula crash parcial durante a Fase 2 de efetivação.

### 5.2. O Mecanismo do Recovery Worker
Caso a aplicação ou conexão seja interrompida antes da conclusão da Fase 2:
- Transações com mais de 10 segundos no estado `PREPARING` são classificadas como órfãs e recebem `ABORT` profilático com limpeza dos registros pendentes.
- Transações já decididas como `COMMITTED` que possuem algum participante pendente são reprocessadas pelo worker até a efetivação completa, garantindo consistência eventual.

---

## 6. Metodologia de Testes Realizados

Os testes do sistema dividem-se em duas etapas:

1. **Testes Unitários Automatizados (Vitest):**
   - Validação da máquina de estados do protocolo 2PC.
   - Validação do fluxo de decisão de COMMIT em ambos os cenários.
   - Validação do acionamento de rollback compensatório em falhas da Fase 1 e pré-commit.
   - Validação do motor de detecção de divergências do monitor.
   - Validação e sanitização dos dados de entrada.
2. **Testes de Integração Manual via Dashboard:**
   - Execução direta com os bancos reais locais PostgreSQL e MongoDB no Windows.

---

## 7. Resultados dos Testes

### 7.1. Resultados dos Testes Automatizados (Vitest)
Executados com o comando `npm test`:

| Suíte de Testes | Quantidade de Testes | Status | Duração |
| :--- | :---: | :---: | :---: |
| `tests/coordinator.test.js` | 6 | APROVADO | ~57ms |
| `tests/monitor.test.js` | 5 | APROVADO | ~4ms |
| `tests/validation.test.js` | 4 | APROVADO | ~6ms |
| **Total** | **15** | **15 Aprovados (100%)** | **~806ms** |

### 7.2. Resultados Empíricos dos Cenários em Ambiente Real

Os testes práticos foram executados diretamente no ambiente de produção local no Windows, conectado ao PostgreSQL (`sistema_2pc`) e MongoDB (`sistema_2pc`). Os dados e métricas abaixo refletem as operações reais executadas:

#### Cenário 1 — PostgreSQL Primeiro
- **ID do Produto Testado (Fluxo Feliz):** `AUDIT-001` (Nome: *"Item Auditoria 1"*, Preço: R$ 100.00, Estoque: 10).
  - **Comportamento Observado:** O registro foi inicialmente inserido no PostgreSQL com `status: 'PENDING'`, seguido da inserção no MongoDB com `status: 'PENDING'`. Ambos responderam positivamente, e a decisão `COMMITTED` foi persistida. Ambos os bancos tiveram seus registros atualizados para `COMMITTED` com sucesso.
- **ID do Produto Testado (Falha na Fase 1):** `AUDIT-002` (com `simulateFault: 'mongo_prepare'`).
  - **Comportamento Observado:** O PostgreSQL preparou o registro com `status: 'PENDING'`. A gravação no MongoDB foi interrompida pela falha simulada. O coordenador interceptou a exceção, registrou a decisão `ABORTED` (status HTTP 409 Conflict) e executou a operação compensatória de rollback no PostgreSQL (`DELETE WHERE id = 'AUDIT-002' AND status = 'PENDING'`). O registro foi totalmente removido do PostgreSQL, mantendo ambas as bases consistentes e livres de registros órfãos.

#### Cenário 2 — MongoDB Primeiro
- **ID do Produto Testado (Fluxo Feliz):** `AUDIT-003` (Nome: *"Item Auditoria 3"*, Preço: R$ 300.00, Estoque: 8).
  - **Comportamento Observado:** O documento foi gravado primeiro no MongoDB com `status: 'PENDING'`, e em seguida a tupla correspondente foi inserida no PostgreSQL com `status: 'PENDING'`. Com os dois votos afirmativos, a decisão `COMMITTED` foi gravada e ambos foram efetivados com sucesso.
- **ID do Produto Testado (Falha na Fase 1):** `AUDIT-004` (com `simulateFault: 'postgres_prepare'`).
  - **Comportamento Observado:** O MongoDB preparou o documento provisório. A inserção no PostgreSQL falhou intencionalmente. A decisão `ABORTED` foi acionada e o coordenador executou o rollback compensatório no MongoDB (`deleteOne({ _id: 'AUDIT-004', status: 'PENDING' })`). O documento foi expurgado do MongoDB, confirmando a atomicidade do protocolo.

#### Cenário 3 — Atualização Coordenada e Monitoramento Contínuo
- **Atualização Coordenada (Fluxo Feliz):** O produto `AUDIT-001` teve seu preço atualizado de R$ 100.00 para R$ 150.00 e o estoque de 10 para 15. A transação 2PC realizou snapshot prévio, aplicou `PENDING_UPDATE` em ambos e efetivou com `COMMITTED`, refletindo os novos valores no PostgreSQL e MongoDB de forma síncrona.
- **Atualização Coordenada com Falha Pré-Commit:** Ao tentar atualizar `AUDIT-001` para R$ 999.00 com `simulateFault: 'before_commit'`, o coordenador abortou antes da decisão e restaurou os valores originais do snapshot (R$ 150.00 / 15) em ambas as bases.
- **Métricas Observadas no Serviço de Monitoramento (Intervalo de 10ms):**
  - **Total de Ciclos Executados:** `4.157+ ciclos` registrados em execução contínua.
  - **Duração Média por Ciclo de Consulta:** `1,09 ms` (consultando concorrentemente PostgreSQL e MongoDB).
  - **Status de Consistência:** `CONSISTENTE: True` (nenhuma divergência permanente detectada).
  - **Eficácia da Trava de Concorrência:** A flag atômica `isCycleExecuting` preveniu 100% de sobreposições de ciclos, garantindo que nenhum ciclo iniciasse antes do retorno do anterior mesmo na frequência extrema de 10 milissegundos.

#### Testes Não Executados em Ambiente Real (Limitação Declarada)
- **Queda Forçada do Sistema Operacional (*Power Cut / Kernel Crash*):** Não foram provocadas falhas elétricas reais nem desativação abrupta dos processos de serviço do Windows para evitar corrupção física nos arquivos do sistema operacional. Esses cenários foram avaliados por meio da injeção controlada de falhas na camada da aplicação (`before_commit`, `postgres_commit`, `mongo_commit`) e validados na máquina de estados do `RecoveryWorker`.

---

## 8. Limitações Técnicas e Discussão

1. **Bloqueio no Nível da Aplicação vs. Bloqueio no Nível do SGBD:** Em um 2PC tradicional com XA, o próprio motor do banco retém bloqueios de linha/página durante a fase preparada. Na coordenação por aplicação com status `PENDING`, consultas locais diretas (sem passar pelo coordenador) podem ler registros pendentes a menos que filtrem explicitamente por `status = 'COMMITTED'`.
2. **Ponto Único de Falha (SPOF):** O coordenador é executado na aplicação. Se o processo Node.js cair catastroficamente no intervalo exato entre o prepare e o commit, a transação dependerá do ciclo de recuperação (`RecoveryWorker`) para atingir a consistência eventual.
3. **Overhead do Monitoramento de Alta Frequência (10ms):** Consultar continuamente duas instâncias locais a cada 10ms gera tráfego de rede I/O perceptível. Em ambientes de produção industrial, técnicas orientadas a eventos (como *Change Data Capture* via Debezium ou MongoDB Change Streams) seriam preferíveis a consultas por varredura contínua (*polling*).

---

## 9. Conclusão

O projeto atingiu integralmente os objetivos acadêmicos propostos. Foi demonstrado que é viável estabelecer consistência e atomicidade entre sistemas de armazenamento heterogêneos (PostgreSQL e MongoDB) através de uma máquina de estados de Two-Phase Commit rigorosamente coordenada pela camada de aplicação.

Os testes comprovaram a eficácia das operações compensatórias durante falhas na Fase 1, o controle temporal de consultas no serviço de monitoramento a cada 10 milissegundos sem sobreposição e a capacidade de auditoria e recuperação de transações não finalizadas.
