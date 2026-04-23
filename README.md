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
│   │   ├── produtos.json
│   │   ├── biomas.json       # ← NEW: list of biome names for the map editor
│   │   └── climas.json       # ← NEW: list of climate names for the map editor
│   └── world/                # Example mutable world state (CSV + JSON)
│       ├── pessoas.csv
│       ├── empresas.csv
│       ├── estados.csv
│       ├── ativos.csv
│       └── mapa.json         # ← NEW: sparse world map (lat → lon → cell)
├── src/
│   └── core/                 # Browser-safe ESM modules
│       ├── csv.js            # CSV parse / unparse / download
│       ├── world.js          # Row <-> typed-object converters + ativos helpers
│       ├── engine.js         # Monthly tick logic + conversion/injection handlers
│       ├── scheduler.js      # localStorage-based tick scheduler
│       └── map.js            # ← NEW: getCell / setCell / clearCell / findCellsByEstado
├── web/                      # Static web app
│   ├── index.html
│   └── app.js
└── README.md
```

---

## Browser App Usage

1. Open `/web/index.html` via an HTTP server (see above).
2. Click **📂 Carregar Exemplos** to load the bundled example CSVs (including `ativos.csv`), **or** use the file inputs in each tab to upload your own CSVs.
3. Use the **Pessoas / Empresas / Estados** tabs to view and edit entity data in HTML tables. In the **Estados** tab, `tipo` and `parent_id` (hierarchy dropdown) are editable inline; the export validates that no unit is its own parent. Click the **💎** button in any row to edit that entity's assets (ativos) in a modal.
4. Use the **🧭 Mapa** tab to paint the world map (see *Map Editor* section below).
4. Use the **📅 Agendamentos** tab to:
   - Schedule attribute conversions for a specific tick using the checkbox matrix.
   - Schedule one-time financial injections via the injection form.
5. Click **▶ Rodar Tick** to execute one month. The tick counter increments automatically.
6. View the simulation log in the **📋 Log** tab.
7. Click **⬇ Exportar CSVs** to download all four updated CSV files. Use **⬇ Exportar mapa.json** inside the Mapa tab to download the map separately.

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

> **Nota:** O termo "estado" neste projeto não se refere exclusivamente a estados federativos. Um objeto _estado_ representa qualquer **entidade governamental / nível de governo** — município, província, estado, país, reino, principado, ducado, território, etc. Estados podem conter outros estados, formando uma **hierarquia** via `parent_id`.

| Field | Type | Description |
|---|---|---|
| `id` | string | Unique identifier |
| `nome` | string | Government unit name |
| `tipo` | string | Type of government unit (e.g. `municipio`, `provincia`, `estado`, `pais`, `reino`, `principado`). Free-text; may be empty. |
| `parent_id` | string | `id` of the parent government unit (empty = root / no parent). Must refer to an existing `id` if non-empty. Must not equal own `id`. |
| `descricao` | string | Optional free-text description |
| `patrimonio` | number | **Auto-recomputed from ativos sum** |
| `populacao` | integer | Population count |
| `forcas_armadas` | number (1-5) | Military strength |
| `cultura` | number (1-5) | Cultural development level |
| `moral_populacao` | number (1-5) | Population happiness/morale |
| `renda_tributaria` | number | Current tax revenue balance |
| `ir_pf` | decimal (0-1) | Income tax rate for individuals (e.g. `0.15` = 15%) |
| `ir_pj` | decimal (0-1) | Corporate tax rate (e.g. `0.20` = 20%) |
| `imp_prod` | decimal (0-1) | Product tax rate |
| `salarios_politicos` | number | Monthly salary paid to each politician in this unit |
| `incentivos_empresas` | number | Monthly business incentive budget |
| `investimento_cultura` | number | Monthly culture investment budget |
| `investimento_fa` | number | Monthly armed-forces investment budget |

**Hierarchy rules:**
- `parent_id` may be left empty for root-level units (e.g. a sovereign country).
- `parent_id` must refer to an existing `id` in the same file if non-empty.
- A unit may not be its own parent (`parent_id` ≠ `id`). The UI enforces this and the exporter blocks self-parent entries.

**Example hierarchy:**

```
brasil (pais)
├── estado_sp (estado)
│   └── sp_capital (municipio)
└── estado_rj (estado)
```

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

## Map Editor (🧭 Mapa)

### `data/world/mapa.csv`

The world map is stored as a **sparse CSV file** — only cells that have been explicitly painted are written. Missing coordinates (not listed in the CSV) are treated as default water cells with empty metadata.

**Format:** header row followed by one row per non-default cell.

```csv
lat,lon,tipo,estado_id,bioma,clima
10,-50,terra,br_sp,mata_atlantica,tropical
10,-49,terra,br_sp,,
9,-50,agua,br_rj,oceano,tropical
```

**Column schema:**

| Column | Type | Description |
|---|---|---|
| `lat` | integer −90..90 | Latitude of the cell |
| `lon` | integer −180..180 | Longitude of the cell |
| `tipo` | `agua` \| `terra` \| *(empty)* | Cell type. If absent or empty, treated as `agua`. |
| `estado_id` | string | Government unit associated with the cell. Allowed even when `tipo = "agua"` (mar territorial). |
| `bioma` | string | Biome name (from `data/config/biomas.json`). |
| `clima` | string | Climate name (from `data/config/climas.json`). |

**Sparse semantics:**

- Cells **not present** in the CSV → default water (`tipo = "agua"`, no metadata).
- Cells with `tipo` empty → treated as `agua`.
- Duplicate `(lat, lon)` rows → **last row wins**.
- On export, rows that are exactly default water (tipo `agua` with no `estado_id`/`bioma`/`clima`) are **not written**, keeping the file lightweight.
- Water cells that carry metadata (e.g. `estado_id` for mar territorial) **are** written.

### Viewport & Navigation

- **Initial viewport:** 60 columns (longitude) × 30 rows (latitude).
- **Center controls:** `lat` and `lon` number inputs set the visible centre.
- **Pan buttons (↑↓←→):** shift the viewport 10° at a time.
- **Zoom (+ / −):** expands or shrinks the viewport by 10 lon columns and 5 lat rows per step, keeping the centre fixed.
- **Coordinate rulers:** longitude values appear across the top (every 10°), latitude values along the left (every 5°).

### Brush Painting

1. Select cell properties in the **🖌 Pincel** panel (tipo, estado, bioma, clima).
2. Use the **checkboxes** next to each field to lock/unlock which fields the brush applies.  
   ✅ **Checked = locked** → that field will be written when painting.  
   ⬜ **Unchecked** → that field is untouched when painting over existing cells.
3. **Click and drag** over cells to paint them with the current brush.
4. Enable **🧹 Borracha** to erase cells (removes the cell from the map entirely).

### Cell Editor

Click a single cell (without dragging) to open the **📍 Célula** editor panel. It shows the current values for that cell and allows individual field edits. Press **✔ Salvar** to commit or **🗑 Limpar** to remove the cell entirely.

### Config Lists

| File | Purpose |
|---|---|
| `data/config/biomas.json` | Array of biome name strings shown in the Bioma select |
| `data/config/climas.json` | Array of climate name strings shown in the Clima select |

Edit these files to add or remove options without changing any code.

### Import / Export

- **📂 Importar** (toolbar): load a `mapa.csv` file from disk, replacing the current map. Invalid rows (out-of-range lat/lon) are ignored; the status bar reports counts of imported and ignored rows.
- **⬇ Exportar mapa.csv** (toolbar): download the current map as `mapa.csv`. Only non-default-water cells are written, keeping the file sparse and lightweight.

### Deletion Validation

Deleting a government unit (Estado) is **blocked** if any map cell has `estado_id` referencing it — on land *or* water. The status bar will report the number of cells and a sample of their coordinates `(lat, lon)`.

---

## JSON Config Files

| File | Purpose |
|---|---|
| `classes.json` | Class definitions with attribute limits and monthly costs |
| `atributos.json` | Attribute metadata and renda-to-point conversion rates |
| `conversoes.json` | Rules for converting between attributes (including class bonuses) |
| `fluxos_economicos.json` | Descriptive list of economic flows (documentation reference) |
| `produtos.json` | Purchasable goods and their attribute effects |
| `biomas.json` | Biome names available in the Map editor |
| `climas.json` | Climate names available in the Map editor |

---

## Known Limitations

- **CSV parser** (`src/core/csv.js`) does **not** support fields containing commas or newlines. Keep all CSV values simple.
- Scheduler state (scheduled conversions and injections) is persisted in `localStorage`. Clearing browser storage will lose pending schedules.
- The engine does not yet model product purchases, inventories, or inter-state migration.
- Attribute conversion rates for Pessoas use class-specific overrides from `conversoes.json` automatically; class bonus rules in `conversoes_especiais_por_classe` are applied when matching.
