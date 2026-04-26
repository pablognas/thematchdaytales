/**
 * economy.js — Economic simulation module.
 *
 * Simulates how many companies should exist in a state based on:
 *   - Population size
 *   - Economic state: 'estavel' (stable) or 'instavel' (unstable)
 *   - Stochastic crises that occasionally reduce companies, followed by recovery
 *
 * Public API:
 *   simulateEconomy(params)  — run a simulation and return series + metadata
 *
 * Backup format reference (for import/export):
 *   { version: 1, type: 'simulation_result', stateId, params, result }
 */

// ── Constants ─────────────────────────────────────────────────────────────────

/** Default population-to-company ratio (companies ≈ population / K). */
const DEFAULT_K = 1000;

/** Parameters per economic state. */
const ECONOMIC_PARAMS = {
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
        const gap  = recoveryTarget - companies;
        const step = Math.ceil(gap / recoveryLeft);
        companies  = Math.min(recoveryTarget, companies + step);
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
