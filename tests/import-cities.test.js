/**
 * import-cities.test.js — Tests for the grid_cities.txt import feature.
 *
 * Covers:
 *   - parseGridCitiesText: parsing, skipping invalid lines, bounds checking
 *   - slugifyNome: ID generation from city names
 *   - gerarPopulacao: population formula (range and distribution)
 *   - importCities: creation, no-duplication, coordinate association, updates
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  slugifyNome,
  parseGridCitiesText,
  gerarPopulacao,
  importCities,
} from '../src/core/import-cities.js';

// ── slugifyNome ───────────────────────────────────────────────────────────────

test('slugifyNome lowercases and strips diacritics', () => {
  assert.strictEqual(slugifyNome('São Paulo'), 'sao_paulo');
});

test('slugifyNome replaces spaces and special chars with underscores', () => {
  assert.strictEqual(slugifyNome('Rio de Janeiro'), 'rio_de_janeiro');
});

test('slugifyNome is idempotent', () => {
  const id = slugifyNome('Belo Horizonte');
  assert.strictEqual(slugifyNome('Belo Horizonte'), id);
  assert.strictEqual(id, 'belo_horizonte');
});

test('slugifyNome removes leading/trailing underscores', () => {
  const result = slugifyNome('  Brasília  ');
  assert.ok(!result.startsWith('_'));
  assert.ok(!result.endsWith('_'));
});

test('slugifyNome handles ASCII-only names', () => {
  assert.strictEqual(slugifyNome('Manaus'), 'manaus');
});

// ── parseGridCitiesText ───────────────────────────────────────────────────────

test('parseGridCitiesText parses a single valid line', () => {
  const text = '(-46,-23) -> São Paulo';
  const entries = parseGridCitiesText(text);
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].lon,  -46);
  assert.strictEqual(entries[0].lat,  -23);
  assert.strictEqual(entries[0].nome, 'São Paulo');
});

test('parseGridCitiesText parses multiple lines', () => {
  const text = [
    '(-46,-23) -> São Paulo',
    '(-43,-22) -> Rio de Janeiro',
    '(-48,-15) -> Brasília',
  ].join('\n');
  const entries = parseGridCitiesText(text);
  assert.strictEqual(entries.length, 3);
});

test('parseGridCitiesText skips blank lines', () => {
  const text = '(-46,-23) -> São Paulo\n\n(-43,-22) -> Rio de Janeiro';
  const entries = parseGridCitiesText(text);
  assert.strictEqual(entries.length, 2);
});

test('parseGridCitiesText skips comment lines starting with #', () => {
  const text = '# This is a comment\n(-46,-23) -> São Paulo';
  const entries = parseGridCitiesText(text);
  assert.strictEqual(entries.length, 1);
});

test('parseGridCitiesText skips lines that do not match the format', () => {
  const text = [
    'not a valid line',
    '(-46,-23) -> São Paulo',
    'also invalid',
  ].join('\n');
  const entries = parseGridCitiesText(text);
  assert.strictEqual(entries.length, 1);
});

test('parseGridCitiesText skips lines with out-of-range latitude (> 90)', () => {
  const entries = parseGridCitiesText('(-46,99) -> Cidade');
  assert.strictEqual(entries.length, 0);
});

test('parseGridCitiesText skips lines with out-of-range latitude (< -90)', () => {
  const entries = parseGridCitiesText('(-46,-91) -> Cidade');
  assert.strictEqual(entries.length, 0);
});

test('parseGridCitiesText skips lines with out-of-range longitude (> 180)', () => {
  const entries = parseGridCitiesText('(200,-23) -> Cidade');
  assert.strictEqual(entries.length, 0);
});

test('parseGridCitiesText skips lines with out-of-range longitude (< -180)', () => {
  const entries = parseGridCitiesText('(-200,-23) -> Cidade');
  assert.strictEqual(entries.length, 0);
});

test('parseGridCitiesText accepts boundary coordinates', () => {
  const text = [
    '(180,90) -> North Pole',
    '(-180,-90) -> South Pole',
  ].join('\n');
  const entries = parseGridCitiesText(text);
  assert.strictEqual(entries.length, 2);
  assert.strictEqual(entries[0].lon,  180);
  assert.strictEqual(entries[0].lat,   90);
  assert.strictEqual(entries[1].lon, -180);
  assert.strictEqual(entries[1].lat,  -90);
});

test('parseGridCitiesText tolerates spaces inside parentheses', () => {
  const entries = parseGridCitiesText('( -46 , -23 ) -> São Paulo');
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].lon, -46);
  assert.strictEqual(entries[0].lat, -23);
});

test('parseGridCitiesText returns empty array for empty text', () => {
  assert.deepStrictEqual(parseGridCitiesText(''), []);
});

test('parseGridCitiesText trims city names', () => {
  const entries = parseGridCitiesText('(-46,-23) ->   São Paulo   ');
  assert.strictEqual(entries[0].nome, 'São Paulo');
});

// ── gerarPopulacao ────────────────────────────────────────────────────────────

test('gerarPopulacao returns a number within the expected range', () => {
  for (let i = 0; i < 100; i++) {
    const pop = gerarPopulacao();
    assert.ok(pop >= 1_000,       `population ${pop} is below minimum 1000`);
    assert.ok(pop <= 10_000_000, `population ${pop} exceeds maximum 10000000`);
  }
});

test('gerarPopulacao result is a multiple of the power of ten', () => {
  // Formula: a * 10^(2+b) where a in [1,10], b in [1,4]
  // Result must be divisible by 1000 (10^3 minimum)
  const pop = gerarPopulacao();
  assert.strictEqual(pop % 1000, 0, `population ${pop} should be divisible by 1000`);
});

test('gerarPopulacao uses the provided rng', () => {
  // Sequence: a=1, b=1  → 1 * 10^3 = 1000
  let callCount = 0;
  const rng = () => {
    callCount++;
    return 0;  // floor(0 * 10)+1=1, floor(0 * 4)+1=1
  };
  const pop = gerarPopulacao(rng);
  assert.strictEqual(pop, 1000);
  assert.strictEqual(callCount, 2);
});

test('gerarPopulacao maximum: a=10, b=4 → 10 * 10^6 = 10_000_000', () => {
  // rng returns just below 1 to get max
  const rng = () => 0.9999;
  const pop = gerarPopulacao(rng);
  assert.strictEqual(pop, 10_000_000);
});

test('gerarPopulacao produces varied results', () => {
  const results = new Set();
  for (let i = 0; i < 40; i++) {
    results.add(gerarPopulacao());
  }
  // Expect more than 1 distinct value in 40 samples
  assert.ok(results.size > 1, 'expected varied population values');
});

// ── importCities — creation ───────────────────────────────────────────────────

function makeWorld() {
  return { estados: [], mapa: {} };
}

test('importCities creates a new estado when it does not exist', () => {
  const world   = makeWorld();
  const entries = [{ lat: -23, lon: -46, nome: 'São Paulo' }];
  importCities(world, entries);
  assert.strictEqual(world.estados.length, 1);
  assert.strictEqual(world.estados[0].id,   'sao_paulo');
  assert.strictEqual(world.estados[0].nome, 'São Paulo');
});

test('importCities sets tipo to "cidade" on new estado', () => {
  const world   = makeWorld();
  const entries = [{ lat: -23, lon: -46, nome: 'São Paulo' }];
  importCities(world, entries);
  assert.strictEqual(world.estados[0].tipo, 'cidade');
});

test('importCities sets parent_id to empty string on new estado', () => {
  const world   = makeWorld();
  const entries = [{ lat: -23, lon: -46, nome: 'São Paulo' }];
  importCities(world, entries);
  assert.strictEqual(world.estados[0].parent_id, '');
});

test('importCities sets population using gerarPopulacao formula', () => {
  const world   = makeWorld();
  const entries = [{ lat: -23, lon: -46, nome: 'São Paulo' }];
  // Fix rng so a=1, b=1 → pop=1000
  importCities(world, entries, { rng: () => 0 });
  assert.strictEqual(world.estados[0].atributos.populacao, 1000);
});

test('importCities returns created ids', () => {
  const world   = makeWorld();
  const entries = [
    { lat: -23, lon: -46, nome: 'São Paulo' },
    { lat: -22, lon: -43, nome: 'Rio de Janeiro' },
  ];
  const { created } = importCities(world, entries);
  assert.deepStrictEqual(created, ['sao_paulo', 'rio_de_janeiro']);
});

test('importCities does not duplicate an existing estado', () => {
  const world = {
    estados: [{
      id: 'sao_paulo', nome: 'São Paulo', tipo: 'cidade', parent_id: '',
      descricao: '', patrimonio: 0,
      atributos: { populacao: 5000, forcas_armadas: 1, cultura: 1, moral_populacao: 3 },
      impostos: { ir_pf: 0, ir_pj: 0, imp_prod: 0 },
      financas: { renda_tributaria: 0, salarios_politicos: 0, incentivos_empresas: 0, investimento_cultura: 0, investimento_fa: 0 },
      infraestrutura: {}, tick_registro: 0, tick_saida: 0,
      status_economico: 'estagnacao', fornecedores_ids: [], ativos: { patrimonio_geral: 0 },
    }],
    mapa: {},
  };
  const entries = [{ lat: -23, lon: -46, nome: 'São Paulo' }];
  importCities(world, entries);
  assert.strictEqual(world.estados.length, 1, 'should not duplicate the estado');
});

test('importCities preserves existing population when estado already exists', () => {
  const world = {
    estados: [{
      id: 'sao_paulo', nome: 'São Paulo', tipo: 'cidade', parent_id: '',
      descricao: '', patrimonio: 0,
      atributos: { populacao: 9999, forcas_armadas: 1, cultura: 1, moral_populacao: 3 },
      impostos: { ir_pf: 0, ir_pj: 0, imp_prod: 0 },
      financas: { renda_tributaria: 0, salarios_politicos: 0, incentivos_empresas: 0, investimento_cultura: 0, investimento_fa: 0 },
      infraestrutura: {}, tick_registro: 0, tick_saida: 0,
      status_economico: 'estagnacao', fornecedores_ids: [], ativos: { patrimonio_geral: 0 },
    }],
    mapa: {},
  };
  const entries = [{ lat: -23, lon: -46, nome: 'São Paulo' }];
  importCities(world, entries);
  assert.strictEqual(world.estados[0].atributos.populacao, 9999);
});

test('importCities does not include existing estado id in created list', () => {
  const world = {
    estados: [{
      id: 'sao_paulo', nome: 'São Paulo', tipo: 'cidade', parent_id: '',
      descricao: '', patrimonio: 0,
      atributos: { populacao: 5000, forcas_armadas: 1, cultura: 1, moral_populacao: 3 },
      impostos: { ir_pf: 0, ir_pj: 0, imp_prod: 0 },
      financas: { renda_tributaria: 0, salarios_politicos: 0, incentivos_empresas: 0, investimento_cultura: 0, investimento_fa: 0 },
      infraestrutura: {}, tick_registro: 0, tick_saida: 0,
      status_economico: 'estagnacao', fornecedores_ids: [], ativos: { patrimonio_geral: 0 },
    }],
    mapa: {},
  };
  const entries = [{ lat: -23, lon: -46, nome: 'São Paulo' }];
  const { created } = importCities(world, entries);
  assert.ok(!created.includes('sao_paulo'));
});

// ── importCities — coordinate association ────────────────────────────────────

test('importCities creates mapa cell at the given coordinates', () => {
  const world   = makeWorld();
  const entries = [{ lat: -23, lon: -46, nome: 'São Paulo' }];
  importCities(world, entries);
  const cell = world.mapa['-23']?.['-46'];
  assert.ok(cell, 'cell should be created');
  assert.strictEqual(cell.estado_id, 'sao_paulo');
});

test('importCities sets cell tipo to "terra"', () => {
  const world   = makeWorld();
  const entries = [{ lat: -23, lon: -46, nome: 'São Paulo' }];
  importCities(world, entries);
  assert.strictEqual(world.mapa['-23']['-46'].tipo, 'terra');
});

test('importCities does not overwrite cell when association is already correct', () => {
  const world = {
    estados: [{
      id: 'sao_paulo', nome: 'São Paulo', tipo: 'cidade', parent_id: '',
      descricao: '', patrimonio: 0,
      atributos: { populacao: 5000, forcas_armadas: 1, cultura: 1, moral_populacao: 3 },
      impostos: { ir_pf: 0, ir_pj: 0, imp_prod: 0 },
      financas: { renda_tributaria: 0, salarios_politicos: 0, incentivos_empresas: 0, investimento_cultura: 0, investimento_fa: 0 },
      infraestrutura: {}, tick_registro: 0, tick_saida: 0,
      status_economico: 'estagnacao', fornecedores_ids: [], ativos: { patrimonio_geral: 0 },
    }],
    mapa: { '-23': { '-46': { tipo: 'terra', estado_id: 'sao_paulo' } } },
  };
  const entries = [{ lat: -23, lon: -46, nome: 'São Paulo' }];
  const { updated } = importCities(world, entries);
  assert.ok(!updated.includes('sao_paulo'), 'should not be in updated when already correct');
});

test('importCities updates mapa when existing cell has wrong estado_id', () => {
  const world = {
    estados: [{
      id: 'sao_paulo', nome: 'São Paulo', tipo: 'cidade', parent_id: '',
      descricao: '', patrimonio: 0,
      atributos: { populacao: 5000, forcas_armadas: 1, cultura: 1, moral_populacao: 3 },
      impostos: { ir_pf: 0, ir_pj: 0, imp_prod: 0 },
      financas: { renda_tributaria: 0, salarios_politicos: 0, incentivos_empresas: 0, investimento_cultura: 0, investimento_fa: 0 },
      infraestrutura: {}, tick_registro: 0, tick_saida: 0,
      status_economico: 'estagnacao', fornecedores_ids: [], ativos: { patrimonio_geral: 0 },
    }],
    // sao_paulo is mapped to the wrong cell
    mapa: { '-22': { '-43': { tipo: 'terra', estado_id: 'sao_paulo' } } },
  };
  const entries = [{ lat: -23, lon: -46, nome: 'São Paulo' }];
  importCities(world, entries);
  // Old cell should no longer reference sao_paulo
  const oldCell = world.mapa['-22']?.['-43'];
  assert.ok(!oldCell || !oldCell.estado_id, 'stale cell should be cleared');
  // New cell should be set
  const newCell = world.mapa['-23']?.['-46'];
  assert.ok(newCell);
  assert.strictEqual(newCell.estado_id, 'sao_paulo');
});

test('importCities returns updated ids when mapa cell is new', () => {
  const world   = makeWorld();
  const entries = [{ lat: -23, lon: -46, nome: 'São Paulo' }];
  const { updated } = importCities(world, entries);
  assert.ok(updated.includes('sao_paulo'));
});

test('importCities is idempotent — running twice does not duplicate states or cells', () => {
  const world   = makeWorld();
  const entries = [{ lat: -23, lon: -46, nome: 'São Paulo' }];
  importCities(world, entries);
  importCities(world, entries);
  assert.strictEqual(world.estados.length, 1);
  // Only one cell should reference sao_paulo
  let count = 0;
  for (const row of Object.values(world.mapa)) {
    for (const cell of Object.values(row)) {
      if (cell.estado_id === 'sao_paulo') count++;
    }
  }
  assert.strictEqual(count, 1);
});

test('importCities handles multiple cities in one call', () => {
  const world   = makeWorld();
  const entries = [
    { lat: -23, lon: -46, nome: 'São Paulo' },
    { lat: -22, lon: -43, nome: 'Rio de Janeiro' },
    { lat: -15, lon: -48, nome: 'Brasília' },
  ];
  const { created } = importCities(world, entries);
  assert.strictEqual(world.estados.length, 3);
  assert.strictEqual(created.length, 3);
});

test('importCities uses the provided tick for tick_registro', () => {
  const world   = makeWorld();
  const entries = [{ lat: -23, lon: -46, nome: 'São Paulo' }];
  importCities(world, entries, { tick: 5 });
  assert.strictEqual(world.estados[0].tick_registro, 5);
});

test('importCities new estado has tick_saida = 0', () => {
  const world   = makeWorld();
  const entries = [{ lat: -23, lon: -46, nome: 'São Paulo' }];
  importCities(world, entries);
  assert.strictEqual(world.estados[0].tick_saida, 0);
});

test('importCities new estado has status_economico = "estagnacao"', () => {
  const world   = makeWorld();
  const entries = [{ lat: -23, lon: -46, nome: 'São Paulo' }];
  importCities(world, entries);
  assert.strictEqual(world.estados[0].status_economico, 'estagnacao');
});
