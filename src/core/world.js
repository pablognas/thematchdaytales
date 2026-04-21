/**
 * world.js — Convert between raw CSV rows and typed world objects, and back.
 */

/** @param {string} v @param {number} [fallback] @returns {number} */
function toNum(v, fallback = 0) {
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** @param {string|number|boolean} v @returns {boolean} */
function toBool(v) {
  return v === true || v === 1 || v === '1' || v === 'true';
}

/**
 * Parse raw CSV rows (from csv.js parseCsv) into typed pessoa objects.
 * @param {Object[]} rows
 * @returns {Object[]}
 */
export function rowsToPessoas(rows) {
  return rows.map(r => ({
    id: r.id,
    nome: r.nome,
    classe: r.classe,
    estado_id: r.estado_id || '',
    atributos: {
      influencia: toNum(r.influencia, 1),
      patrimonio: toNum(r.patrimonio, 1),
      moral:      toNum(r.moral, 3),
      reputacao:  toNum(r.reputacao, 1),
    },
    renda_mensal: toNum(r.renda_mensal, 0),
    caixa: toNum(r.caixa, 0),
    gastos_mensais_pagos: {
      influencia: toBool(r.gastos_influencia),
      moral:      toBool(r.gastos_moral),
      reputacao:  toBool(r.gastos_reputacao),
    },
  }));
}

/**
 * Serialize typed pessoa objects back to CSV-ready rows.
 * @param {Object[]} pessoas
 * @returns {Object[]}
 */
export function pessoasToRows(pessoas) {
  return pessoas.map(p => ({
    id: p.id,
    nome: p.nome,
    classe: p.classe,
    estado_id: p.estado_id,
    influencia: p.atributos.influencia,
    patrimonio: p.atributos.patrimonio,
    moral:      p.atributos.moral,
    reputacao:  p.atributos.reputacao,
    renda_mensal: p.renda_mensal,
    caixa: Math.round(p.caixa),
    gastos_influencia: p.gastos_mensais_pagos.influencia ? 1 : 0,
    gastos_moral:      p.gastos_mensais_pagos.moral      ? 1 : 0,
    gastos_reputacao:  p.gastos_mensais_pagos.reputacao  ? 1 : 0,
  }));
}

/**
 * Parse raw CSV rows into typed empresa objects.
 * @param {Object[]} rows
 * @returns {Object[]}
 */
export function rowsToEmpresas(rows) {
  return rows.map(r => ({
    id: r.id,
    nome: r.nome,
    dono_id: r.dono_id,
    estado_id: r.estado_id || '',
    atributos: {
      funcionarios:        toNum(r.funcionarios, 0),
      renda:               toNum(r.renda, 0),
      producao:            toNum(r.producao, 0),
      moral_corporativa:   toNum(r.moral_corporativa, 3),
      reputacao_corporativa: toNum(r.reputacao_corporativa, 3),
      lucro:               toNum(r.lucro, 0),
    },
    custos: {
      salario_funcionario: toNum(r.salario_funcionario, 0),
      manutencao:          toNum(r.manutencao, 0),
      insumos:             toNum(r.insumos, 0),
    },
  }));
}

/**
 * Serialize typed empresa objects back to CSV-ready rows.
 * @param {Object[]} empresas
 * @returns {Object[]}
 */
export function empresasToRows(empresas) {
  return empresas.map(e => ({
    id: e.id,
    nome: e.nome,
    dono_id: e.dono_id,
    estado_id: e.estado_id,
    funcionarios:          e.atributos.funcionarios,
    renda:                 e.atributos.renda,
    producao:              e.atributos.producao,
    moral_corporativa:     e.atributos.moral_corporativa,
    reputacao_corporativa: e.atributos.reputacao_corporativa,
    lucro:                 Math.round(e.atributos.lucro),
    salario_funcionario:   e.custos.salario_funcionario,
    manutencao:            e.custos.manutencao,
    insumos:               e.custos.insumos,
  }));
}

/**
 * Parse raw CSV rows into typed estado objects.
 * @param {Object[]} rows
 * @returns {Object[]}
 */
export function rowsToEstados(rows) {
  return rows.map(r => ({
    id: r.id,
    nome: r.nome,
    atributos: {
      populacao:      toNum(r.populacao, 0),
      forcas_armadas: toNum(r.forcas_armadas, 1),
      cultura:        toNum(r.cultura, 1),
      moral_populacao: toNum(r.moral_populacao, 3),
    },
    impostos: {
      ir_pf:    toNum(r.ir_pf, 0),
      ir_pj:    toNum(r.ir_pj, 0),
      imp_prod: toNum(r.imp_prod, 0),
    },
    financas: {
      renda_tributaria:    toNum(r.renda_tributaria, 0),
      salarios_politicos:  toNum(r.salarios_politicos, 0),
      incentivos_empresas: toNum(r.incentivos_empresas, 0),
      investimento_cultura: toNum(r.investimento_cultura, 0),
      investimento_fa:     toNum(r.investimento_fa, 0),
    },
  }));
}

/**
 * Serialize typed estado objects back to CSV-ready rows.
 * @param {Object[]} estados
 * @returns {Object[]}
 */
export function estadosToRows(estados) {
  return estados.map(s => ({
    id: s.id,
    nome: s.nome,
    populacao:           s.atributos.populacao,
    forcas_armadas:      s.atributos.forcas_armadas,
    cultura:             s.atributos.cultura,
    moral_populacao:     s.atributos.moral_populacao,
    renda_tributaria:    Math.round(s.financas.renda_tributaria),
    ir_pf:               s.impostos.ir_pf,
    ir_pj:               s.impostos.ir_pj,
    imp_prod:            s.impostos.imp_prod,
    salarios_politicos:  s.financas.salarios_politicos,
    incentivos_empresas: s.financas.incentivos_empresas,
    investimento_cultura: s.financas.investimento_cultura,
    investimento_fa:     s.financas.investimento_fa,
  }));
}
