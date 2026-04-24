# The Matchday Tales — Mini Economic Model Manager

A browser-based simulation manager for a mini economic model. Load world data, run monthly ticks, schedule conversions & financial injections, and export the database — all without a backend.

---

## How to Run Locally

> **Important:** The app uses ES Modules (`import`/`export`), `fetch()` for JSON configs, and loads **sql.js** (SQLite via WebAssembly) from a CDN. These APIs require an HTTP server **and an internet connection** — opening `index.html` directly via `file://` will **not** work.

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

## Storage: SQLite (sql.js)

The app uses [sql.js](https://sql.js.org/) — SQLite compiled to WebAssembly — as its primary storage engine:

- **Auto-save:** After every mutation (cell edit, tick, adding/editing entities), the world is automatically saved to a SQLite database in `localStorage`. **Data survives page refreshes.**
- **Export DB:** Click **💾 Exportar DB** to download a `world.db` binary file (standard SQLite format, openable with any SQLite tool).
- **Import DB:** Click **📥 Importar DB** to load a `.db` file back into the app.
- **CSV import (legacy):** The CSV file inputs in each tab are still supported for migrating existing data; imported data is immediately persisted to the SQLite database.
- **CSV export (legacy):** The **⬇ CSVs** button downloads separate CSV files for backward compatibility.

### SQLite Schema

| Table | Primary key | Key columns |
|---|---|---|
| `pessoas` | `id` | nome, classe, estado_id, influencia, patrimonio, moral, reputacao, renda_mensal, caixa, gastos_* |
| `empresas` | `id` | nome, dono_id, estado_id, patrimonio, funcionarios, renda, producao, moral_corporativa, reputacao_corporativa, lucro, custos_* |
| `estados` | `id` | nome, patrimonio, populacao, forcas_armadas, cultura, moral_populacao, impostos_*, financas_* |
| `ativos` | `(owner_type, owner_id, ativo_id)` | valor |

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
│   └── world/                # Example world data (CSV — used by "Carregar Exemplos")
│       ├── pessoas.csv
│       ├── empresas.csv
│       ├── estados.csv
│       └── ativos.csv
├── src/
│   └── core/                 # Browser-safe ESM modules
│       ├── csv.js            # CSV parse / unparse / download
│       ├── world.js          # Row <-> typed-object converters + ativos helpers
│       ├── engine.js         # Monthly tick logic + conversion/injection handlers
│       ├── scheduler.js      # localStorage-based tick scheduler
│       └── db.js             # SQLite persistence layer (sql.js wrapper)
├── web/                      # Static web app
│   ├── index.html
│   └── app.js
└── README.md
```

---

## Browser App Usage

1. Open `/web/index.html` via an HTTP server (see above).
2. On first load, click **📂 Carregar Exemplos** to seed the database with example data, **or** use the **📥 Importar DB** button to load an existing `world.db`, **or** use the CSV file inputs in each tab.
3. Use the **Pessoas / Empresas / Estados** tabs to view and edit entity data. Click the **💎** button in any row to edit that entity's assets (ativos) in a modal. All changes are **auto-saved** to the SQLite database.
4. Use the **➕ Nova Pessoa / Empresa / Estado** buttons to add new entities via a form.
5. Use the **📅 Agendamentos** tab to schedule attribute conversions and one-time financial injections.
6. Click **▶ Rodar Tick** to execute one month. The tick counter increments automatically.
7. View the simulation log in the **📋 Log** tab.
8. Click **💾 Exportar DB** to download the full database as `world.db`.

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

- **Internet required at startup** for sql.js to load from CDN. The WASM binary (`sql-wasm.wasm`, ~1 MB) is fetched from `cdnjs.cloudflare.com`. For fully offline use, download the file and update `locateFile` in `src/core/db.js`.
- **localStorage size limit** (~5–10 MB depending on browser). For large worlds, use **Exportar DB** to back up the `.db` file regularly.
- **CSV parser** (`src/core/csv.js`) does **not** support fields containing commas or newlines. Keep all CSV values simple.
- Scheduler state (scheduled conversions and injections) is persisted in `localStorage`. Clearing browser storage will lose pending schedules.
- The engine does not yet model product purchases, inventories, or inter-state migration.


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


