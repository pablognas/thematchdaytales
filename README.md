# The Matchday Tales — Mini Economic Model Manager

A browser-based simulation manager for a mini economic model. Load CSV world data, run monthly ticks, schedule conversions & financial injections, and export updated CSVs — all without a backend.

---

## How to Run Locally

> **Important:** The app uses ES Modules (`import`/`export`) and `fetch()` for JSON configs and default CSVs. These APIs require an HTTP server — opening `index.html` directly via `file://` will **not** work due to browser CORS restrictions.

### Option 1 — Python (built-in, no install needed)

```bash
# From the repository root:
python -m http.server 8000
```

Then open [http://localhost:8000/web/index.html](http://localhost:8000/web/index.html).

### Option 2 — Node.js `serve`

```bash
npx serve .
```

Then open the URL shown in the terminal and navigate to `/web/index.html`.

### Option 3 — VS Code Live Server

Install the **Live Server** extension, right-click `web/index.html` → *Open with Live Server*.

---

## Directory Structure

```
thematchdaytales/
├── data/
│   ├── config/               # Static JSON configuration (read-only at runtime)
│   │   ├── classes.json
│   │   ├── atributos.json
│   │   ├── conversoes.json
│   │   ├── fluxos_economicos.json
│   │   └── produtos.json
│   └── world/                # Example mutable world state (CSV)
│       ├── pessoas.csv
│       ├── empresas.csv
│       ├── estados.csv
│       └── ativos.csv        # ← NEW: assets for all entity types
├── src/
│   └── core/                 # Browser-safe ESM modules
│       ├── csv.js            # CSV parse / unparse / download
│       ├── world.js          # Row <-> typed-object converters + ativos helpers
│       ├── engine.js         # Monthly tick logic + conversion/injection handlers
│       └── scheduler.js      # ← NEW: localStorage-based tick scheduler
├── web/                      # Static web app
│   ├── index.html
│   └── app.js
└── README.md
```

---

## Browser App Usage

1. Open `/web/index.html` via an HTTP server (see above).
2. Click **📂 Carregar Exemplos** to load the bundled example CSVs (including `ativos.csv`), **or** use the file inputs in each tab to upload your own CSVs.
3. Use the **Pessoas / Empresas / Estados** tabs to view and edit entity data in HTML tables. Click the **💎** button in any row to edit that entity's assets (ativos) in a modal.
4. Use the **📅 Agendamentos** tab to:
   - Schedule attribute conversions for a specific tick using the checkbox matrix.
   - Schedule one-time financial injections via the injection form.
5. Click **▶ Rodar Tick** to execute one month. The tick counter increments automatically.
6. View the simulation log in the **📋 Log** tab.
7. Click **⬇ Exportar CSVs** to download all four updated CSV files.

---

## CSV Schemas

### `pessoas.csv`

| Field | Type | Description |
|---|---|---|
| `id` | string | Unique identifier |
| `nome` | string | Display name |
| `classe` | string | One of: `trabalhador`, `empresario`, `politico`, `jogador` |
| `estado_id` | string | ID of the person's home state (used for IRPF and salary) |
| `influencia` | integer (1-5) | Influence attribute |
| `patrimonio` | integer (1-5) | Wealth attribute — **auto-recomputed from ativos sum** |
| `moral` | integer (1-5) | Public morality attribute |
| `reputacao` | integer (1-5) | Reputation attribute |
| `renda_mensal` | number | Monthly income (before IRPF) |
| `caixa` | number | Current cash balance |
| `gastos_influencia` | 0 or 1 | Whether the monthly influence cost is paid (0 = skip, attribute decays) |
| `gastos_moral` | 0 or 1 | Whether the monthly moral cost is paid |
| `gastos_reputacao` | 0 or 1 | Whether the monthly reputation cost is paid |

### `empresas.csv`

| Field | Type | Description |
|---|---|---|
| `id` | string | Unique identifier |
| `nome` | string | Company name |
| `dono_id` | string | `id` of the owning pessoa |
| `estado_id` | string | State where the company operates (used for IRPJ) |
| `patrimonio` | number | **NEW** Total net worth — auto-recomputed from ativos sum |
| `funcionarios` | integer | Number of employees |
| `renda` | number | Gross revenue |
| `producao` | number | Production units |
| `moral_corporativa` | integer (1-5) | Internal morale |
| `reputacao_corporativa` | integer (1-5) | Public reputation |
| `lucro` | number | Monthly profit (before IRPJ) |
| `salario_funcionario` | number | Per-employee salary |
| `manutencao` | number | Monthly maintenance costs |
| `insumos` | number | Monthly input costs |

### `estados.csv`

| Field | Type | Description |
|---|---|---|
| `id` | string | Unique identifier |
| `nome` | string | State name |
| `patrimonio` | number | **NEW** Total state wealth — auto-recomputed from ativos sum |
| `populacao` | integer | Population count |
| `forcas_armadas` | number (1-5) | Military strength |
| `cultura` | number (1-5) | Cultural development level |
| `moral_populacao` | number (1-5) | Population happiness/morale |
| `renda_tributaria` | number | Current tax revenue balance |
| `ir_pf` | decimal (0-1) | Income tax rate for individuals (e.g. `0.15` = 15%) |
| `ir_pj` | decimal (0-1) | Corporate tax rate (e.g. `0.20` = 20%) |
| `imp_prod` | decimal (0-1) | Product tax rate |
| `salarios_politicos` | number | Monthly salary paid to each politician in this state |
| `incentivos_empresas` | number | Monthly business incentive budget |
| `investimento_cultura` | number | Monthly culture investment budget |
| `investimento_fa` | number | Monthly armed-forces investment budget |

### `ativos.csv` (NEW)

Stores assets for all entity types in a flat, normalized format.

| Field | Type | Description |
|---|---|---|
| `owner_type` | string | One of: `pessoa`, `empresa`, `estado` |
| `owner_id` | string | `id` of the owning entity |
| `ativo_id` | string | Asset identifier (e.g. `imoveis`, `investimentos`) |
| `valor` | number | Asset value (can be negative for debts) |

**Constraint:** The sum of all `valor` entries for a given `(owner_type, owner_id)` equals the entity's `patrimonio`. When `ativos.csv` is loaded via `applyAtivos()`, `patrimonio` is automatically recomputed.

**Bootstrap:** If an entity has no entry in `ativos.csv`, its `ativos` defaults to `{ patrimonio_geral: <patrimonio> }`.

---

## Monthly Tick Logic

Each tick performs the following steps **in order**:

0. **Scheduled conversions** (`applyScheduledConversions`) — apply attribute/asset conversions registered for this tick via the Agendamentos UI. One-time: cleared after execution.
1. **Scheduled injections** (`applyScheduledInjections`) — apply one-time cash injections registered for this tick. Injections credit `caixa` (pessoas), `lucro` (empresas), or `renda_tributaria` (estados). One-time: cleared after execution.
2. **Renda → Caixa & IRPF** — Each pessoa receives `renda_mensal * (1 - ir_pf)` in their `caixa`. The IRPF portion goes to `estado.renda_tributaria`.
3. **IRPJ** — Each empresa pays `lucro * ir_pj` to its state's `renda_tributaria`.
4. **Dividendos** — 30% of the post-IRPJ `lucro` is credited to the company owner's `caixa`.
5. **Gastos de classe** — Each pessoa pays class-specific monthly costs from `caixa`. If cash is insufficient, the corresponding attribute drops by 1 point (clamped to class minimum).
6. **Salários políticos** — Each politician (`classe == 'politico'`) receives `estado.salarios_politicos` from their state's `renda_tributaria`.
7. **Investimento cultura & FA** — The state deducts `investimento_cultura + investimento_fa` from `renda_tributaria` and increases `cultura`, `forcas_armadas`, and `moral_populacao` accordingly.

---

## Scheduling & Injections

### Conversion matrix

1. Go to **📅 Agendamentos** → **Conversões Agendadas**.
2. Set the **Tick alvo** (target tick number).
3. Select the entity type (Pessoas / Empresas / Estados).
4. Check the boxes for the conversions you want applied when that tick runs.
5. Conversions are stored in `localStorage` and cleared automatically after execution.

**Available conversions:**

| Entity | Conversion ID | Effect |
|---|---|---|
| Pessoa | `influencia:reputacao` | -1 influência → +0.5 reputação (taxa from config) |
| Pessoa | `reputacao:influencia` | -1 reputação → +0.5 influência |
| Pessoa | `moral:reputacao` | -1 moral → +0.7 reputação |
| Pessoa | `reputacao:moral` | -1 reputação → +0.7 moral |
| Pessoa | `patrimonio:influencia` | -1 patrimônio → +0.3 influência |
| Pessoa | `influencia:patrimonio` | -1 influência → +0.2 patrimônio |
| Empresa | `lucro_para_patrimonio` | 50% of lucro transferred to patrimônio |
| Empresa | `lucro_para_moral` | 10% of lucro → +0.1 moral corporativa |
| Empresa | `lucro_para_reputacao` | 10% of lucro → +0.1 reputação corporativa |
| Estado | `renda_para_cultura` | Deducts `investimento_cultura` → increases `cultura` |
| Estado | `renda_para_fa` | Deducts `investimento_fa` → increases `forcas_armadas` |
| Estado | `renda_para_moral_pop` | 10% of renda → +0.1 moral popular |

### Financial injections (aportes esporádicos)

1. Go to **📅 Agendamentos** → **Aportes Esporádicos**.
2. Select entity type, specific entity, amount, and target tick.
3. Click **+ Agendar**.
4. The injection is applied automatically when that tick runs, then removed.

---

## JSON Config Files

| File | Purpose |
|---|---|
| `classes.json` | Class definitions with attribute limits and monthly costs |
| `atributos.json` | Attribute metadata and renda-to-point conversion rates |
| `conversoes.json` | Rules for converting between attributes (including class bonuses) |
| `fluxos_economicos.json` | Descriptive list of economic flows (documentation reference) |
| `produtos.json` | Purchasable goods and their attribute effects |

---

## Known Limitations

- **CSV parser** (`src/core/csv.js`) does **not** support fields containing commas or newlines. Keep all CSV values simple.
- Scheduler state (scheduled conversions and injections) is persisted in `localStorage`. Clearing browser storage will lose pending schedules.
- The engine does not yet model product purchases, inventories, or inter-state migration.
- Attribute conversion rates for Pessoas use class-specific overrides from `conversoes.json` automatically; class bonus rules in `conversoes_especiais_por_classe` are applied when matching.
