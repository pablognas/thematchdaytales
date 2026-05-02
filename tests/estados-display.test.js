/**
 * estados-display.test.js — Tests for the "imported estados visible in tab" fix.
 *
 * Root-cause summary
 * ------------------
 * Previous PRs fixed persistence, but the estados tab still showed nothing
 * because:
 *
 *   1. `renderEstadosTable()` was called AFTER `triggerSave()` in the import
 *      handlers.  If `triggerSave()` ever threw (e.g. on a DB write error or
 *      when an existing estado in world.estados was missing a nested sub-object),
 *      the estados tab never got re-rendered — even though the states were
 *      visible in `world.estados` (and therefore in transfers/scheduling/duplicate
 *      check which all read from the in-memory array).
 *
 *   2. There was no `renderEstadosTable()` call in the tab click handler for the
 *      estados tab, so navigating to it after the import didn't guarantee a
 *      fresh render.
 *
 *   3. `estadosToRows()` accessed nested fields (atributos, financas, impostos)
 *      without guards — a single estado with missing sub-objects would abort the
 *      entire save and leave all subsequent imports un-rendered.
 *
 * The new `normalizeEstado()` helper (world.js) ensures every required field is
 * present before serialization or rendering, and is now called from:
 *   • `rowsToEstados`  (DB load)
 *   • `estadosToRows`  (DB save)
 *   • `importCities`   (txt import)
 *   • `syncEstadosFromMapa` (mapa.csv import)
 *
 * These tests cover:
 *   - normalizeEstado: fills defaults for totally bare objects
 *   - normalizeEstado: does not overwrite good values
 *   - estadosToRows: does not throw for bare estados (missing atributos/financas)
 *   - renderEstadosTable preconditions: after import, states are visible (tick_saida=0)
 *   - full round-trip including normalizeEstado applied via rowsToEstados
 *   - syncEstadosFromMapa: all created states pass the display filter
 *   - importCities: all created states pass the display filter
 */

import { test } from 'node:test';
import assert  from 'node:assert/strict';

import {
  normalizeEstado,
  rowsToEstados,
  estadosToRows,
} from '../src/core/world.js';

import {
  parseGridCitiesText,
  importCities,
  syncEstadosFromMapa,
} from '../src/core/import-cities.js';

// ── normalizeEstado ───────────────────────────────────────────────────────────

test('normalizeEstado fills all required sub-objects for a bare estado', () => {
  const bare = { id: 'x', nome: 'X' };
  const n    = normalizeEstado(bare);  // n === bare (mutated in-place, same reference)

  assert.ok(n.atributos,    'atributos should be created');
  assert.ok(n.financas,     'financas should be created');
  assert.ok(n.impostos,     'impostos should be created');
  assert.ok(n.infraestrutura !== undefined, 'infraestrutura should be created');
  assert.ok(Array.isArray(n.fornecedores_ids), 'fornecedores_ids should be an array');
  assert.ok(n.ativos !== undefined, 'ativos should be created');
  assert.strictEqual(n.tick_saida,       0,            'tick_saida should default to 0');
  assert.strictEqual(n.tick_registro,    0,            'tick_registro should default to 0');
  assert.strictEqual(n.status_economico, 'estagnacao', 'status_economico should default');
  assert.strictEqual(n.tipo,      '', 'tipo should default to empty string');
  assert.strictEqual(n.parent_id, '', 'parent_id should default to empty string');
  assert.strictEqual(n.descricao, '', 'descricao should default to empty string');
  assert.strictEqual(n.patrimonio, 0,  'patrimonio should default to 0');
});

test('normalizeEstado fills atributos sub-fields for a partial atributos object', () => {
  const partial = { id: 'y', nome: 'Y', atributos: {} };
  const n       = normalizeEstado(partial);

  assert.strictEqual(n.atributos.populacao,       0, 'populacao defaults to 0');
  assert.strictEqual(n.atributos.forcas_armadas,  1, 'forcas_armadas defaults to 1');
  assert.strictEqual(n.atributos.cultura,         1, 'cultura defaults to 1');
  assert.strictEqual(n.atributos.moral_populacao, 3, 'moral_populacao defaults to 3');
});

