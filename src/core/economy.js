/**
 * economy.js — Economic simulation module.
 *
 * Simulates how many companies should exist in a state based on:
 *   - Population size
 *   - Economic state: 'recessao' | 'estagnacao' | 'crescimento'
 *     (legacy aliases 'estavel' / 'instavel' still accepted for backward compatibility)
 *   - Stochastic crises that occasionally reduce companies, followed by recovery
 *   - Company segments (público-alvo / target market)
 *
 * Public API:
 *   simulateEconomy(params)           — run a macro simulation and return series + metadata
 *   simulateEconomyBySegment(params)  — run per-segment simulation with demand dynamics
 *
 * Entity status constants (exported):
 *   STATUS_ECONOMICO  — RECESSAO | ESTAGNACAO | CRESCIMENTO
 *
 * Company sector constants (exported):
 *   SETOR_ECONOMICO   — AGRICOLA | INDUSTRIAL | SERVICOS
 *
 * Segment constants (exported):
 *   PUBLICO_ALVO   — POPULACAO | EMPRESAS | ESTADO
 *   TIPO_BEM       — DURAVEL | NAO_DURAVEL  (applicable to POPULACAO only)
 *   SEGMENTO       — compound segment keys: POP_NAO_DURAVEL | POP_DURAVEL | B2B | ESTADO
 *   SEGMENTO_META  — display label + publicoAlvo + tipoBem per segment
 *
 * Consumption rules:
 *   - Pessoas (POPULACAO) consume from companies of ALL setores econômicos.
 *   - Empresas can also consume from companies of other setores econômicos (B2B).
 *
 * Backup format reference (for import/export):
 *   { version: 1, type: 'simulation_result', stateId, params, result }
 */

// ── Economic status & sector enums ────────────────────────────────────────────

/**
 * Discrete economic status for pessoa, empresa, and estado entities.
 * @readonly
 */
export const STATUS_ECONOMICO = Object.freeze({
  /** Economic recession — activity contracting, high unemployment. */
  RECESSAO:   'recessao',
  /** Economic stagnation — flat activity, low growth. */
  ESTAGNACAO: 'estagnacao',
  /** Economic growth — expanding activity, rising employment. */
  CRESCIMENTO: 'crescimento',
});

/**
 * Economic sector for empresa entities.
 * Pessoas consume from companies of ALL setores.
 * Empresas may also consume from companies of other setores (B2B).
 * @readonly
 */
export const SETOR_ECONOMICO = Object.freeze({
  /** Primary sector — agriculture, farming, fishing, mining. */
  AGRICOLA:   'agricola',
  /** Secondary sector — manufacturing, construction, industry. */
  INDUSTRIAL: 'industrial',
  /** Tertiary sector — trade, finance, services, technology. */
  SERVICOS:   'servicos',
});

// ── Segment constants ─────────────────────────────────────────────────────────

/**
 * Target-market categories for companies.
 * @readonly
 */
export const PUBLICO_ALVO = Object.freeze({
  /** Companies selling to the general population (final consumers). */
  POPULACAO: 'POPULACAO',
  /** B2B — companies selling inputs/services to other companies. */
  EMPRESAS:  'EMPRESAS',
  /** Companies selling to the government / public sector. */
  ESTADO:    'ESTADO',
});

/**
 * Type of consumer goods — applicable only when publicoAlvo === POPULACAO.
 * @readonly
 */
export const TIPO_BEM = Object.freeze({
  /** Durable goods: long replacement cycle, subject to depreciation (e.g. appliances, furniture). */
  DURAVEL:     'DURAVEL',
  /** Non-durable goods: consumed every period (e.g. food, personal care, paper). */
  NAO_DURAVEL: 'NAO_DURAVEL',
});

/**
 * Compound company segments combining PUBLICO_ALVO and TIPO_BEM where relevant.
 * These values are the valid `segmento` strings for an Empresa entity.
 * @readonly
 */
