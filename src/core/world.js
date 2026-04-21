/**
 * world.js — Convert between raw CSV rows and typed world objects, and back.
 *
 * Ativos (assets) are stored in a separate ativos.csv with schema:
 *   owner_type, owner_id, ativo_id, valor
 * Use applyAtivos() after loading all CSVs to merge them into the world objects.
 * Use worldAtivosToRows() to serialize them back to CSV rows.
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

// ── Pessoas ───────────────────────────────────────────────────────────────

/**
 * Parse raw CSV rows (from csv.js parseCsv) into typed pessoa objects.
 * Each pessoa gets a default ativos dict; call applyAtivos() to override from ativos.csv.
 * @param {Object[]} rows
 * @returns {Object[]}
 */
export function rowsToPessoas(rows) {
  return rows.map(r => {
    const patrimonio = toNum(r.patrimonio, 1);
    return {
      id: r.id,
      nome: r.nome,
      classe: r.classe,
      estado_id: r.estado_id || '',
      atributos: {
        influencia: toNum(r.influencia, 1),
        patrimonio,
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
      // Default ativos: single entry matching patrimonio
      ativos: { patrimonio_geral: patrimonio },
    };
  });
}

/**
 * Serialize typed pessoa objects back to CSV-ready rows.
 * Note: ativos are serialized separately via worldAtivosToRows().
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

// ── Empresas ──────────────────────────────────────────────────────────────

/**
 * Parse raw CSV rows into typed empresa objects.
 * Includes patrimonio field; ativos default to { patrimonio_geral: patrimonio }.
 * @param {Object[]} rows
 * @returns {Object[]}
 */
export function rowsToEmpresas(rows) {
  return rows.map(r => {
    const patrimonio = toNum(r.patrimonio, 0);
    return {
      id: r.id,
      nome: r.nome,
      dono_id: r.dono_id,
      estado_id: r.estado_id || '',
      patrimonio,
      atributos: {
        funcionarios:          toNum(r.funcionarios, 0),
        renda:                 toNum(r.renda, 0),
        producao:              toNum(r.producao, 0),
        moral_corporativa:     toNum(r.moral_corporativa, 3),
        reputacao_corporativa: toNum(r.reputacao_corporativa, 3),
        lucro:                 toNum(r.lucro, 0),
      },
      custos: {
        salario_funcionario: toNum(r.salario_funcionario, 0),
        manutencao:          toNum(r.manutencao, 0),
        insumos:             toNum(r.insumos, 0),
      },
      ativos: { patrimonio_geral: patrimonio },
    };
  });
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
    patrimonio:            Math.round(e.patrimonio || 0),
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

// ── Estados ───────────────────────────────────────────────────────────────

/**
 * Parse raw CSV rows into typed estado objects.
 * Includes patrimonio field; ativos default to { patrimonio_geral: patrimonio }.
 * @param {Object[]} rows
 * @returns {Object[]}
 */
export function rowsToEstados(rows) {
  return rows.map(r => {
    const patrimonio = toNum(r.patrimonio, 0);
    return {
      id: r.id,
      nome: r.nome,
      patrimonio,
      atributos: {
        populacao:       toNum(r.populacao, 0),
        forcas_armadas:  toNum(r.forcas_armadas, 1),
        cultura:         toNum(r.cultura, 1),
        moral_populacao: toNum(r.moral_populacao, 3),
      },
      impostos: {
        ir_pf:    toNum(r.ir_pf, 0),
        ir_pj:    toNum(r.ir_pj, 0),
        imp_prod: toNum(r.imp_prod, 0),
      },
      financas: {
        renda_tributaria:     toNum(r.renda_tributaria, 0),
        salarios_politicos:   toNum(r.salarios_politicos, 0),
        incentivos_empresas:  toNum(r.incentivos_empresas, 0),
        investimento_cultura: toNum(r.investimento_cultura, 0),
        investimento_fa:      toNum(r.investimento_fa, 0),
      },
      ativos: { patrimonio_geral: patrimonio },
    };
  });
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
    patrimonio:           Math.round(s.patrimonio || 0),
    populacao:            s.atributos.populacao,
    forcas_armadas:       s.atributos.forcas_armadas,
    cultura:              s.atributos.cultura,
    moral_populacao:      s.atributos.moral_populacao,
    renda_tributaria:     Math.round(s.financas.renda_tributaria),
    ir_pf:                s.impostos.ir_pf,
    ir_pj:                s.impostos.ir_pj,
    imp_prod:             s.impostos.imp_prod,
    salarios_politicos:   s.financas.salarios_politicos,
    incentivos_empresas:  s.financas.incentivos_empresas,
    investimento_cultura: s.financas.investimento_cultura,
    investimento_fa:      s.financas.investimento_fa,
  }));
}

// ── Ativos helpers ────────────────────────────────────────────────────────

/**
 * Merge ativos CSV rows into world entities.
 * For each entity whose ativos are found in ativosRows:
 *   - entity.ativos is replaced with the loaded dict
 *   - patrimonio is recomputed as the sum of all ativo values
 * Entities without an entry in ativosRows keep their default ativos.
 *
 * @param {{ pessoas: Object[], empresas: Object[], estados: Object[] }} world
 * @param {Object[]} ativosRows  rows from parseCsv(ativos.csv)
 */
export function applyAtivos(world, ativosRows) {
  // Build map: "type:id" -> { ativo_id: valor }
  const map = new Map();
  for (const row of ativosRows) {
    const key = `${row.owner_type}:${row.owner_id}`;
    if (!map.has(key)) map.set(key, {});
    map.get(key)[row.ativo_id] = toNum(row.valor, 0);
  }

  const apply = (entities, type, isPatrimonioAtributo) => {
    for (const entity of entities) {
      const key = `${type}:${entity.id}`;
      if (!map.has(key)) continue;
      entity.ativos = map.get(key);
      const sum = Object.values(entity.ativos).reduce((a, b) => a + b, 0);
      if (isPatrimonioAtributo) {
        entity.atributos.patrimonio = sum;
      } else {
        entity.patrimonio = sum;
      }
    }
  };

  apply(world.pessoas,  'pessoa',  true);
  apply(world.empresas, 'empresa', false);
  apply(world.estados,  'estado',  false);
}

/**
 * Serialize all entity ativos to CSV rows for ativos.csv.
 * @param {{ pessoas: Object[], empresas: Object[], estados: Object[] }} world
 * @returns {Object[]}
 */
export function worldAtivosToRows(world) {
  const rows = [];
  const add = (entities, type) => {
    for (const entity of entities) {
      for (const [ativo_id, valor] of Object.entries(entity.ativos || {})) {
        rows.push({ owner_type: type, owner_id: entity.id, ativo_id, valor: Math.round(valor) });
      }
    }
  };
  add(world.pessoas,  'pessoa');
  add(world.empresas, 'empresa');
  add(world.estados,  'estado');
  return rows;
}

/**
 * Recompute an entity's patrimonio field from the sum of its ativos values.
 * For pessoas, patrimonio lives in entity.atributos.patrimonio.
 * For empresas/estados, it lives in entity.patrimonio.
 *
 * @param {Object} entity
 * @param {'pessoa'|'empresa'|'estado'} type
 */
export function reconcilePatrimonio(entity, type) {
  const sum = Object.values(entity.ativos || {}).reduce((a, b) => a + b, 0);
  if (type === 'pessoa') {
    entity.atributos.patrimonio = sum;
  } else {
    entity.patrimonio = sum;
  }
}
