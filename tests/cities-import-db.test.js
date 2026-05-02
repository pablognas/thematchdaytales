/**
 * cities-import-db.test.js — End-to-end integration tests for the
 * grid_cities.txt import flow.
 *
 * Covers the complete pipeline:
 *   parseGridCitiesText → importCities → saveWorldToDb → loadWorldFromDb
 *
 * This validates that importing a file in the real `(x,y) -> Nome` format
 * correctly creates estados in world.estados AND persists them across
 * page reloads (i.e., save to SQLite → load from SQLite round-trip).
 *
 * Background:
 *   The previous fix (PR #28) targeted the mapa.csv import path.  The
 *   actual user file is a plain-text file where each line is:
 *     (x,y) -> Name of City
 *   where x = longitude (-180..180) and y = latitude (-90..90).
 *   This test suite confirms that importing that format persists the
 *   resulting estados so they appear in the Estados tab after a reload.
 */

// Set up fake IndexedDB globals BEFORE importing db.js
import 'fake-indexeddb/auto';

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import initSqlJsNode from 'sql.js';

import {
  setInitSqlJs,
  resetDbSingleton,
  getDb,
  loadWorldFromDb,
  saveWorldToDb,
} from '../src/core/db.js';

import {
  parseGridCitiesText,
  importCities,
  syncEstadosFromMapa,
} from '../src/core/import-cities.js';

// ── Setup helpers ─────────────────────────────────────────────────────────────

function resetIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase('matchday-tales-db');
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
    req.onblocked = () => resolve();  // proceed even if blocked
  });
}

beforeEach(async () => {
  await resetIdb();
  resetDbSingleton();
  setInitSqlJs(initSqlJsNode);
});

// ── Sample data (matches the exact format described by the user) ──────────────

// Excerpt from the real grid_cities.txt format the user provided.
// Coordinates: (lon,lat) → Name, where lon ∈ [-180,180] and lat ∈ [-90,90].
const SAMPLE_TXT = [
  '(170,70) -> Pevek',
  '(178,65) -> Anadyr',
  '(179,63) -> Beringovskiy',
  '# This is a comment — should be ignored',
  '',
  '(-46,-23) -> São Paulo',
  '(-43,-22) -> Rio de Janeiro',
].join('\n');

// ── parseGridCitiesText with real-world data ──────────────────────────────────

test('parseGridCitiesText parses all valid lines from sample txt', () => {
  const entries = parseGridCitiesText(SAMPLE_TXT);
  assert.strictEqual(entries.length, 5, 'should parse 5 valid lines (2 ignored)');
});

test('parseGridCitiesText correctly parses positive coordinates (user example)', () => {
  const entries = parseGridCitiesText('(170,70) -> Pevek');
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].lon,  170);
  assert.strictEqual(entries[0].lat,   70);
  assert.strictEqual(entries[0].nome, 'Pevek');
});

test('parseGridCitiesText correctly parses Anadyr', () => {
  const entries = parseGridCitiesText('(178,65) -> Anadyr');
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].lon,  178);
  assert.strictEqual(entries[0].lat,   65);
  assert.strictEqual(entries[0].nome, 'Anadyr');
});

test('parseGridCitiesText correctly parses Beringovskiy', () => {
  const entries = parseGridCitiesText('(179,63) -> Beringovskiy');
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].lon,  179);
  assert.strictEqual(entries[0].lat,   63);
  assert.strictEqual(entries[0].nome, 'Beringovskiy');
});

test('parseGridCitiesText handles Windows-style CRLF line endings', () => {
  const text = '(170,70) -> Pevek\r\n(178,65) -> Anadyr\r\n(179,63) -> Beringovskiy';
  const entries = parseGridCitiesText(text);
  assert.strictEqual(entries.length, 3);
  assert.strictEqual(entries[0].nome, 'Pevek');
  assert.strictEqual(entries[1].nome, 'Anadyr');
  assert.strictEqual(entries[2].nome, 'Beringovskiy');
});

test('parseGridCitiesText handles mixed positive and negative coordinates', () => {
  const entries = parseGridCitiesText(SAMPLE_TXT);
  const names = entries.map(e => e.nome);
  assert.ok(names.includes('Pevek'));
  assert.ok(names.includes('Anadyr'));
  assert.ok(names.includes('Beringovskiy'));
  assert.ok(names.includes('São Paulo'));
  assert.ok(names.includes('Rio de Janeiro'));
});

