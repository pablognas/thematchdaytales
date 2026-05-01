/**
 * import-cities.js — Import cities from a grid_cities.txt file.
 *
 * File format (one city per line):
 *   (x,y) -> Nome da Cidade
 *
 * Where:
 *   x = longitude (horizontal map coordinate, integer -180..180)
 *   y = latitude  (vertical map coordinate, integer -90..90)
 *
 * Lines starting with '#' and blank lines are ignored.
 *
 * Behaviour (idempotent):
 *   - Derives a stable id from the city name via slugifyNome().
 *   - If an estado with that id does not exist, creates it
 *     (tipo: 'cidade', parent_id: '', population via formula).
 *   - If the mapa cell at (lat, lon) does not already reference this
 *     estado_id, sets it (tipo: 'terra').
 *   - If the estado was previously assigned to a different cell,
 *     the stale estado_id is cleared from the old cell.
 *
 * Population formula:
 *   randint(1,10) * 10 ** (2 + randint(1,4))
 *   Range: 1 000 – 10 000 000.
 *
 * Usage:
 *   import { parseGridCitiesText, importCities } from './import-cities.js';
 *   const entries = parseGridCitiesText(txtContent);
 *   const result  = importCities(world, entries, { rng: Math.random, tick: 0 });
 *   // result: { created: string[], updated: string[] }
 */

import { setCell, findCellsByEstado } from './map.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Convert a city name into a deterministic, URL-safe slug suitable as an ID.
 * Example: "São Paulo" → "sao_paulo"
 *
 * @param {string} nome
 * @returns {string}
 */
export function slugifyNome(nome) {
  return nome
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // strip combining diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// ── Parser ────────────────────────────────────────────────────────────────────

/**
 * Parse the content of a grid_cities.txt file into an array of entries.
 *
 * Expected format per line:
 *   (x,y) -> Nome da Cidade
 * where x = longitude, y = latitude (integers).
 *
 * Lines starting with '#' and blank lines are silently skipped.
 * Lines that don't match the pattern or have out-of-range coordinates
 * are also silently skipped.
 *
 * @param {string} text  Raw text content of the file.
 * @returns {{ lat: number, lon: number, nome: string }[]}
 */
export function parseGridCitiesText(text) {
  const LINE_RE = /^\(\s*(-?\d+)\s*,\s*(-?\d+)\s*\)\s*->\s*(.+?)\s*$/;
  const results = [];

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    const m = LINE_RE.exec(line);
    if (!m) continue;

    const lon  = parseInt(m[1], 10);
    const lat  = parseInt(m[2], 10);
    const nome = m[3].trim();

    if (!nome)              continue;
    if (lat < -90  || lat > 90)  continue;
    if (lon < -180 || lon > 180) continue;

    results.push({ lat, lon, nome });
  }

  return results;
}

// ── Population formula ────────────────────────────────────────────────────────

/**
 * Generate a population value using:
 *   randint(1,10) * 10 ** (2 + randint(1,4))
 *
 * Range: 1 000 – 10 000 000.
 *
 * @param {() => number} [rng]  PRNG returning [0, 1). Defaults to Math.random.
 * @returns {number}
 */
export function gerarPopulacao(rng = Math.random) {
  const a = Math.floor(rng() * 10) + 1;  // randint(1, 10)
  const b = Math.floor(rng() * 4)  + 1;  // randint(1, 4)
  return a * 10 ** (2 + b);
}

// ── Core import ───────────────────────────────────────────────────────────────

/**
 * Import cities from parsed entries into the world (idempotent).
 *
 * For each entry:
 *   1. Derive a deterministic id with slugifyNome(nome).
 *   2. If no estado with that id exists, create one
 *      (tipo='cidade', parent_id='', population from gerarPopulacao).
 *   3. Remove any stale mapa associations that point to this estado_id
 *      from a different cell.
 *   4. If the mapa cell at (lat, lon) does not already reference this
 *      estado_id, set it (tipo: 'terra').
 *
 * @param {{ estados: Object[], mapa: Object }} world
 * @param {{ lat: number, lon: number, nome: string }[]} entries
 * @param {{ rng?: () => number, tick?: number }} [options]
 * @returns {{ created: string[], updated: string[] }}
 *   created — IDs of newly-created estados.
 *   updated — IDs of estados whose mapa association was created or corrected.
 */
export function importCities(world, entries, { rng = Math.random, tick = 0 } = {}) {
  const created = [];
  const updated = [];

  for (const { lat, lon, nome } of entries) {
    const id = slugifyNome(nome);
    if (!id) continue;

    // ── 1. Create estado if it does not yet exist ──────────────────────────
    let estado = world.estados.find(s => s.id === id);
    if (!estado) {
      const populacao = gerarPopulacao(rng);
      estado = {
        id,
        nome,
        tipo:      'cidade',
        parent_id: '',
        descricao: '',
        patrimonio: 0,
        atributos: {
          populacao,
          forcas_armadas:  1,
          cultura:         1,
          moral_populacao: 3,
        },
        impostos: { ir_pf: 0, ir_pj: 0, imp_prod: 0 },
        financas: {
          renda_tributaria:     0,
          salarios_politicos:   0,
          incentivos_empresas:  0,
          investimento_cultura: 0,
          investimento_fa:      0,
        },
        infraestrutura: {},
        tick_registro:    tick,
        tick_saida:       0,
        status_economico: 'estagnacao',
        fornecedores_ids: [],
        ativos: { patrimonio_geral: 0 },
      };
      world.estados.push(estado);
      created.push(id);
    }

    // ── 2. Clear stale mapa associations for this estado ──────────────────
    const existing = findCellsByEstado(world.mapa, id);
    for (const { lat: oldLat, lon: oldLon } of existing) {
      if (oldLat !== lat || oldLon !== lon) {
        setCell(world.mapa, oldLat, oldLon, { estado_id: '' });
      }
    }

    // ── 3. Set the correct mapa cell ───────────────────────────────────────
    const currentCell = world.mapa[String(lat)]?.[String(lon)];
    const alreadyCorrect = currentCell && currentCell.estado_id === id;
    if (!alreadyCorrect) {
      setCell(world.mapa, lat, lon, { tipo: 'terra', estado_id: id });
      updated.push(id);
    }
  }

  return { created, updated };
}
