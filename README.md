# The Matchday Tales — Mini Economic Model Manager

A browser-based simulation manager for a mini economic model. Load CSV world data, run monthly ticks and export updated CSVs — all without a backend.

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
│       └── estados.csv
├── src/
│   └── core/                 # Browser-safe ESM modules
│       ├── csv.js            # CSV parse / unparse / download
│       ├── world.js          # Row <-> typed-object converters
│       └── engine.js         # Monthly tick logic
├── web/                      # Static web app
│   ├── index.html
│   └── app.js
└── README.md
```

---

## Browser App Usage

1. Open `/web/index.html` via an HTTP server (see above).
2. Click **📂 Carregar exemplos padrão** to load the bundled example CSVs, **or** use the file inputs in each card to upload your own CSVs.
3. Optionally edit the CSV content directly in the textareas.
4. Click **▶ Rodar Tick Mensal** to simulate one month. The textareas will update with the new values and the log panel will show what happened.
5. Click **⬇ Exportar CSVs** to download the three updated CSV files.

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
| `patrimonio` | integer (1-5) | Wealth attribute |
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

---

## Monthly Tick Logic

Each tick performs the following steps in order:

1. **Renda → Caixa & IRPF** — Each pessoa receives `renda_mensal * (1 - ir_pf)` in their `caixa`. The IRPF portion goes to `estado.renda_tributaria` (matched via `pessoa.estado_id`).
2. **IRPJ** — Each empresa pays `lucro * ir_pj` to its state's `renda_tributaria`.
3. **Dividendos** — 30% of the post-IRPJ `lucro` is credited to the company owner's `caixa`.
4. **Gastos de classe** — Each pessoa pays class-specific monthly costs from `caixa`. If cash is insufficient, the corresponding attribute drops by 1 point (clamped to class minimum).
5. **Salários políticos** — Each politician (`classe == 'politico'`) receives `estado.salarios_politicos` from their state's `renda_tributaria`.
6. **Investimento cultura & FA** — The state deducts `investimento_cultura + investimento_fa` from `renda_tributaria` and increases `cultura`, `forcas_armadas`, and `moral_populacao` accordingly.

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

- **CSV parser** (`src/core/csv.js`) does **not** support fields containing commas or newlines. Keep all CSV values simple. See `parseCsv` in `src/core/csv.js` for details.
- There is no authentication or persistence — all state lives in the browser textareas between ticks.
- The engine does not yet model product purchases, inventories, or inter-state migration.