export const SEGMENTO = Object.freeze({
  /** Population / non-durable goods (food, cosmetics, etc.). */
  POP_NAO_DURAVEL: 'POP_NAO_DURAVEL',
  /** Population / durable goods (appliances, furniture, etc.). */
  POP_DURAVEL:     'POP_DURAVEL',
  /** B2B — inputs and services for other companies. */
  B2B:             'B2B',
  /** State / government procurement. */
  ESTADO:          'ESTADO',
  /** Sports club / football club entity. */
  CLUBE:           'CLUBE',
});

/**
 * Display metadata per segment.
 * @readonly
 */
export const SEGMENTO_META = Object.freeze({
  [SEGMENTO.POP_NAO_DURAVEL]: Object.freeze({
    label:       'Pop. Não Durável',
    publicoAlvo: PUBLICO_ALVO.POPULACAO,
    tipoBem:     TIPO_BEM.NAO_DURAVEL,
  }),
  [SEGMENTO.POP_DURAVEL]: Object.freeze({
    label:       'Pop. Durável',
    publicoAlvo: PUBLICO_ALVO.POPULACAO,
    tipoBem:     TIPO_BEM.DURAVEL,
  }),
  [SEGMENTO.B2B]: Object.freeze({
    label:       'B2B (Insumos)',
    publicoAlvo: PUBLICO_ALVO.EMPRESAS,
    tipoBem:     null,
  }),
  [SEGMENTO.ESTADO]: Object.freeze({
    label:       'Estado/Governo',
    publicoAlvo: PUBLICO_ALVO.ESTADO,
    tipoBem:     null,
  }),
  [SEGMENTO.CLUBE]: Object.freeze({
    label:       'Clube',
    publicoAlvo: PUBLICO_ALVO.POPULACAO,
    tipoBem:     null,
  }),
});

/**
 * Default share of total companies belonging to each segment (sums to 1.0).
 * Can be overridden via the `shares` parameter of simulateEconomyBySegment().
 */
const DEFAULT_SEGMENTO_SHARES = Object.freeze({
  [SEGMENTO.POP_NAO_DURAVEL]: 0.40,
  [SEGMENTO.POP_DURAVEL]:     0.20,
  [SEGMENTO.B2B]:             0.30,
  [SEGMENTO.ESTADO]:          0.10,
  [SEGMENTO.CLUBE]:           0.00,
});

// ── Constants ─────────────────────────────────────────────────────────────────

/** Default population-to-company ratio (companies ≈ population / K). */
const DEFAULT_K = 1000;

/** Parameters per economic state. */
const ECONOMIC_PARAMS = {
  // ── Simplified three-state model ──────────────────────────────────────────
  recessao: {
    crisisProb:       0.25,   // 25% chance of crisis per step
    crisisMinShock:   0.20,   // minimum multiplicative reduction (20%)
    crisisMaxShock:   0.50,   // maximum multiplicative reduction (50%)
    recoveryStepsMin: 8,      // minimum steps to recover after crisis
    recoveryStepsMax: 16,
    growthRate:       0.002,  // very slow recovery growth (0.2%)
  },
  estagnacao: {
    crisisProb:       0.12,   // 12% chance of crisis per step
    crisisMinShock:   0.10,   // minimum multiplicative reduction (10%)
    crisisMaxShock:   0.25,   // maximum multiplicative reduction (25%)
    recoveryStepsMin: 4,      // minimum steps to recover after crisis
    recoveryStepsMax: 8,
    growthRate:       0.010,  // stagnant growth (1.0%)
  },
  crescimento: {
    crisisProb:       0.04,   // 4% chance of crisis per step
    crisisMinShock:   0.05,   // minimum multiplicative reduction (5%)
    crisisMaxShock:   0.12,   // maximum multiplicative reduction (12%)
    recoveryStepsMin: 2,      // minimum steps to recover after crisis
    recoveryStepsMax: 5,
    growthRate:       0.030,  // strong growth rate (3.0%)
  },
  // ── Legacy aliases (backward compatibility) ───────────────────────────────
  estavel: {
    crisisProb:       0.05,   // 5% chance of crisis per step
    crisisMinShock:   0.05,   // minimum multiplicative reduction (5%)
    crisisMaxShock:   0.15,   // maximum multiplicative reduction (15%)
    recoveryStepsMin: 3,      // minimum steps to recover after crisis
    recoveryStepsMax: 6,
    growthRate:       0.02,   // monthly company growth rate (2%)
  },
  instavel: {
    crisisProb:       0.20,   // 20% chance of crisis per step
    crisisMinShock:   0.15,   // minimum multiplicative reduction (15%)
    crisisMaxShock:   0.40,   // maximum multiplicative reduction (40%)
    recoveryStepsMin: 6,      // minimum steps to recover after crisis
    recoveryStepsMax: 12,
    growthRate:       0.005,  // slower growth rate (0.5%)
  },
};

