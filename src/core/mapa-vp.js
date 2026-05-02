/**
 * mapa-vp.js — Viewport state helpers for the world map.
 *
 * Handles cell-size (zoom) constants, clamping, and localStorage persistence.
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
