/**
 * world.js — Convert between raw CSV rows and typed world objects, and back.
 *
 * Ativos (assets) are stored in a separate ativos.csv with schema:
 *   owner_type, owner_id, ativo_id, valor
 * Use applyAtivos() after loading all CSVs to merge them into the world objects.
 * Use worldAtivosToRows() to serialize them back to CSV rows.
 */

// ── Infraestrutura ────────────────────────────────────────────────────────────

/** Ordered list of infrastructure type keys used for empresa and estado. */
export const INFRAESTRUTURA_TIPOS = [
  'creche',
  'escola_primaria',
  'escola_secundaria',
  'ensino_medio',
  'universidade',
  'rodoviaria',
  'aeroporto',
  'porto',
  'estacao_trem',
  'metro',
  'onibus_municipais',
  'centro_comercial',
];

/** Human-readable labels for each infrastructure type. */
export const INFRAESTRUTURA_LABEL = {
  creche:            'Creche',
  escola_primaria:   'Escola Primária',
  escola_secundaria: 'Escola Secundária',
  ensino_medio:      'Ensino Médio',
  universidade:      'Universidade',
  rodoviaria:        'Rodoviária',
  aeroporto:         'Aeroporto',
  porto:             'Porto',
  estacao_trem:      'Estação de Trem',
  metro:             'Metrô',
  onibus_municipais: 'Ônibus Municipais',
  centro_comercial:  'Centro Comercial',
};

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
 * Parse a JSON-encoded list of IDs, defaulting to an empty array on error.
 * @param {string|null|undefined} v
 * @returns {string[]}
 */
