/**
 * map.js — Core helpers for the world map (mapa.csv).
 *
 * Map format (sparse object):
 *   mapa[latString][lonString] = { tipo?, estado_id?, bioma?, clima? }
 *
 * Valid ranges:
 *   lat: integer -90..90
 *   lon: integer -180..180
 *
 * Only cells that have been explicitly set are stored.
 * Empty cells are removed to keep the map sparse.
 * Missing coordinates are treated as default water cells with empty metadata.
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

/**
 * Convert sparse CSV rows (from parseCsv) into a mapa object.
 * Validates lat/lon bounds, coerces to integers; ignores invalid rows.
 * Duplicate (lat, lon) rows: last row wins.
 * tipo may be empty → treated as 'agua'.
 * @param {Object[]} rows  parsed CSV rows (lat, lon, tipo, estado_id, bioma, clima)
 * @returns {object} sparse mapa
 */
export function rowsToMapa(rows) {
  const mapa = {};
  for (const row of rows) {
    const lat = parseInt(row.lat, 10);
    const lon = parseInt(row.lon, 10);
    if (!Number.isInteger(lat) || lat < -90  || lat > 90)  continue;
    if (!Number.isInteger(lon) || lon < -180 || lon > 180) continue;
    const tipo      = (row.tipo      || '').trim() || 'agua';
    const estado_id = (row.estado_id || '').trim();
    const bioma     = (row.bioma     || '').trim();
    const clima     = (row.clima     || '').trim();
    const cell = { tipo };
    if (estado_id) cell.estado_id = estado_id;
    if (bioma)     cell.bioma     = bioma;
    if (clima)     cell.clima     = clima;
    const latKey = String(lat);
    const lonKey = String(lon);
    if (!mapa[latKey]) mapa[latKey] = {};
    mapa[latKey][lonKey] = cell;
  }
  return mapa;
}

/**
 * Convert a mapa object to sparse CSV rows.
 * Skips cells that are exactly default water (tipo='agua' or absent, no estado_id/bioma/clima).
 * @param {object} mapa
 * @returns {Object[]}  array of { lat, lon, tipo, estado_id, bioma, clima }
 */
export function mapaToRows(mapa) {
  const rows = [];
  for (const [latStr, row] of Object.entries(mapa)) {
    for (const [lonStr, cell] of Object.entries(row)) {
      const tipo      = cell.tipo      || '';
      const estado_id = cell.estado_id || '';
      const bioma     = cell.bioma     || '';
      const clima     = cell.clima     || '';
      // Skip pure default water cells
      if ((tipo === '' || tipo === 'agua') && !estado_id && !bioma && !clima) continue;
      rows.push({ lat: Number(latStr), lon: Number(lonStr), tipo, estado_id, bioma, clima });
    }
  }
  return rows;
}