// ── importCities with user sample data ───────────────────────────────────────

test('importCities creates estados from the user sample txt data', () => {
  const world   = { estados: [], mapa: {} };
  const entries = parseGridCitiesText(SAMPLE_TXT);
  const { created } = importCities(world, entries);

  assert.strictEqual(world.estados.length, 5);
  assert.strictEqual(created.length, 5);
});

test('importCities creates estado with correct id and nome for Pevek', () => {
  const world   = { estados: [], mapa: {} };
  const entries = parseGridCitiesText('(170,70) -> Pevek');
  importCities(world, entries);

  const estado = world.estados.find(s => s.id === 'pevek');
  assert.ok(estado, 'estado "pevek" should be created');
  assert.strictEqual(estado.nome, 'Pevek');
  assert.strictEqual(estado.tipo, 'cidade');
});

test('importCities creates mapa cell for Pevek at correct coordinates', () => {
  const world   = { estados: [], mapa: {} };
  const entries = parseGridCitiesText('(170,70) -> Pevek');
  importCities(world, entries);

  const cell = world.mapa['70']?.['170'];
  assert.ok(cell, 'mapa cell at lat=70,lon=170 should be created');
  assert.strictEqual(cell.estado_id, 'pevek');
  assert.strictEqual(cell.tipo, 'terra');
});

test('importCities creates all 5 mapa cells from sample data', () => {
  const world   = { estados: [], mapa: {} };
  const entries = parseGridCitiesText(SAMPLE_TXT);
  importCities(world, entries);

  // Count cells with estado_id
  let cellCount = 0;
  for (const row of Object.values(world.mapa)) {
    for (const cell of Object.values(row)) {
      if (cell.estado_id) cellCount++;
    }
  }
  assert.strictEqual(cellCount, 5);
});

test('importCities with São Paulo uses correct slugified id', () => {
  const world   = { estados: [], mapa: {} };
  const entries = parseGridCitiesText('(-46,-23) -> São Paulo');
  importCities(world, entries);

  const estado = world.estados.find(s => s.id === 'sao_paulo');
  assert.ok(estado, 'estado "sao_paulo" should exist');
  assert.strictEqual(estado.nome, 'São Paulo');
});

// ── DB persistence round-trip ─────────────────────────────────────────────────

test('cities imported from txt are persisted to SQLite and survive reload', async () => {
  const db    = await getDb();
  const world = loadWorldFromDb(db);

  // Simulate importing the cities txt file
  const entries = parseGridCitiesText(SAMPLE_TXT);
  importCities(world, entries, { tick: 0 });

  // Persist to SQLite (as triggerSave() does in the browser)
  saveWorldToDb(db, world);

  // Simulate a page reload: load fresh world from same DB
  const reloaded = loadWorldFromDb(db);

  assert.strictEqual(reloaded.estados.length, 5,
    'all 5 city estados should be present after reload');
});

test('city estado fields are preserved through DB round-trip', async () => {
  const db    = await getDb();
  const world = loadWorldFromDb(db);

  const entries = parseGridCitiesText('(170,70) -> Pevek');
  importCities(world, entries, { tick: 3 });
  saveWorldToDb(db, world);

  const reloaded = loadWorldFromDb(db);
  const pevek    = reloaded.estados.find(s => s.id === 'pevek');

  assert.ok(pevek, 'Pevek estado should survive DB round-trip');
  assert.strictEqual(pevek.nome,            'Pevek');
  assert.strictEqual(pevek.tipo,            'cidade');
  assert.strictEqual(pevek.parent_id,       '');
  assert.strictEqual(pevek.tick_registro,   3);
  assert.strictEqual(pevek.tick_saida,      0);
  assert.strictEqual(pevek.status_economico, 'estagnacao');
  assert.ok(pevek.atributos.populacao > 0,  'population should be set');
});

test('mapa cells are persisted to SQLite and survive reload', async () => {
  const db    = await getDb();
  const world = loadWorldFromDb(db);

  const entries = parseGridCitiesText('(170,70) -> Pevek');
  importCities(world, entries);
  saveWorldToDb(db, world);

  const reloaded = loadWorldFromDb(db);
  const cell     = reloaded.mapa['70']?.['170'];

  assert.ok(cell,    'mapa cell at lat=70,lon=170 should survive reload');
  assert.strictEqual(cell.estado_id, 'pevek');
  assert.strictEqual(cell.tipo,      'terra');
});