function toIdList(v) {
  if (!v || v === '' || v === '[]') return [];
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch (_) {
    return [];
  }
}

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
      peso: toNum(r.peso, 1),
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
      nota_scouting:     toNum(r.nota_scouting, 0),
      valor_mercado:     toNum(r.valor_mercado, 0),
      posicao:           r.posicao           || '',
      clube:             r.clube             || '',
      clube_emprestador: r.clube_emprestador || '',
      tick_registro:     toNum(r.tick_registro, 0),
      tick_saida:        toNum(r.tick_saida,    0),
      status_economico:  r.status_economico  || 'estagnacao',
      fornecedores_ids:  toIdList(r.fornecedores_ids),
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
    peso: p.peso ?? 1,
    influencia: p.atributos.influencia,
    patrimonio: p.atributos.patrimonio,
    moral:      p.atributos.moral,
    reputacao:  p.atributos.reputacao,
    renda_mensal: p.renda_mensal,
    caixa: Math.round(p.caixa),
    gastos_influencia: p.gastos_mensais_pagos.influencia ? 1 : 0,
    gastos_moral:      p.gastos_mensais_pagos.moral      ? 1 : 0,
    gastos_reputacao:  p.gastos_mensais_pagos.reputacao  ? 1 : 0,
    nota_scouting:     p.nota_scouting || 0,
    valor_mercado:     p.valor_mercado  || 0,
    posicao:           p.posicao           || '',
    clube:             p.clube             || '',
    clube_emprestador: p.clube_emprestador || '',
    tick_registro:     p.tick_registro     || 0,
    tick_saida:        p.tick_saida        || 0,
    status_economico:  p.status_economico  || 'estagnacao',
    fornecedores_ids:  JSON.stringify(p.fornecedores_ids || []),
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
      segmento: r.segmento || 'POP_NAO_DURAVEL',
      infraestrutura: r.infraestrutura || '',
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
      tick_registro: toNum(r.tick_registro, 0),
      tick_saida:    toNum(r.tick_saida,    0),
      status_economico: r.status_economico || 'estagnacao',
      fornecedores_ids: toIdList(r.fornecedores_ids),
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
    segmento: e.segmento || 'POP_NAO_DURAVEL',
    infraestrutura:        e.infraestrutura || '',
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
    tick_registro:         e.tick_registro || 0,
    tick_saida:            e.tick_saida    || 0,
    status_economico:      e.status_economico || 'estagnacao',
    fornecedores_ids:      JSON.stringify(e.fornecedores_ids || []),
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
      tipo:      r.tipo      || '',
      parent_id: r.parent_id || '',
      descricao: r.descricao || '',
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
      infraestrutura: {
        creche:            toBool(r.infra_creche),
        escola_primaria:   toBool(r.infra_escola_primaria),
        escola_secundaria: toBool(r.infra_escola_secundaria),
        ensino_medio:      toBool(r.infra_ensino_medio),
        universidade:      toBool(r.infra_universidade),
        rodoviaria:        toBool(r.infra_rodoviaria),
        aeroporto:         toBool(r.infra_aeroporto),
        porto:             toBool(r.infra_porto),
        estacao_trem:      toBool(r.infra_estacao_trem),
        metro:             toBool(r.infra_metro),
        onibus_municipais: toBool(r.infra_onibus_municipais),
        centro_comercial:  toBool(r.infra_centro_comercial),
      },
      tick_registro: toNum(r.tick_registro, 0),
      tick_saida:    toNum(r.tick_saida,    0),
      status_economico: r.status_economico || 'estagnacao',
      fornecedores_ids: toIdList(r.fornecedores_ids),
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
    tipo:      s.tipo      || '',
    parent_id: s.parent_id || '',
    descricao: s.descricao || '',
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
    infra_creche:            s.infraestrutura?.creche            ? 1 : 0,
    infra_escola_primaria:   s.infraestrutura?.escola_primaria   ? 1 : 0,
    infra_escola_secundaria: s.infraestrutura?.escola_secundaria ? 1 : 0,
    infra_ensino_medio:      s.infraestrutura?.ensino_medio      ? 1 : 0,
    infra_universidade:      s.infraestrutura?.universidade      ? 1 : 0,
    infra_rodoviaria:        s.infraestrutura?.rodoviaria        ? 1 : 0,
    infra_aeroporto:         s.infraestrutura?.aeroporto         ? 1 : 0,
    infra_porto:             s.infraestrutura?.porto             ? 1 : 0,
    infra_estacao_trem:      s.infraestrutura?.estacao_trem      ? 1 : 0,
    infra_metro:             s.infraestrutura?.metro             ? 1 : 0,
    infra_onibus_municipais: s.infraestrutura?.onibus_municipais ? 1 : 0,
    infra_centro_comercial:  s.infraestrutura?.centro_comercial  ? 1 : 0,
    tick_registro:        s.tick_registro || 0,
    tick_saida:           s.tick_saida    || 0,
    status_economico:     s.status_economico || 'estagnacao',
    fornecedores_ids:     JSON.stringify(s.fornecedores_ids || []),
  }));
}

// ── Clubes ─────────────────────────────────────────────────────────────────

/**
 * Parse raw CSV rows into typed clube objects.
 * Clubes are sports clubs with dedicated financial management fields.
 * @param {Object[]} rows
 * @returns {Object[]}
 */
export function rowsToClubes(rows) {
  return rows.map(r => {
    const patrimonio = toNum(r.patrimonio, 0);
    return {
      id: r.id,
      nome: r.nome,
      dono_id: r.dono_id || '',
      estado_id: r.estado_id || '',
      patrimonio,
      financas: {
        receita_bilheteria:   toNum(r.receita_bilheteria, 0),
        receita_tv:           toNum(r.receita_tv, 0),
        receita_patrocinios:  toNum(r.receita_patrocinios, 0),
        receita_transferencias: toNum(r.receita_transferencias, 0),
        folha_salarial:       toNum(r.folha_salarial, 0),
        custo_infraestrutura: toNum(r.custo_infraestrutura, 0),
        custo_contratacoes:   toNum(r.custo_contratacoes, 0),
        saldo:                toNum(r.saldo, 0),
      },
      atributos: {
        torcida:        toNum(r.torcida, 0),
        reputacao:      toNum(r.reputacao, 3),
        instalacoes:    toNum(r.instalacoes, 3),
      },
      tick_registro: toNum(r.tick_registro, 0),
      tick_saida:    toNum(r.tick_saida,    0),
      status_economico: r.status_economico || 'estagnacao',
      fornecedores_ids: toIdList(r.fornecedores_ids),
      ativos: { patrimonio_geral: patrimonio },
    };
  });
}

