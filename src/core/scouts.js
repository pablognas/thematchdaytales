/**
 * scouts.js — Player scouting (match events) scoring rules.
 *
 * Each scout has an id, a Portuguese label, a point value, and an optional
 * `gk: true` flag marking it as exclusive to goalkeepers (goleiros).
 */

/** @type {{ id: string, label: string, pts: number, gk?: true }[]} */
export const SCOUTS_ATAQUE = [
  { id: 'gol',                   label: 'Gol',                   pts:  8.0 },
  { id: 'assistencia',           label: 'Assistência',           pts:  5.0 },
  { id: 'finalizacao_trave',     label: 'Finalização na trave',  pts:  3.0 },
  { id: 'finalizacao_defendida', label: 'Finalização defendida', pts:  1.2 },
  { id: 'finalizacao_pra_fora',  label: 'Finalização pra fora',  pts:  0.8 },
  { id: 'falta_sofrida',         label: 'Falta sofrida',         pts:  0.5 },
  { id: 'penalti_sofrido',       label: 'Pênalti sofrido',       pts:  1.0 },
  { id: 'penalti_perdido',       label: 'Pênalti perdido',       pts: -4.0 },
  { id: 'impedimento',           label: 'Impedimento',           pts: -0.1 },
];

/** @type {{ id: string, label: string, pts: number, gk?: true }[]} */
export const SCOUTS_DEFESA = [
  { id: 'defesa_penalti',   label: 'Defesa de pênalti',    pts:  7.0, gk: true },
  { id: 'jogo_sem_gols',    label: 'Jogo sem sofrer gols', pts:  5.0 },
  { id: 'defesa',           label: 'Defesa',               pts:  1.3, gk: true },
  { id: 'desarme',          label: 'Desarme',              pts:  1.5 },
  { id: 'gol_contra',       label: 'Gol contra',           pts: -3.0 },
  { id: 'cartao_vermelho',  label: 'Cartão vermelho',      pts: -3.0 },
  { id: 'cartao_amarelo',   label: 'Cartão amarelo',       pts: -1.0 },
  { id: 'gol_sofrido',      label: 'Gol sofrido',          pts: -1.0 },
  { id: 'falta_cometida',   label: 'Falta cometida',       pts: -0.3 },
  { id: 'penalti_cometido', label: 'Pênalti cometido',     pts: -1.0 },
];

/**
 * Compute a match score from per-event counts.
 * matchScore = Σ(count[action] × points[action])
 * @param {Object.<string, number>} counts  map of scout_id → integer count
 * @returns {number}
 */
export function calcMatchScore(counts) {
  let score = 0;
  for (const s of [...SCOUTS_ATAQUE, ...SCOUTS_DEFESA]) {
    score += (counts[s.id] || 0) * s.pts;
  }
  return score;
}

/**
 * Compute the new average score.
 * A prevScore of 0/falsy is treated as "no prior score" (the default for new
 * players), in which case matchScore is returned as-is without dividing by 2.
 * This matches the spec: "when previous score is missing/0/undefined, use the
 * match score as the new average."
 * @param {number} prevScore
 * @param {number} matchScore
 * @returns {number}
 */
export function calcNewAverage(prevScore, matchScore) {
  if (!prevScore) return matchScore;
  return (prevScore + matchScore) / 2;
}

/**
 * Compute the new market value based on the percentage change in average score.
 * newValue = round(oldValue × (newAvg / oldAvg))
 * If oldAvg is 0/falsy or oldValue is 0/falsy, returns oldValue unchanged.
 * @param {number} oldValue
 * @param {number} oldAvg
 * @param {number} newAvg
 * @returns {number}
 */
export function calcNewMarketValue(oldValue, oldAvg, newAvg) {
  if (!oldAvg || !oldValue) return oldValue;
  return Math.round(oldValue * (newAvg / oldAvg));
}