test('normalizeEstado does not overwrite existing correct values', () => {
  const good = {
    id:     'z',
    nome:   'Z',
    tipo:   'pais',
    atributos: { populacao: 999, forcas_armadas: 5, cultura: 4, moral_populacao: 2 },
    financas:  { renda_tributaria: 100, salarios_politicos: 50, incentivos_empresas: 0, investimento_cultura: 10, investimento_fa: 5 },
    impostos:  { ir_pf: 0.15, ir_pj: 0.25, imp_prod: 0.1 },
    infraestrutura: { aeroporto: true },
    fornecedores_ids: ['e1'],
    ativos:   { patrimonio_geral: 500 },
    tick_saida:    3,
    tick_registro: 1,
    status_economico: 'crescimento',
    parent_id: 'p1',
    descricao: 'a state',
    patrimonio: 1234,
  };
  normalizeEstado(good);

  assert.strictEqual(good.atributos.populacao,  999,         'populacao preserved');
  assert.strictEqual(good.financas.renda_tributaria, 100,    'renda_tributaria preserved');
  assert.strictEqual(good.impostos.ir_pf,       0.15,        'ir_pf preserved');
  assert.strictEqual(good.infraestrutura.aeroporto, true,    'infraestrutura preserved');
  assert.deepStrictEqual(good.fornecedores_ids, ['e1'],      'fornecedores_ids preserved');
  assert.strictEqual(good.ativos.patrimonio_geral, 500,      'ativos preserved');
  assert.strictEqual(good.tick_saida,    3,                  'tick_saida preserved');
  assert.strictEqual(good.tick_registro, 1,                  'tick_registro preserved');
  assert.strictEqual(good.status_economico, 'crescimento',   'status_economico preserved');
  assert.strictEqual(good.tipo,      'pais',                 'tipo preserved');
  assert.strictEqual(good.parent_id, 'p1',                   'parent_id preserved');
  assert.strictEqual(good.descricao, 'a state',              'descricao preserved');
  assert.strictEqual(good.patrimonio, 1234,                  'patrimonio preserved');
});

test('normalizeEstado returns the same object (mutates in-place)', () => {
  const est = { id: 'a', nome: 'A' };
  const result = normalizeEstado(est);
  assert.strictEqual(result, est, 'normalizeEstado should return the same object reference');
});

// ── estadosToRows: no throw for bare estados ──────────────────────────────────

test('estadosToRows does not throw for a bare estado missing atributos and financas', () => {
  const bare = [{ id: 'bare', nome: 'Bare' }];
  assert.doesNotThrow(
    () => estadosToRows(bare),
    'estadosToRows should not throw even for a bare estado object',
  );
});

test('estadosToRows does not throw for a estado with null atributos', () => {
  const est = [{ id: 'x', nome: 'X', atributos: null, financas: null }];
  assert.doesNotThrow(
    () => estadosToRows(est),
    'estadosToRows should handle null atributos/financas without throwing',
  );
});

test('estadosToRows with a mixed array (some bare, some full) produces rows for all', () => {
  const bare  = { id: 'bare',  nome: 'Bare' };
  const full  = {
    id: 'full', nome: 'Full',
    tipo: 'pais', parent_id: '', descricao: '', patrimonio: 0,
    atributos: { populacao: 100, forcas_armadas: 1, cultura: 1, moral_populacao: 3 },
    impostos:  { ir_pf: 0, ir_pj: 0, imp_prod: 0 },
    financas:  { renda_tributaria: 0, salarios_politicos: 0, incentivos_empresas: 0, investimento_cultura: 0, investimento_fa: 0 },
    infraestrutura: {}, tick_registro: 1, tick_saida: 0,
    status_economico: 'estagnacao', fornecedores_ids: [], ativos: {},
  };
  let rows;
  assert.doesNotThrow(() => { rows = estadosToRows([bare, full]); });
  assert.strictEqual(rows.length, 2, 'should produce one row per estado regardless of missing fields');
});

// ── Display filter precondition: tick_saida === 0 ─────────────────────────────

test('importCities: all created estados have tick_saida=0 (visible in tab)', () => {
  const world   = { estados: [], mapa: {} };
  const entries = parseGridCitiesText([
    '(170,70) -> Pevek',
    '(178,65) -> Anadyr',
    '(-46,-23) -> São Paulo',
  ].join('\n'));
  importCities(world, entries, { tick: 1 });

  const visible = world.estados.filter(s => !s.tick_saida);
  assert.strictEqual(
    visible.length, world.estados.length,
    'every imported city estado must pass the tick_saida=0 filter used by renderEstadosTable',
  );
});