/**
 * Serialize typed clube objects back to CSV-ready rows.
 * @param {Object[]} clubes
 * @returns {Object[]}
 */
export function clubesToRows(clubes) {
  return clubes.map(c => ({
    id: c.id,
    nome: c.nome,
    dono_id: c.dono_id || '',
    estado_id: c.estado_id || '',
    patrimonio: Math.round(c.patrimonio || 0),
    receita_bilheteria:     Math.round(c.financas.receita_bilheteria   || 0),
    receita_tv:             Math.round(c.financas.receita_tv           || 0),
    receita_patrocinios:    Math.round(c.financas.receita_patrocinios  || 0),
    receita_transferencias: Math.round(c.financas.receita_transferencias || 0),
    folha_salarial:         Math.round(c.financas.folha_salarial       || 0),
    custo_infraestrutura:   Math.round(c.financas.custo_infraestrutura || 0),
    custo_contratacoes:     Math.round(c.financas.custo_contratacoes   || 0),
    saldo:                  Math.round(c.financas.saldo                || 0),
    torcida:    c.atributos.torcida,
    reputacao:  c.atributos.reputacao,
    instalacoes: c.atributos.instalacoes,
    tick_registro: c.tick_registro || 0,
    tick_saida:    c.tick_saida    || 0,
    status_economico: c.status_economico || 'estagnacao',
    fornecedores_ids: JSON.stringify(c.fornecedores_ids || []),
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
 * @param {{ pessoas: Object[], empresas: Object[], estados: Object[], clubes: Object[] }} world
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
  apply(world.clubes || [], 'clube', false);
}

/**
 * Serialize all entity ativos to CSV rows for ativos.csv.
 * @param {{ pessoas: Object[], empresas: Object[], estados: Object[], clubes: Object[] }} world
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
  add(world.clubes || [], 'clube');
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

/**
 * Compute the total population weight for a given estado,
 * defined as the sum of pessoa.peso for all active (tick_saida === 0)
 * pessoas whose estado_id matches.
 *
 * This is the canonical "population" value in the simplified economic model,
 * where each pessoa row represents an aggregate group of people rather than
 * a single individual.
 *
 * @param {string} estadoId
 * @param {Object[]} pessoas
 * @returns {number}
 */
export function calcularPopulacaoEstado(estadoId, pessoas) {
  return (pessoas || [])
    .filter(p => p.estado_id === estadoId && !p.tick_saida)
    .reduce((sum, p) => sum + Math.max(1, p.peso || 1), 0);
}

/**
 * Recompute the infrastructure binary flags for all estados based on the
 * active empresas in each estado.
 * An infrastructure type is present in an estado if at least one active
 * (tick_saida === 0) empresa with that estado_id has that infraestrutura value.
 *
 * @param {{ pessoas: Object[], empresas: Object[], estados: Object[] }} world
 */
export function recomputeEstadoInfrastrutura(world) {
  // Reset all infra flags
  for (const est of world.estados) {
    if (!est.infraestrutura) est.infraestrutura = {};
    for (const tipo of INFRAESTRUTURA_TIPOS) {
      est.infraestrutura[tipo] = false;
    }
  }

  // Build index for fast lookup
  const estadoMap = new Map(world.estados.map(s => [s.id, s]));

  // Set flags from active empresas
  for (const emp of world.empresas) {
    if (emp.tick_saida > 0) continue;
    const tipo = emp.infraestrutura;
    if (!tipo || !INFRAESTRUTURA_TIPOS.includes(tipo)) continue;
    const est = estadoMap.get(emp.estado_id);
    if (est) {
      est.infraestrutura[tipo] = true;
    }
  }
}