test('all 5 sample cities survive DB round-trip with correct ids', async () => {
  const db    = await getDb();
  const world = loadWorldFromDb(db);

  const entries = parseGridCitiesText(SAMPLE_TXT);
  importCities(world, entries, { tick: 0 });
  saveWorldToDb(db, world);

  const reloaded    = loadWorldFromDb(db);
  const estadoIds   = new Set(reloaded.estados.map(s => s.id));

  const expectedIds = ['pevek', 'anadyr', 'beringovskiy', 'sao_paulo', 'rio_de_janeiro'];
  for (const id of expectedIds) {
    assert.ok(estadoIds.has(id), `estado '${id}' should be present after reload`);
  }
});

// ── syncEstadosFromMapa on startup (mirrors initApp behaviour) ────────────────

test('syncEstadosFromMapa on startup finds no missing estados after txt import', async () => {
  const db    = await getDb();
  const world = loadWorldFromDb(db);

  // Import cities and save
  const entries = parseGridCitiesText(SAMPLE_TXT);
  importCities(world, entries);
  saveWorldToDb(db, world);

  // Simulate initApp startup:
  const reloaded = loadWorldFromDb(db);
  const { created } = syncEstadosFromMapa(reloaded, { tick: 0 });

  // importCities already created all estados, so syncEstadosFromMapa should
  // find zero missing ones.
  assert.deepStrictEqual(created, [],
    'syncEstadosFromMapa should not create any new estados on reload after txt import');
});

test('syncEstadosFromMapa on startup does not alter the estado count', async () => {
  const db    = await getDb();
  const world = loadWorldFromDb(db);

  const entries = parseGridCitiesText(SAMPLE_TXT);
  importCities(world, entries);
  saveWorldToDb(db, world);

  const reloaded       = loadWorldFromDb(db);
  const countBefore    = reloaded.estados.length;
  syncEstadosFromMapa(reloaded, { tick: 0 });
  const countAfter     = reloaded.estados.length;

  assert.strictEqual(countAfter, countBefore,
    'syncEstadosFromMapa should not change the estado count after a txt import');
});

// ── Idempotency with DB ───────────────────────────────────────────────────────

test('importing the same txt file twice does not duplicate estados in DB', async () => {
  const db    = await getDb();
  const world = loadWorldFromDb(db);

  const entries = parseGridCitiesText(SAMPLE_TXT);

  // First import
  importCities(world, entries);
  saveWorldToDb(db, world);

  // Second import (same file, same world)
  importCities(world, entries);
  saveWorldToDb(db, world);

  const reloaded = loadWorldFromDb(db);
  assert.strictEqual(reloaded.estados.length, 5,
    'should have exactly 5 estados even after importing the same file twice');
});

// ── renderEstadosTable preconditions ──────────────────────────────────────────

test('imported city estados have tick_saida=0 (visible in estados tab)', async () => {
  const db    = await getDb();
  const world = loadWorldFromDb(db);

  const entries = parseGridCitiesText(SAMPLE_TXT);
  importCities(world, entries);
  saveWorldToDb(db, world);

  const reloaded = loadWorldFromDb(db);
  for (const est of reloaded.estados) {
    assert.strictEqual(est.tick_saida, 0,
      `${est.id} should have tick_saida=0 so it is visible (not archived)`);
  }
});

test('imported city estados have all required display fields', async () => {
  const db    = await getDb();
  const world = loadWorldFromDb(db);

  const entries = parseGridCitiesText('(178,65) -> Anadyr');
  importCities(world, entries);
  saveWorldToDb(db, world);

  const reloaded = loadWorldFromDb(db);
  const anadyr   = reloaded.estados.find(s => s.id === 'anadyr');

  assert.ok(anadyr,                        'anadyr estado should exist');
  assert.ok(typeof anadyr.id === 'string', 'id should be a string');
  assert.ok(typeof anadyr.nome === 'string', 'nome should be a string');
  assert.ok(typeof anadyr.tipo === 'string', 'tipo should be a string');
  assert.ok(anadyr.atributos,              'atributos should exist');
  assert.ok(anadyr.impostos,               'impostos should exist');
  assert.ok(anadyr.financas,               'financas should exist');
  assert.ok(anadyr.infraestrutura !== undefined, 'infraestrutura should exist');
});