test('syncEstadosFromMapa: all created estados have tick_saida=0 (visible in tab)', () => {
  const world = {
    estados: [],
    mapa: {
      '10': { '20': { tipo: 'terra', estado_id: 'br_sp' } },
      '11': { '21': { tipo: 'terra', estado_id: 'br_rj' } },
    },
  };
  syncEstadosFromMapa(world, { tick: 5 });

  const visible = world.estados.filter(s => !s.tick_saida);
  assert.strictEqual(
    visible.length, world.estados.length,
    'every synced estado must pass the tick_saida=0 filter used by renderEstadosTable',
  );
});

// ── Required display fields present after import + DB round-trip ──────────────

test('importCities: created estado has all required fields for renderEstadosTable', () => {
  const world   = { estados: [], mapa: {} };
  const entries = parseGridCitiesText('(170,70) -> Pevek');
  importCities(world, entries, { tick: 2 });

  const est = world.estados[0];
  assert.ok(est,                              'estado should exist');
  assert.ok(typeof est.id    === 'string',    'id should be a non-empty string');
  assert.ok(typeof est.nome  === 'string',    'nome should be a string');
  assert.ok(typeof est.tipo  === 'string',    'tipo should be a string');
  assert.ok(est.atributos,                    'atributos sub-object must be present');
  assert.ok(est.financas,                     'financas sub-object must be present');
  assert.ok(est.impostos,                     'impostos sub-object must be present');
  assert.ok(est.infraestrutura !== undefined, 'infraestrutura must be present');
  assert.strictEqual(est.tick_saida,    0,    'tick_saida must be 0 (not archived)');
  assert.strictEqual(est.tick_registro, 2,    'tick_registro should match import tick');
  assert.strictEqual(est.nome, 'Pevek',       'nome should be the human-readable city name');
  assert.strictEqual(est.id,   'pevek',       'id should be slugified city name');
});

test('syncEstadosFromMapa: created estado has all required fields for renderEstadosTable', () => {
  const world = {
    estados: [],
    mapa: { '10': { '20': { tipo: 'terra', estado_id: 'test_state' } } },
  };
  syncEstadosFromMapa(world, { tick: 7 });

  const est = world.estados[0];
  assert.ok(est,                              'estado should exist');
  assert.ok(est.atributos,                    'atributos sub-object must be present');
  assert.ok(est.financas,                     'financas sub-object must be present');
  assert.ok(est.impostos,                     'impostos sub-object must be present');
  assert.ok(est.infraestrutura !== undefined, 'infraestrutura must be present');
  assert.strictEqual(est.tick_saida, 0,       'tick_saida must be 0');
  assert.strictEqual(est.tick_registro, 7,    'tick_registro should match sync tick');
});

test('rowsToEstados: loaded estado has all required fields for renderEstadosTable', () => {
  // Simulate a minimal DB row as sql.js would return it.
  const minimalRow = {
    id: 'test_id', nome: 'Test Name',
    tipo: '', parent_id: '', descricao: '',
    patrimonio: 0,
    populacao: 100, forcas_armadas: 1, cultura: 1, moral_populacao: 3,
    renda_tributaria: 0, ir_pf: 0, ir_pj: 0, imp_prod: 0,
    salarios_politicos: 0, incentivos_empresas: 0,
    investimento_cultura: 0, investimento_fa: 0,
    infra_creche: 0, infra_escola_primaria: 0, infra_escola_secundaria: 0,
    infra_ensino_medio: 0, infra_universidade: 0, infra_rodoviaria: 0,
    infra_aeroporto: 0, infra_porto: 0, infra_estacao_trem: 0,
    infra_metro: 0, infra_onibus_municipais: 0, infra_centro_comercial: 0,
    tick_registro: 0, tick_saida: 0,
    status_economico: 'estagnacao', fornecedores_ids: '[]',
  };
  const [est] = rowsToEstados([minimalRow]);

  assert.ok(est.atributos,                    'atributos must be present after rowsToEstados');
  assert.ok(est.financas,                     'financas must be present after rowsToEstados');
  assert.ok(est.impostos,                     'impostos must be present after rowsToEstados');
  assert.ok(est.infraestrutura !== undefined, 'infraestrutura must be present after rowsToEstados');
  assert.strictEqual(est.tick_saida, 0,       'tick_saida must be 0');
  assert.strictEqual(est.nome, 'Test Name',   'nome must be preserved');
  assert.strictEqual(est.atributos.populacao, 100, 'populacao from row must be preserved');
});

// ── estadosToRows + rowsToEstados: safe round-trip for bare objects ────────────