// ── Seeded PRNG ───────────────────────────────────────────────────────────────

/**
 * Mulberry32 seeded pseudo-random number generator.
 * Returns a function that produces numbers in [0, 1).
 * @param {number} seed  Integer seed (default: derived from Date.now())
 * @returns {() => number}
 */
function createPrng(seed) {
  let s = (seed >>> 0) || (Date.now() & 0xFFFFFFFF);
  return function () {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Core simulation ───────────────────────────────────────────────────────────

/**
 * Run an economic simulation for a single state.
 *
 * @param {Object} params
 * @param {string}  [params.stateId]       Identifier of the state (for reference)
 * @param {number}   params.population     Population count (> 0)
 * @param {string}  [params.economicState] 'estavel' | 'instavel' (default: 'estavel')
 * @param {number}  [params.seed]          Integer seed for reproducibility
 * @param {number}  [params.steps]         Number of simulation steps / months (default: 60)
 * @param {number}  [params.k]             Population-to-company ratio (default: 1000)
 *
 * @returns {{
 *   targetCompanies: number,
 *   series: Array<{
 *     step: number,
 *     companies: number,
 *     crisis: boolean,
 *     crisisShock: number,
 *     recovering: boolean,
 *   }>,
 *   meta: {
 *     crisisProb: number,
 *     crisisMinShock: number,
 *     crisisMaxShock: number,
 *     avgRecoverySteps: number,
 *     baseCompanies: number,
 *     totalCrises: number,
 *     finalCompanies: number,
 *   }
 * }}
 */
export function simulateEconomy({
  stateId       = '',
  population    = 0,
  economicState = 'estavel',
  seed          = undefined,
  steps         = 60,
  k             = DEFAULT_K,
} = {}) {
  if (!Number.isFinite(population) || population < 0) {
    throw new RangeError('population must be a non-negative finite number');
  }
  if (steps < 1 || !Number.isInteger(steps)) {
    throw new RangeError('steps must be a positive integer');
  }
  if (k <= 0 || !Number.isFinite(k)) {
    throw new RangeError('k must be a positive finite number');
  }

  const econKey = Object.prototype.hasOwnProperty.call(ECONOMIC_PARAMS, economicState)
    ? economicState
    : 'estavel';
  const p = ECONOMIC_PARAMS[econKey];

  const rng = createPrng(seed);

  // Base number of companies proportional to population
  const baseCompanies = Math.max(1, Math.round(population / k));

  let companies       = baseCompanies;
  let recoveryLeft    = 0;          // steps remaining in recovery phase
  let recoveryTarget  = baseCompanies;
  let totalCrises     = 0;

  const series = [];

  for (let step = 1; step <= steps; step++) {
    let crisis      = false;
    let crisisShock = 0;
    let recovering  = recoveryLeft > 0;

    // ── Crisis event ──────────────────────────────────────────────────────────
    if (recoveryLeft === 0 && rng() < p.crisisProb) {
      crisis = true;
      totalCrises++;

      // Shock: random multiplicative reduction
      crisisShock = p.crisisMinShock + rng() * (p.crisisMaxShock - p.crisisMinShock);
      companies   = Math.max(1, Math.round(companies * (1 - crisisShock)));

      // Set up recovery
      const rSteps    = p.recoveryStepsMin +
        Math.floor(rng() * (p.recoveryStepsMax - p.recoveryStepsMin + 1));
      recoveryLeft    = rSteps;
      recoveryTarget  = Math.max(companies, Math.round(population / k));
      recovering      = true;
    }

    // ── Recovery / growth phase ───────────────────────────────────────────────
    if (!crisis) {
      if (recoveryLeft > 0) {
        // Linear recovery toward target
        const gap          = recoveryTarget - companies;
        const recoveryStep = Math.ceil(gap / recoveryLeft);
        companies          = Math.min(recoveryTarget, companies + recoveryStep);
        recoveryLeft--;
        if (recoveryLeft === 0) recovering = false;
      } else {
        // Normal organic growth toward long-run base
        const target = Math.round(population / k);
        if (companies < target) {
          companies = Math.min(target, Math.round(companies * (1 + p.growthRate)));
        }
      }
    }

    series.push({
      step,
      companies,
      crisis,
      crisisShock: crisis ? parseFloat(crisisShock.toFixed(4)) : 0,
      recovering,
    });
  }

  const avgRecoverySteps = (p.recoveryStepsMin + p.recoveryStepsMax) / 2;

  return {
    targetCompanies: baseCompanies,
    series,
    meta: {
      stateId,
      economicState: econKey,
      crisisProb:       p.crisisProb,
      crisisMinShock:   p.crisisMinShock,
      crisisMaxShock:   p.crisisMaxShock,
      avgRecoverySteps,
      baseCompanies,
      totalCrises,
      finalCompanies:   companies,
    },
  };
}

// ── Per-segment demand parameters ─────────────────────────────────────────────

/**
 * Demand-dynamics parameters per company segment.
 *
 * crisisDemandFactor  — multiplier applied to the macro crisis shock when computing
 *                       the demand reduction for this segment (e.g. 0.2 = govt demand
 *                       is very inelastic; 1.2 = durables purchasing freezes in crisis).
 * baselineGrowth      — organic demand growth per step when no crisis is active.
 * depreciationRate    — stock depreciation per step (DURAVEL only; null otherwise).
 * initialStockLevel   — starting stock relative to "fully stocked" = 1.0 (DURAVEL only).
 * stockThreshold      — stock level below which replacement buying is triggered (DURAVEL).
 *
 * @readonly
 */
export const SEGMENTO_DEMAND_PARAMS = Object.freeze({
  [SEGMENTO.POP_NAO_DURAVEL]: Object.freeze({
    crisisDemandFactor: 0.80,   // non-durables somewhat sensitive (food/cosmetics)
    baselineGrowth:     0.010,  // 1.0%/step organic demand growth
    depreciationRate:   null,
    initialStockLevel:  null,
    stockThreshold:     null,
  }),
  [SEGMENTO.POP_DURAVEL]: Object.freeze({
    crisisDemandFactor: 1.20,   // durables purchases drop sharply in crisis
    baselineGrowth:     0.005,  // 0.5%/step organic demand growth
    depreciationRate:   0.04,   // 4%/step depreciation → ~25-step replacement cycle
    initialStockLevel:  1.00,   // households start fully stocked
    stockThreshold:     0.90,   // below 90% stock, replacement buying kicks in
  }),
  [SEGMENTO.B2B]: Object.freeze({
    crisisDemandFactor: 0.60,   // B2B demand partially mirrors company crisis
    baselineGrowth:     0.012,  // 1.2%/step organic demand growth
    depreciationRate:   null,
    initialStockLevel:  null,
    stockThreshold:     null,
  }),
  [SEGMENTO.ESTADO]: Object.freeze({
    crisisDemandFactor: 0.20,   // government demand is highly inelastic
    baselineGrowth:     0.008,  // 0.8%/step organic demand growth
    depreciationRate:   null,
    initialStockLevel:  null,
    stockThreshold:     null,
  }),
  [SEGMENTO.CLUBE]: Object.freeze({
    crisisDemandFactor: 0.30,   // sports club demand is relatively inelastic
    baselineGrowth:     0.005,  // 0.5%/step organic demand growth
    depreciationRate:   null,
    initialStockLevel:  null,
    stockThreshold:     null,
  }),
});

// ── Per-segment simulation ────────────────────────────────────────────────────

/**
 * Run a segmented economic simulation, breaking down macro company counts into
 * per-segment company counts and demand/revenue indices.
 *
 * Builds on top of `simulateEconomy()` (which drives macro company dynamics) and
 * applies per-segment demand dynamics:
 *  - POP_NAO_DURAVEL: non-durable goods — consumed every period, moderate crisis sensitivity.
 *  - POP_DURAVEL: durable goods — stock/depreciation model, purchasing freezes in crises.
 *  - B2B: inputs for other companies — demand tracks company production levels.
 *  - ESTADO: government procurement — highly inelastic, largely crisis-resistant.
 *
 * @param {Object} params  Same parameters as simulateEconomy(), plus:
 * @param {Object} [params.shares]  Override default segment shares
 *   (e.g. `{ POP_NAO_DURAVEL: 0.5, POP_DURAVEL: 0.15, B2B: 0.25, ESTADO: 0.10 }`).
 *   Values are normalised to sum to 1.
 *
 * @returns {{
 *   macro: ReturnType<simulateEconomy>,
 *   shares: Record<string, number>,
 *   segments: Record<string, Array<{
 *     step: number,
 *     companies: number,
 *     demand: number,
 *     revenueIndex: number,
 *     stockLevel?: number,
 *   }>>,
 * }}
 */
export function simulateEconomyBySegment({
  stateId       = '',
  population    = 0,
  economicState = 'estavel',
  seed          = undefined,
  steps         = 60,
  k             = DEFAULT_K,
  shares        = {},
} = {}) {
  // Run the macro simulation first (drives aggregate company count per step)
  const macro = simulateEconomy({ stateId, population, economicState, seed, steps, k });

  // Resolve segment shares: merge defaults with overrides, then normalise
  const rawShares = { ...DEFAULT_SEGMENTO_SHARES, ...shares };
  const total = Object.values(rawShares).reduce((a, b) => a + b, 0);
  const normShares = {};
  for (const seg of Object.values(SEGMENTO)) {
    normShares[seg] = (rawShares[seg] ?? 0) / total;
  }

  // Second PRNG stream for segment-level noise (offset seed to stay independent)
  const rng = createPrng(seed !== undefined ? (seed + 1) : undefined);

  // Mutable per-segment state
  const segState = {};
  for (const seg of Object.values(SEGMENTO)) {
    const dp = SEGMENTO_DEMAND_PARAMS[seg];
    segState[seg] = {
      demand:     1.0,
      stockLevel: dp.depreciationRate != null ? dp.initialStockLevel : null,
    };
  }

  // Build per-segment series aligned with the macro series
  const segSeries = {};
  for (const seg of Object.values(SEGMENTO)) {
    segSeries[seg] = [];
  }

  for (const macroEntry of macro.series) {
    const { step, companies: macroCompanies, crisis, crisisShock } = macroEntry;

    for (const seg of Object.values(SEGMENTO)) {
      const dp = SEGMENTO_DEMAND_PARAMS[seg];
      const st = segState[seg];

      // Companies for this segment (proportional share of macro total)
      const segCompanies = Math.max(1, Math.round(macroCompanies * normShares[seg]));

      // ── Demand dynamics ─────────────────────────────────────────────────────
      if (crisis) {
        // Segment-specific shock: scale macro crisis shock by the segment factor
        const segShock = crisisShock * dp.crisisDemandFactor;
        st.demand = Math.max(0.05, st.demand * (1 - segShock));
      } else {
        // Recover toward baseline 1.0 + organic growth
        const gap = 1.0 - st.demand;
        st.demand = Math.min(1.0, st.demand + gap * 0.30 + dp.baselineGrowth);
      }

      // ── Durable goods: stock / depreciation model ───────────────────────────
      let stockLevel = null;
      if (dp.depreciationRate != null) {
        // Depreciate existing stock each period
        st.stockLevel *= (1 - dp.depreciationRate);

        // Replacement buying: if stock is below threshold, households buy to replace
        // In a crisis, replacement is partially deferred (only ~50% executed)
        if (st.stockLevel < dp.stockThreshold) {
          const replacementGap = dp.stockThreshold - st.stockLevel;
          // Execute replacement modulated by demand; in crisis a random 50% deferral
          const execRate = crisis ? (rng() > 0.5 ? 0.5 : 0.0) : 1.0;
          st.stockLevel = Math.min(
            1.0,
            st.stockLevel + replacementGap * 0.50 * st.demand * execRate,
          );
        }

        stockLevel = parseFloat(st.stockLevel.toFixed(4));
      }

      // Revenue index: companies × demand (relative to a fully-stocked baseline)
      const revenueIndex = parseFloat((segCompanies * st.demand).toFixed(2));

      const entry = {
        step,
        companies:    segCompanies,
        demand:       parseFloat(st.demand.toFixed(4)),
        revenueIndex,
      };
      if (stockLevel !== null) entry.stockLevel = stockLevel;

      segSeries[seg].push(entry);
    }
  }

  return {
    macro,
    shares: normShares,
    segments: segSeries,
  };
}

// ── Status-economico transition helpers ───────────────────────────────────────

/**
 * Map a status_economico string to a numeric score.
 *   recessao   → -1
 *   estagnacao →  0
 *   crescimento → +1
 * @param {string} status
 * @returns {number}
 */
export function statusToScore(status) {
  if (status === STATUS_ECONOMICO.CRESCIMENTO) return 1;
  if (status === STATUS_ECONOMICO.RECESSAO)    return -1;
  return 0; // estagnacao or unknown
}

/**
 * Map a numeric score to the nearest status_economico string.
 *   score < -0.33 → 'recessao'
 *   score > +0.33 → 'crescimento'
 *   otherwise     → 'estagnacao'
 * @param {number} score
 * @returns {string}
 */
export function scoreToStatus(score) {
  if (score > 0.33)  return STATUS_ECONOMICO.CRESCIMENTO;
  if (score < -0.33) return STATUS_ECONOMICO.RECESSAO;
  return STATUS_ECONOMICO.ESTAGNACAO;
}

/**
 * Compute the new status_economico for an entity based on a weighted combination
 * of contextual statuses and a stochastic nudge.
 *
 * The new score is:
 *   weightedAvg(contextScores) + noise(-0.2..+0.2) * volatility
 *
 * The result is clamped to [-1, +1] and then mapped via scoreToStatus().
 *
 * @param {string[]} contextStatuses  array of status_economico strings to consider
 * @param {number[]} weights          parallel array of positive weights (need not sum to 1)
 * @param {number}   ownScore         the entity's own current status score
 * @param {number}   ownWeight        weight for the entity's own status (default 1)
 * @param {Function} [rng]            random function () => [0,1); defaults to Math.random
 * @returns {string}  new status_economico
 */
export function calcularNovoStatusEconomico(
  contextStatuses,
  weights,
  ownScore,
  ownWeight = 1,
  rng = Math.random,
) {
  let totalWeight = ownWeight;
  let weightedSum = ownScore * ownWeight;

  for (let i = 0; i < contextStatuses.length; i++) {
    const w = (weights[i] !== undefined && Number.isFinite(weights[i]) && weights[i] > 0)
      ? weights[i]
      : 1;
    weightedSum += statusToScore(contextStatuses[i]) * w;
    totalWeight += w;
  }

  const avgScore = totalWeight > 0 ? weightedSum / totalWeight : 0;

  // Stochastic nudge: small random perturbation to avoid deterministic locks
  const noise = (rng() - 0.5) * 0.4; // range -0.2..+0.2
  const finalScore = Math.max(-1, Math.min(1, avgScore + noise));

  return scoreToStatus(finalScore);
}

/**
 * Compute the new status_economico for a **pessoa** entity.
 *
 * Considers:
 *  - Own current status (weight 2)
 *  - Employer empresa status (weight 1), if the pessoa has an empresa_id
 *  - Estado status (weight 1)
 *
 * @param {Object} pessoa
 * @param {{ pessoas: Object[], empresas: Object[], estados: Object[], clubes?: Object[] }} world
 * @param {Function} [rng]
 * @returns {string}  new status_economico
 */
export function calcularStatusPessoa(pessoa, world, rng = Math.random) {
  const empresasById = new Map((world.empresas || []).map(e => [e.id, e]));
  const estadosById  = new Map((world.estados  || []).map(s => [s.id, s]));

  const contextStatuses = [];
  const weights = [];

  // Employer: pessoas with empresa_id reference (stored as clube field historically,
  // but we check both empresa_id and clube for backward compatibility)
  const empregadorId = pessoa.empresa_id || '';
  if (empregadorId) {
    const emp = empresasById.get(empregadorId);
    if (emp) { contextStatuses.push(emp.status_economico || 'estagnacao'); weights.push(1); }
  }

  // State
  const estado = estadosById.get(pessoa.estado_id);
  if (estado) { contextStatuses.push(estado.status_economico || 'estagnacao'); weights.push(1); }

  return calcularNovoStatusEconomico(
    contextStatuses,
    weights,
    statusToScore(pessoa.status_economico || 'estagnacao'),
    2,
    rng,
  );
}

/**
 * Compute the new status_economico for an **empresa** entity.
 *
 * Considers:
 *  - Own current status (weight 2)
 *  - Estado status (weight 1)
 *  - Each supplier empresa (in fornecedores_ids) status (weight 1 each)
 *
 * @param {Object} empresa
 * @param {{ pessoas: Object[], empresas: Object[], estados: Object[], clubes?: Object[] }} world
 * @param {Function} [rng]
 * @returns {string}  new status_economico
 */
export function calcularStatusEmpresa(empresa, world, rng = Math.random) {
  const empresasById = new Map((world.empresas || []).map(e => [e.id, e]));
  const estadosById  = new Map((world.estados  || []).map(s => [s.id, s]));

  const contextStatuses = [];
  const weights = [];

  // State
  const estado = estadosById.get(empresa.estado_id);
  if (estado) { contextStatuses.push(estado.status_economico || 'estagnacao'); weights.push(1); }

  // Supplier companies (fornecedores)
  for (const fornId of (empresa.fornecedores_ids || [])) {
    const forn = empresasById.get(fornId);
    if (forn) { contextStatuses.push(forn.status_economico || 'estagnacao'); weights.push(1); }
  }

  return calcularNovoStatusEconomico(
    contextStatuses,
    weights,
    statusToScore(empresa.status_economico || 'estagnacao'),
    2,
    rng,
  );
}

/**
 * Compute the new status_economico for an **estado** entity.
 *
 * Considers:
 *  - Own current status (weight 2)
 *  - Each citizen (pessoa in this estado) status, weighted by pessoa.peso (default 1)
 *  - Each empresa in this estado (weight 1 each)
 *  - Parent estado status (weight 1), if present
 *  - Child estados statuses (weight 1 each)
 *
 * @param {Object} estado
 * @param {{ pessoas: Object[], empresas: Object[], estados: Object[], clubes?: Object[] }} world
 * @param {Function} [rng]
 * @returns {string}  new status_economico
 */
export function calcularStatusEstado(estado, world, rng = Math.random) {
  const estadosById = new Map((world.estados || []).map(s => [s.id, s]));

  const contextStatuses = [];
  const weights = [];

  // Citizens of this estado (weighted by peso)
  for (const p of (world.pessoas || [])) {
    if (p.estado_id !== estado.id) continue;
    const w = Math.max(1, toNum(p.peso, 1));
    contextStatuses.push(p.status_economico || 'estagnacao');
    weights.push(w);
  }

  // Empresas in this estado
  for (const emp of (world.empresas || [])) {
    if (emp.estado_id !== estado.id) continue;
    contextStatuses.push(emp.status_economico || 'estagnacao');
    weights.push(1);
  }

  // Parent estado
  if (estado.parent_id) {
    const parent = estadosById.get(estado.parent_id);
    if (parent) { contextStatuses.push(parent.status_economico || 'estagnacao'); weights.push(1); }
  }

  // Child estados
  for (const other of (world.estados || [])) {
    if (other.parent_id === estado.id && other.id !== estado.id) {
      contextStatuses.push(other.status_economico || 'estagnacao');
      weights.push(1);
    }
  }

  return calcularNovoStatusEconomico(
    contextStatuses,
    weights,
    statusToScore(estado.status_economico || 'estagnacao'),
    2,
    rng,
  );
}

/** @param {string|number|boolean} v @returns {number} */
function toNum(v, fallback = 0) {
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
