/**
 * mapa-vp.js — Viewport state helpers for the world map.
 *
 * Handles cell-size (zoom) constants, clamping, and localStorage persistence.
 * Also handles viewport dimension (rows/cols) constants for cell-density zoom.
 */

// ── Constants ─────────────────────────────────────────────────────────────────

/** Smallest allowed cell size in pixels. */
export const CELL_SIZE_MIN     = 4;

/** Largest allowed cell size in pixels. */
export const CELL_SIZE_MAX     = 32;

/** Default cell size when no persisted value is found. */
export const CELL_SIZE_DEFAULT = 12;

/** Number of pixels added/removed per zoom step (+/- button or wheel tick). */
export const CELL_SIZE_STEP    = 4;

/** localStorage key used to persist the cell size across page reloads. */
export const MAPA_VP_STORAGE_KEY = 'mapa-vp-cell-size';

// ── Viewport dimension constants (cell-density zoom) ─────────────────────────

/** Minimum number of longitude columns visible in the viewport. */
export const VIEWPORT_COLS_MIN     = 20;

/** Maximum number of longitude columns visible in the viewport. */
export const VIEWPORT_COLS_MAX     = 120;

/** Default number of longitude columns when no persisted value is found. */
export const VIEWPORT_COLS_DEFAULT = 60;

/** Number of columns added/removed per cell-density zoom step. */
export const VIEWPORT_COLS_STEP    = 10;

/** Minimum number of latitude rows visible in the viewport. */
export const VIEWPORT_ROWS_MIN     = 10;

/** Maximum number of latitude rows visible in the viewport. */
export const VIEWPORT_ROWS_MAX     = 60;

/** Default number of latitude rows when no persisted value is found. */
export const VIEWPORT_ROWS_DEFAULT = 30;

/** Number of rows added/removed per cell-density zoom step. */
export const VIEWPORT_ROWS_STEP    = 5;

/** localStorage key used to persist the column count across page reloads. */
export const MAPA_VP_COLS_KEY = 'mapa-vp-cols';

/** localStorage key used to persist the row count across page reloads. */
export const MAPA_VP_ROWS_KEY = 'mapa-vp-rows';

// ── Zoom helpers ──────────────────────────────────────────────────────────────

/**
 * Clamp a cell-size value to the valid [CELL_SIZE_MIN, CELL_SIZE_MAX] range.
 * @param {number} size  Desired cell size in pixels.
 * @returns {number}     Clamped integer value.
 */
export function clampCellSize(size) {
  return Math.max(CELL_SIZE_MIN, Math.min(CELL_SIZE_MAX, Math.round(size)));
}

/**
 * Persist the current cell size to localStorage.
 * No-ops gracefully when localStorage is unavailable (e.g., Node.js tests).
 * @param {number} size  Cell size to store.
 */
export function saveCellSize(size) {
  try {
    localStorage.setItem(MAPA_VP_STORAGE_KEY, String(size));
  } catch (_) { /* storage unavailable */ }
}

/**
 * Load the persisted cell size from localStorage.
 * Returns CELL_SIZE_DEFAULT when no valid value is stored.
 * @returns {number}  Clamped cell size.
 */
export function loadCellSize() {
  try {
    const raw = localStorage.getItem(MAPA_VP_STORAGE_KEY);
    if (raw === null) return CELL_SIZE_DEFAULT;
    const parsed = parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return CELL_SIZE_DEFAULT;
    return clampCellSize(parsed);
  } catch (_) {
    return CELL_SIZE_DEFAULT;
  }
}

// ── Viewport dimension helpers (cell-density zoom) ───────────────────────────

/**
 * Clamp a column count to the valid [VIEWPORT_COLS_MIN, VIEWPORT_COLS_MAX] range.
 * @param {number} cols  Desired number of visible columns.
 * @returns {number}     Clamped integer value.
 */
export function clampViewportCols(cols) {
  return Math.max(VIEWPORT_COLS_MIN, Math.min(VIEWPORT_COLS_MAX, Math.round(cols)));
}

/**
 * Clamp a row count to the valid [VIEWPORT_ROWS_MIN, VIEWPORT_ROWS_MAX] range.
 * @param {number} rows  Desired number of visible rows.
 * @returns {number}     Clamped integer value.
 */
export function clampViewportRows(rows) {
  return Math.max(VIEWPORT_ROWS_MIN, Math.min(VIEWPORT_ROWS_MAX, Math.round(rows)));
}

/**
 * Persist the current column count to localStorage.
 * No-ops gracefully when localStorage is unavailable (e.g., Node.js tests).
 * @param {number} cols  Column count to store.
 */
export function saveViewportCols(cols) {
  try {
    localStorage.setItem(MAPA_VP_COLS_KEY, String(cols));
  } catch (_) { /* storage unavailable */ }
}

/**
 * Persist the current row count to localStorage.
 * No-ops gracefully when localStorage is unavailable (e.g., Node.js tests).
 * @param {number} rows  Row count to store.
 */
export function saveViewportRows(rows) {
  try {
    localStorage.setItem(MAPA_VP_ROWS_KEY, String(rows));
  } catch (_) { /* storage unavailable */ }
}

/**
 * Load the persisted column count from localStorage.
 * Returns VIEWPORT_COLS_DEFAULT when no valid value is stored.
 * @returns {number}  Clamped column count.
 */
export function loadViewportCols() {
  try {
    const raw = localStorage.getItem(MAPA_VP_COLS_KEY);
    if (raw === null) return VIEWPORT_COLS_DEFAULT;
    const parsed = parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return VIEWPORT_COLS_DEFAULT;
    return clampViewportCols(parsed);
  } catch (_) {
    return VIEWPORT_COLS_DEFAULT;
  }
}

/**
 * Load the persisted row count from localStorage.
 * Returns VIEWPORT_ROWS_DEFAULT when no valid value is stored.
 * @returns {number}  Clamped row count.
 */
export function loadViewportRows() {
  try {
    const raw = localStorage.getItem(MAPA_VP_ROWS_KEY);
    if (raw === null) return VIEWPORT_ROWS_DEFAULT;
    const parsed = parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return VIEWPORT_ROWS_DEFAULT;
    return clampViewportRows(parsed);
  } catch (_) {
    return VIEWPORT_ROWS_DEFAULT;
  }
}