test('estadosToRows + rowsToEstados round-trip for a bare estado produces valid display object', () => {
  const bare   = [{ id: 'bare', nome: 'Bare City' }];
  const rows   = estadosToRows(bare);
  const loaded = rowsToEstados(rows);

  assert.strictEqual(loaded.length, 1);
  const est = loaded[0];
  assert.strictEqual(est.id,   'bare',       'id should be preserved');
  assert.strictEqual(est.nome, 'Bare City',  'nome should be preserved');
  assert.strictEqual(est.tick_saida, 0,      'tick_saida should be 0 after round-trip');
  assert.ok(est.atributos,                   'atributos should exist after round-trip');
  assert.ok(est.financas,                    'financas should exist after round-trip');
});

test('atributos.populacao round-trips correctly through estadosToRows + rowsToEstados', () => {
  const est = {
    id: 'br', nome: 'Brasil',
    atributos: { populacao: 210000000, forcas_armadas: 5, cultura: 4, moral_populacao: 3 },
    financas:  { renda_tributaria: 0, salarios_politicos: 0, incentivos_empresas: 0, investimento_cultura: 0, investimento_fa: 0 },
    impostos:  { ir_pf: 0, ir_pj: 0, imp_prod: 0 },
    infraestrutura: {}, tick_registro: 1, tick_saida: 0,
    status_economico: 'estagnacao', fornecedores_ids: [], ativos: {}, patrimonio: 0,
    tipo: 'pais', parent_id: '', descricao: '',
  };
  const rows   = estadosToRows([est]);
  const loaded = rowsToEstados(rows);

  assert.strictEqual(loaded[0].atributos.populacao, 210000000,
    'atributos.populacao should round-trip correctly through estadosToRows + rowsToEstados');
});

// ── The "estados appear in transfers but not in tab" scenario ─────────────────
//
// This set of tests directly validates the root cause: states that exist in
// world.estados (and thus appear in all in-memory lookups like transfers and the
// duplicate-id check) must also pass the renderEstadosTable visibility filter.
//
// renderEstadosTable uses:   world.estados.filter(x => !x.tick_saida)
// populateTransferSelects uses: world.estados (no filter)
//
// If tick_saida were non-zero on imported states, they would appear in
// transfers but be invisible in the estados tab.

test('after importCities: states visible via in-memory filter match tab filter', () => {
  const world   = { estados: [], mapa: {} };
  const entries = parseGridCitiesText([
    '(170,70) -> Pevek',
    '(178,65) -> Anadyr',
  ].join('\n'));
  importCities(world, entries, { tick: 1 });

  // Simulates the transfers/scheduling lookup (no filter — all states)
  const allStates = world.estados;

  // Simulates renderEstadosTable's active filter
  const tabVisible = world.estados.filter(s => !s.tick_saida);

  assert.strictEqual(
    tabVisible.length, allStates.length,
    'all imported estados visible in transfers must also be visible in the estados tab',
  );
});

test('after syncEstadosFromMapa: states visible via in-memory filter match tab filter', () => {
  const world = {
    estados: [],
    mapa: {
      '10': { '20': { tipo: 'terra', estado_id: 'br_sp'  } },
      '11': { '21': { tipo: 'terra', estado_id: 'br_rj'  } },
      '12': { '22': { tipo: 'terra', estado_id: 'br_bsb' } },
    },
  };
  syncEstadosFromMapa(world, { tick: 3 });

  const allStates  = world.estados;
  const tabVisible = world.estados.filter(s => !s.tick_saida);

  assert.strictEqual(
    tabVisible.length, allStates.length,
    'all synced estados visible in transfers must also be visible in the estados tab',
  );
});

test('after DB round-trip: imported states remain visible via tab filter', () => {
  // Build a minimal world with imported cities and run through estadosToRows + rowsToEstados
  const world   = { estados: [], mapa: {} };
  const entries = parseGridCitiesText([
    '(170,70) -> Pevek',
    '(-46,-23) -> São Paulo',
  ].join('\n'));
  importCities(world, entries, { tick: 1 });

  // Simulate saveWorldToDb + loadWorldFromDb using only the world.js helpers
  const rows   = estadosToRows(world.estados);
  const loaded = rowsToEstados(rows);

  const tabVisible = loaded.filter(s => !s.tick_saida);
  assert.strictEqual(
    tabVisible.length, loaded.length,
    'after DB round-trip all estados should remain visible in the estados tab filter',
  );
  assert.strictEqual(tabVisible.length, 2, 'should have exactly 2 visible estados');
});
