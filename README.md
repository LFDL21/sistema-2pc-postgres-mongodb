# Sistema de Persistência Distribuída com PostgreSQL, MongoDB e Protocolo 2PC Coordenado pela Aplicação

Projeto acadêmico de **Sistemas Distribuídos** que demonstra a coordenação de operações de persistência distribuída heterogênea entre **PostgreSQL** (relacional ACID) e **MongoDB** (orientado a documentos), utilizando uma máquina de estados do protocolo **Two-Phase Commit (2PC)** implementada e coordenada diretamente no nível da aplicação.

---

## 1. Visão Geral e Objetivo

Em arquiteturas distribuídas modernas, frequentemente coexistem bancos de dados relacionais e não-relacionais. Garantir atomicidade e consistência entre sistemas heterogêneos é um desafio clássico:
- O PostgreSQL suporta transações locais ACID e transações preparadas (`PREPARE TRANSACTION`), porém não possui barramento nativo compartilhado com o MongoDB.
- O MongoDB não implementa primitivas preparadas XA nem participa de gerenciadores de transação distribuída tradicionais.

Este projeto implementa um **Coordenador 2PC no nível da aplicação (Application-Coordinated 2PC / Try-Confirm-Cancel)**, capaz de coordenar operações em dois bancos distintos com persistência de intenções, identificadores globais de transação (`tx_id`), registros provisórios com status `PENDING`, efetivação simultânea (`COMMIT`) ou operações compensatórias de rollback (`ABORT`).

---

## 2. Tecnologias Utilizadas

- **Runtime:** Node.js LTS (v20+ / v25+)
- **Servidor Web:** Express.js 4.x
- **PostgreSQL:** Driver oficial `pg` com pool de conexões e consultas parametrizadas
- **MongoDB:** Driver oficial `mongodb` 6.x
- **Frontend:** HTML5, CSS3 moderno e JavaScript puro (Vanilla JS, sem frameworks ou bundlers pesados)
- **Testes Automatizados:** Vitest (execução veloz e nativa para ESM)
- **Ambiente:** Execução direta no Windows (sem necessidade de Docker, WSL ou máquinas virtuais)

---

## 3. Arquitetura do Sistema

```
                   +---------------------------------------------+
                   |       Dashboard Web (HTML / CSS / JS)       |
                   +---------------------------------------------+
                                         │  (HTTP / REST)
                                         ▼
                   +---------------------------------------------+
                   |           Express.js API Routes             |
                   +---------------------------------------------+
                                         │
                                         ▼
            +───────────────────────────────────────────────────────────+
            │               Coordenador 2PC (Aplicação)                 │
            │  - Máquina de Estados (PREPARING, COMMITTED, ABORTED)     │
            │  - Injeção de Falhas Simuladas Previsíveis                │
            │  - Worker de Recuperação de Transações Órfãs              │
            +───────────────────────────────────────────────────────────+
                      │                                       │
         (Fase 1: Prepare / Fase 2: Commit)      (Fase 1: Prepare / Fase 2: Commit)
                      │                                       │
                      ▼                                       ▼
       +──────────────────────────────+       +──────────────────────────────+
       |     PostgreSQL (Port 5432)   |       |     MongoDB (Port 27017)     |
       |  - Tabela: products          |       |  - Coleção: products         |
       |  - Tabela: coordinator_txs   |       |  - Coleção: coordinator_txs  |
       +──────────────────────────────+       +──────────────────────────────+
                      ▲                                       ▲
                      └───────────── Monitor 10ms ────────────┘
                              (Detecção de Divergências)
```

---

## 4. Estrutura de Pastas

```
sistema-2pc-postgres-mongodb/
├── .env.example              # Modelo de configuração de ambiente
├── .gitignore                # Proteção de credenciais e dependências
├── package.json              # Metadados e scripts npm
├── README.md                 # Documentação técnica e guia de execução
├── docs/
│   └── relatorio.md          # Relatório acadêmico completo para entrega
├── public/                   # Dashboard frontend em Vanilla JS
│   ├── index.html            # Estrutura visual em português
│   ├── style.css             # Tema moderno escuro e responsivo
│   └── app.js                # Lógica de integração e polling do monitor
├── src/
│   ├── server.js             # Ponto de entrada do servidor Express
│   ├── config/
│   │   └── env.js            # Carregamento seguro das variáveis de ambiente
│   ├── database/
│   │   ├── postgres.js       # Pool do PostgreSQL com queries parametrizadas
│   │   ├── mongo.js          # Conexão e coleções MongoDB
│   │   └── init.js           # Inicialização de tabelas e coleções
│   ├── coordinator/
│   │   ├── stateMachine.js   # Definição de estados e tipos de falha
│   │   ├── transactionLog.js # Log persistente de transações e auditoria
│   │   ├── twoPhaseCoordinator.js # Orquestração do 2PC (Cenários 1, 2 e 3)
│   │   └── recoveryWorker.js # Recuperação e resolução de transações órfãs
│   ├── services/
│   │   ├── productService.js # Consultas e consolidação de produtos
│   │   └── monitorService.js # Serviço independente de monitoramento (10ms)
│   ├── routes/
│   │   ├── healthRoutes.js   # Verificação de status dos bancos
│   │   ├── transactionRoutes.js # Endpoints dos cenários 1 e 2
│   │   ├── productRoutes.js  # Endpoints de produtos e Cenário 3
│   │   └── monitorRoutes.js  # Início, pausa e métricas do monitor
│   └── middleware/
│       ├── validation.js     # Validação de payloads e sanitização
│       └── errorHandler.js   # Middleware global de erros
└── tests/
    ├── coordinator.test.js   # Testes unitários do fluxo 2PC e rollbacks
    ├── monitor.test.js       # Testes da detecção de divergências
    └── validation.test.js    # Testes de validação de dados
```

