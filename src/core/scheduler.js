/**
 * scheduler.js — Manages scheduled conversions and one-time financial injections.
 * All state is persisted to localStorage so it survives page refreshes.
 */

const KEY_CONVERSIONS = 'matchday_conversions';
const KEY_INJECTIONS  = 'matchday_injections';
const KEY_TICK        = 'matchday_current_tick';

// ── Tick counter ──────────────────────────────────────────────────────────

/** @returns {number} */
export function getCurrentTick() {
  return parseInt(localStorage.getItem(KEY_TICK) ?? '0', 10);
}

/** @param {number} tick */
export function setCurrentTick(tick) {
  localStorage.setItem(KEY_TICK, String(Math.max(0, tick)));
}

/** Increment tick by 1 and return the new value. @returns {number} */
export function advanceTick() {
  const next = getCurrentTick() + 1;
  setCurrentTick(next);
  return next;
}

// ── Scheduled conversions ─────────────────────────────────────────────────

function loadConversions() {
  try { return JSON.parse(localStorage.getItem(KEY_CONVERSIONS) || '[]'); }
  catch { return []; }
}

function saveConversions(list) {
  localStorage.setItem(KEY_CONVERSIONS, JSON.stringify(list));
}

/**
 * Schedule a one-time conversion for the given tick.
 * Duplicates (same tick + ownerType + ownerId + conversionId) are ignored.
 *
 * @param {number} tick
 * @param {'pessoa'|'empresa'|'estado'} ownerType
 * @param {string} ownerId
 * @param {string} conversionId  e.g. "influencia:reputacao" or "lucro_para_patrimonio"
 */
export function scheduleConversion(tick, ownerType, ownerId, conversionId) {
  const list = loadConversions();
  const exists = list.some(x =>
    x.tick === tick && x.ownerType === ownerType &&
    x.ownerId === ownerId && x.conversionId === conversionId
  );
  if (!exists) {
    list.push({ tick, ownerType, ownerId, conversionId });
    saveConversions(list);
  }
}

/**
 * Remove a scheduled conversion.
 * @param {number} tick
 * @param {'pessoa'|'empresa'|'estado'} ownerType
 * @param {string} ownerId
 * @param {string} conversionId
 */
export function unscheduleConversion(tick, ownerType, ownerId, conversionId) {
  saveConversions(loadConversions().filter(x =>
    !(x.tick === tick && x.ownerType === ownerType &&
      x.ownerId === ownerId && x.conversionId === conversionId)
  ));
}

/** @returns {Array<{tick,ownerType,ownerId,conversionId}>} */
export function getAllScheduledConversions() {
  return loadConversions();
}

/** @param {number} tick @returns {Array} */
export function getConversionsForTick(tick) {
  return loadConversions().filter(x => x.tick === tick);
}

/** Remove all scheduled conversions for a given tick. @param {number} tick */
export function clearConversionsForTick(tick) {
  saveConversions(loadConversions().filter(x => x.tick !== tick));
}

// ── Scheduled injections ──────────────────────────────────────────────────

function loadInjections() {
  try { return JSON.parse(localStorage.getItem(KEY_INJECTIONS) || '[]'); }
  catch { return []; }
}

function saveInjections(list) {
  localStorage.setItem(KEY_INJECTIONS, JSON.stringify(list));
}

/** Generate a unique ID, preferring crypto.randomUUID() when available. */
function genId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Schedule a one-time financial injection.
 * @param {number} tick
 * @param {'pessoa'|'empresa'|'estado'} ownerType
 * @param {string} ownerId
 * @param {number} amount
 */
export function scheduleInjection(tick, ownerType, ownerId, amount) {
  const list = loadInjections();
  list.push({
    id: genId(),
    tick,
    ownerType,
    ownerId,
    amount: Number(amount),
  });
  saveInjections(list);
}

/** @param {string} injectionId */
export function removeInjection(injectionId) {
  saveInjections(loadInjections().filter(x => x.id !== injectionId));
}

/** @returns {Array<{id,tick,ownerType,ownerId,amount}>} */
export function getAllScheduledInjections() {
  return loadInjections();
}

/** @param {number} tick @returns {Array} */
export function getInjectionsForTick(tick) {
  return loadInjections().filter(x => x.tick === tick);
}

/** Remove all scheduled injections for a given tick. @param {number} tick */
export function clearInjectionsForTick(tick) {
  saveInjections(loadInjections().filter(x => x.tick !== tick));
}
