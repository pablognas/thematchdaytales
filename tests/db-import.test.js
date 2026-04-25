/**
 * db-import.test.js — Tests for CSV → SQLite import (seedDbFromCsvText / initDb).
 *
 * Verifies that the seed import faithfully populates all entity tables from
 * CSV text without requiring a network connection or a real IndexedDB.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import initSqlJsNode from 'sql.js';

import {
  initDb,
  createSchema,
  seedDbFromCsvText,
  loadWorldFromDb,
  SCHEMA_VERSION,
} from '../src/core/db.js';

// ── Sample CSV fixtures ───────────────────────────────────────────────────────

const PESSOAS_CSV = [
  'id,nome,classe,estado_id,influencia,patrimonio,moral,reputacao,renda_mensal,caixa,gastos_influencia,gastos_moral,gastos_reputacao,nota_scouting,valor_mercado,posicao,clube,clube_emprestador',
  'jogador_01,Carlos Silva,jogador,estado_sp,3,5,4,3,0,100000,1,1,0,8.5,50000000,atacante,empresa_01,',
  'trabalhador_01,Maria Costa,trabalhador,estado_sp,1,1,3,1,2000,500,1,1,1,0,0,,,',
].join('\n');

const EMPRESAS_CSV = [
  'id,nome,dono_id,estado_id,patrimonio,funcionarios,renda,producao,moral_corporativa,reputacao_corporativa,lucro,salario_funcionario,manutencao,insumos',
  'empresa_01,Clube FC SA,trabalhador_01,estado_sp,5000000,50,200000,0,3,4,100000,2000,5000,0',
].join('\n');

const ESTADOS_CSV = [
  'id,nome,tipo,parent_id,descricao,patrimonio,populacao,forcas_armadas,cultura,moral_populacao,renda_tributaria,ir_pf,ir_pj,imp_prod,salarios_politicos,incentivos_empresas,investimento_cultura,investimento_fa',
  'brasil,Brasil,pais,,República Federativa do Brasil,50000000,210000000,5,4,3,50000000,0.15,0.20,0.10,200000,500000,200000,500000',
  'estado_sp,São Paulo,estado,brasil,Estado de SP,10000000,45000000,3,4,3,5000000,0.15,0.20,0.10,50000,100000,50000,100000',
].join('\n');

const ATIVOS_CSV = [
  'owner_type,owner_id,ativo_id,valor',
  'pessoa,jogador_01,imoveis,2000000',
  'pessoa,jogador_01,investimentos,500000',
  'empresa,empresa_01,infraestrutura,4000000',
  'estado,brasil,reservas,40000000',
].join('\n');

const MAPA_CSV = [
  'lat,lon,tipo,estado_id,bioma,clima',
  '-23,43,terra,estado_sp,mata_atlantica,subtropical',
  '0,0,agua,,,',
].join('\n');

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CSV → SQLite import', () => {
  let SQL;

  before(async () => {
    SQL = await initSqlJsNode();
  });

  test('seedDbFromCsvText imports estados correctly', () => {
    const db = new SQL.Database();
    createSchema(db);

    seedDbFromCsvText(db, { estados: ESTADOS_CSV });

    const { world } = loadWorldFromDb(db);
    assert.equal(world.estados.length, 2);

    const brasil = world.estados.find(s => s.id === 'brasil');
    assert.ok(brasil, 'brasil not found');
    assert.equal(brasil.nome, 'Brasil');
    assert.equal(brasil.tipo, 'pais');
    assert.equal(brasil.parent_id, '');
    assert.equal(brasil.atributos.populacao, 210000000);
    assert.equal(brasil.impostos.ir_pj, 0.20);
    assert.equal(brasil.financas.investimento_fa, 500000);
  });

  test('seedDbFromCsvText imports pessoas correctly', () => {
    const db = new SQL.Database();
    createSchema(db);

    seedDbFromCsvText(db, { pessoas: PESSOAS_CSV });

    const { world } = loadWorldFromDb(db);
    assert.equal(world.pessoas.length, 2);

    const jogador = world.pessoas.find(p => p.id === 'jogador_01');
    assert.ok(jogador, 'jogador_01 not found');
    assert.equal(jogador.nome,  'Carlos Silva');
    assert.equal(jogador.classe, 'jogador');
    assert.equal(jogador.nota_scouting, 8.5);
    assert.equal(jogador.valor_mercado, 50000000);
    assert.equal(jogador.posicao, 'atacante');
    assert.equal(jogador.clube,   'empresa_01');
    assert.equal(jogador.gastos_mensais_pagos.influencia, true);
    assert.equal(jogador.gastos_mensais_pagos.reputacao,  false);
  });

  test('seedDbFromCsvText imports empresas correctly', () => {
    const db = new SQL.Database();
    createSchema(db);

    seedDbFromCsvText(db, { empresas: EMPRESAS_CSV });

    const { world } = loadWorldFromDb(db);
    assert.equal(world.empresas.length, 1);

    const emp = world.empresas[0];
    assert.equal(emp.id,   'empresa_01');
    assert.equal(emp.nome, 'Clube FC SA');
    assert.equal(emp.atributos.funcionarios, 50);
    assert.equal(emp.custos.salario_funcionario, 2000);
  });

  test('seedDbFromCsvText applies ativos to entities', () => {
    const db = new SQL.Database();
    createSchema(db);

    seedDbFromCsvText(db, {
      pessoas:  PESSOAS_CSV,
      empresas: EMPRESAS_CSV,
      estados:  ESTADOS_CSV,
      ativos:   ATIVOS_CSV,
    });

    const { world } = loadWorldFromDb(db);

    const jogador = world.pessoas.find(p => p.id === 'jogador_01');
    assert.ok(jogador, 'jogador_01 not found');
    assert.equal(jogador.ativos.imoveis,      2000000);
    assert.equal(jogador.ativos.investimentos, 500000);
    // patrimonio should equal sum of ativos
    assert.equal(jogador.atributos.patrimonio, 2500000);

    const empresa = world.empresas.find(e => e.id === 'empresa_01');
    assert.ok(empresa, 'empresa_01 not found');
    assert.equal(empresa.ativos.infraestrutura, 4000000);
    assert.equal(empresa.patrimonio, 4000000);

    const brasil = world.estados.find(s => s.id === 'brasil');
    assert.ok(brasil, 'brasil not found');
    assert.equal(brasil.ativos.reservas, 40000000);
    assert.equal(brasil.patrimonio, 40000000);
  });

  test('seedDbFromCsvText imports mapa cells correctly', () => {
    const db = new SQL.Database();
    createSchema(db);

    seedDbFromCsvText(db, { mapa: MAPA_CSV });

    const { mapaWorld } = loadWorldFromDb(db);

    // terra cell at (-23, 43)
    const cell = mapaWorld['-23']?.['43'];
    assert.ok(cell, 'mapa cell (-23, 43) not found');
    assert.equal(cell.tipo,      'terra');
    assert.equal(cell.estado_id, 'estado_sp');
    assert.equal(cell.bioma,     'mata_atlantica');
  });

  test('initDb with csvSeeds and skipIdb creates a seeded database', async () => {
    const db = await initDb({
      sqlJs: SQL,
      skipIdb: true,
      csvSeeds: {
        pessoas:  PESSOAS_CSV,
        empresas: EMPRESAS_CSV,
        estados:  ESTADOS_CSV,
        ativos:   ATIVOS_CSV,
        mapa:     MAPA_CSV,
      },
    });

    const { world, mapaWorld } = loadWorldFromDb(db);

    assert.equal(world.pessoas.length,  2, 'should have 2 pessoas');
    assert.equal(world.empresas.length, 1, 'should have 1 empresa');
    assert.equal(world.estados.length,  2, 'should have 2 estados');

    // Verify mapa was imported
    const cell = mapaWorld['-23']?.['43'];
    assert.ok(cell, 'mapa cell should be present');
  });

  test('initDb without csvSeeds creates an empty database with correct schema version', async () => {
    const db = await initDb({
      sqlJs: SQL,
      skipIdb: true,
      csvSeeds: {},
    });

    const result = db.exec('SELECT version FROM schema_version');
    assert.equal(result[0].values[0][0], SCHEMA_VERSION);

    const { world } = loadWorldFromDb(db);
    assert.equal(world.pessoas.length,  0);
    assert.equal(world.empresas.length, 0);
    assert.equal(world.estados.length,  0);
  });

  test('seedDbFromCsvText with empty strings results in empty tables', () => {
    const db = new SQL.Database();
    createSchema(db);

    seedDbFromCsvText(db, { pessoas: '', empresas: '', estados: '', ativos: '', mapa: '' });

    const { world } = loadWorldFromDb(db);
    assert.equal(world.pessoas.length,  0);
    assert.equal(world.empresas.length, 0);
    assert.equal(world.estados.length,  0);
  });
});
