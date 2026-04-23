/**
 * map.js — Core helpers for the world map (mapa.json).
 *
 * Map format (sparse JSON):
 *   mapa[latString][lonString] = { tipo?, estado_id?, bioma?, clima? }
 *
 * Valid ranges:
 *   lat: integer -90..90
 *   lon: integer -180..180
 *
 * Only cells that have been explicitly set are stored.
 * Empty cells are removed to keep the map sparse.
 */

/**
 * Get a cell at (lat, lon).
 * @param {object} mapa
 * @param {number} lat
 * @param {number} lon
 * @returns {object|undefined} cell object, or undefined if not set
 */
export function getCell(mapa, lat, lon) {
  const row = mapa[String(lat)];
  return row ? row[String(lon)] : undefined;
}

/**
 * Set fields on a cell at (lat, lon).
 * Fields with empty-string values delete that field from the cell.
 * Cells that become empty after the operation are removed (sparse).
 * @param {object} mapa
 * @param {number} lat
 * @param {number} lon
 * @param {object} fields  e.g. { tipo: 'terra', estado_id: 'br', bioma: '', clima: '' }
 */
export function setCell(mapa, lat, lon, fields) {
  const latKey = String(lat);
  const lonKey = String(lon);
  if (!mapa[latKey]) mapa[latKey] = {};
  if (!mapa[latKey][lonKey]) mapa[latKey][lonKey] = {};
  const cell = mapa[latKey][lonKey];
  for (const [k, v] of Object.entries(fields)) {
    if (v === '' || v === null || v === undefined) {
      delete cell[k];
    } else {
      cell[k] = v;
    }
  }
  // Prune empty cell
  if (!Object.keys(cell).length) {
    delete mapa[latKey][lonKey];
    if (!Object.keys(mapa[latKey]).length) delete mapa[latKey];
  }
}

/**
 * Remove a cell entirely from the map.
 * @param {object} mapa
 * @param {number} lat
 * @param {number} lon
 */
export function clearCell(mapa, lat, lon) {
  const latKey = String(lat);
  if (!mapa[latKey]) return;
  delete mapa[latKey][String(lon)];
  if (!Object.keys(mapa[latKey]).length) delete mapa[latKey];
}

/**
 * Find all cells that reference a given estado_id.
 * @param {object} mapa
 * @param {string} estadoId
 * @returns {{ lat: number, lon: number }[]}
 */
export function findCellsByEstado(mapa, estadoId) {
  const results = [];
  for (const [latStr, row] of Object.entries(mapa)) {
    for (const [lonStr, cell] of Object.entries(row)) {
      if (cell.estado_id === estadoId) {
        results.push({ lat: Number(latStr), lon: Number(lonStr) });
      }
    }
  }
  return results;
}