---

## 5. Pré-requisitos e Instalação em Qualquer Computador (Windows)

Este projeto foi projetado para ser **100% reproduzível** em qualquer computador Windows com os bancos instalados localmente, sem depender de Docker ou máquinas virtuais.

### 5.1. Pré-requisitos de Software

1. **Node.js LTS (v20+ ou superior):**
   - Baixe e instale o instalador oficial para Windows em: [https://nodejs.org/](https://nodejs.org/)
   - Verifique a instalação no PowerShell:
     ```powershell
     node -v
     npm -v
     ```

2. **PostgreSQL (v14+ ou superior):**
   - Baixe o instalador oficial para Windows em: [https://www.postgresql.org/download/windows/](https://www.postgresql.org/download/windows/)
   - Durante a instalação, defina uma senha para o superusuário padrão `postgres` e mantenha a porta padrão `5432`.
   - **Criação do Banco de Dados:** Abra o **pgAdmin** (ou o terminal `psql`) e crie o banco de dados `sistema_2pc`:
     ```sql
     CREATE DATABASE sistema_2pc;
     ```

3. **MongoDB Community Server (v6+ ou superior):**
   - Baixe o instalador para Windows em: [https://www.mongodb.com/try/download/community](https://www.mongodb.com/try/download/community)
   - Na instalação, marque a opção recomendada: **"Run MongoDB as a Service"** (executa na porta padrão `27017` sem autenticação inicial no ambiente local).
   - Opcional: Instale o **MongoDB Compass** para inspeção visual dos documentos.
   - *Nota:* O MongoDB criará o banco `sistema_2pc` e suas coleções automaticamente na primeira operação.

---

### 5.2. Clonando o Repositório e Instalando Dependências

1. Abra o terminal (PowerShell ou Git Bash) e clone o repositório:
   ```powershell
   git clone https://github.com/LFDL21/sistema-2pc-postgres-mongodb.git
   cd sistema-2pc-postgres-mongodb
   ```

2. Instale todas as dependências declaradas no `package.json`:
   ```powershell
   npm install
   ```

---

## 6. Configuração do Ambiente (`.env`)

O projeto lê as configurações a partir do arquivo `.env` na raiz. Um modelo de exemplo seguro [`.env.example`](file:///.env.example) é fornecido no repositório.

1. **Crie o arquivo `.env` copiando o modelo de exemplo:**
   ```powershell
   Copy-Item .env.example .env
   # No Linux/Mac/Git Bash: cp .env.example .env
   ```

2. **Edite o arquivo `.env` e insira a senha do seu PostgreSQL local:**
   ```env
   PORT=3000
   POSTGRES_HOST=127.0.0.1
   POSTGRES_PORT=5432
   POSTGRES_DB=sistema_2pc
   POSTGRES_USER=postgres
   POSTGRES_PASSWORD=SUA_SENHA_AQUI
   MONGO_URI=mongodb://127.0.0.1:27017/sistema_2pc
   MONITOR_INTERVAL_MS=10
   ```

> [!IMPORTANT]
> O arquivo `.env` está configurado no `.gitignore` e **nunca** deve ser enviado ao GitHub para garantir a segurança de suas credenciais locais.

---

## 7. Inicialização Automática e Execução da Aplicação

### 7.1. Criação Automática do Schema nos Bancos
O projeto **cria automaticamente** todas as tabelas (`products`, `coordinator_transactions`) e índices no PostgreSQL e as coleções e índices no MongoDB logo na primeira inicialização da aplicação (`npm start`).

Caso deseje criar/verificar os bancos de dados explicitamente antes de iniciar o servidor web, execute:
```powershell
npm run db:init
```

### 7.2. Iniciar a Aplicação

- **Modo Padrão / Produção:**
  ```powershell
  npm start
  ```

- **Modo Desenvolvimento (com recarregamento automático ao editar arquivos):**
  ```powershell
  npm run dev
  ```

Após iniciar, acesse o dashboard no navegador:
👉 **[http://localhost:3000](http://localhost:3000)**

---

## 8. Execução dos Testes Automatizados

Para executar os testes automatizados com o **Vitest**:
```powershell
npm test
```

Para executar em modo contínuo (watch):
```powershell
npm run test:watch
```

Os testes unitários validam a máquina de estados, o algoritmo de compensação de falhas e a detecção de divergências do monitor sem depender de conexões externas.

---

## 9. Como Testar os Três Cenários no Dashboard

### Cenário 1 — PostgreSQL Primeiro (Inserção)
1. No dashboard, preencha o formulário (ou clique no botão **"🎲 Gerar Dados"**).
2. Deixe o campo **"Simular Falha Controlada"** em **"Nenhuma (Fluxo Normal)"**.
3. Clique em **"▶ Executar Cenário 1 (PG primeiro)"**.
4. **Resultado esperado:**
   - O PostgreSQL recebe o registro com `status: 'PENDING'`.
   - O MongoDB recebe o registro com `status: 'PENDING'`.
   - Decisão tomada: **COMMIT**.
   - Ambos os bancos são efetivados para `status: 'COMMITTED'`.
   - A linha do tempo exibe todas as etapas bem-sucedidas.
5. **Teste com Falha Simulada:**
   - Mude o seletor para **"Falha na gravação do MongoDB (Phase 1)"**.
   - Clique novamente em **"Executar Cenário 1"**.
   - **Resultado esperado:** O PostgreSQL grava como pendente, mas a gravação do MongoDB falha. O coordenador toma a decisão **ABORT**, executa a operação compensatória removendo o registro pendente do PostgreSQL, mantendo o sistema em estado consistente.

---

### Cenário 2 — MongoDB Primeiro (Inserção)
1. Gere novos dados ou preencha o formulário com um novo ID (ex: `PRD-202`).
2. Clique em **"▶ Executar Cenário 2 (Mongo primeiro)"**.
3. **Resultado esperado:** O MongoDB prepara primeiro (`PENDING`), depois o PostgreSQL prepara (`PENDING`). Ambos recebem `COMMIT`.
4. **Teste com Falha Simulada:**
   - Selecione a opção **"Falha na gravação do PostgreSQL (Phase 1)"**.
   - Clique em **"Executar Cenário 2"**.
   - **Resultado esperado:** O MongoDB é gravado como pendente, mas o PostgreSQL falha. A decisão é **ABORT**, disparando a compensação que remove o registro provisório do MongoDB.

---

### Cenário 3 — Atualização Coordenada e Monitoramento Contínuo (10ms)
1. **Iniciar o Monitor:**
   - Na seção **"3. Cenário 3"**, clique em **"▶ Iniciar Monitor"**.
   - O serviço independente no backend executará consultas às duas bases a cada **10 milissegundos**.
   - O dashboard exibirá a contagem de ciclos em tempo real, a duração média de cada consulta (em ms) e o badge **CONSISTENTE**.
   - **Controle de sobreposição:** O backend utiliza trava de execução (`isCycleExecuting`), garantindo que uma nova consulta nunca inicie se a anterior ainda estiver em processamento.
2. **Atualização Coordenada:**
   - No painel **"Atualizar Registro com Coordenação 2PC"**, digite o ID de um produto existente (ex: `PRD-101`), novo preço e novo estoque.
   - Clique em **"🔄 Atualizar Coordenado"**.
   - O sistema realiza um snapshot do estado anterior de ambos os bancos, aplica `PENDING_UPDATE` e finaliza com `COMMIT`.
   - Caso selecione uma falha simulada (ex: **"Falha antes do COMMIT"**), a operação é cancelada e ambos os bancos são restaurados para os valores do snapshot.

---

## 10. Limitações Técnicas da Coordenação de 2PC pela Aplicação

1. **Ausência de Primitiva de Bloqueio Compartilhada (XA):** O MongoDB não implementa locks distribuídos de transações preparadas a nível de nó compatíveis com o PostgreSQL. O sistema utiliza consistência em nível de aplicação com status provisórios (`PENDING`).
2. **Ponto Único de Falha do Coordenador (SPOF):** Se o processo da aplicação falhar catastroficamente no milissegundo exato entre o prepare e a escrita do log de decisão, as transações ficam pendentes até a atuação do **Recovery Worker** (`/api/recovery/run`), garantindo consistência eventual ao invés de consistência estrita imediata.
3. **Isolamento de Leitura (Dirty Reads):** Como os dados são persistidos provisoriamente com status `PENDING` para garantir que o disco foi atingido antes do commit, leituras que não filtrem por `status = 'COMMITTED'` podem observar estados não confirmados temporariamente.
