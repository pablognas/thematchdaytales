/**
 * engine.js — Monthly tick simulation for the mini economic model.
 *
 * Tick execution order:
 *  0. applyScheduledConversions() — convert attributes/assets for scheduled entities
 *  1. applyScheduledInjections()  — cash injections into caixa / renda_tributaria
 *  2. tickMensal()                — standard monthly economic flows:
 *     a. renda_mensal -> pessoa.caixa (after IRPF -> estado)
 *     b. IRPJ: empresa.lucro * ir_pj -> estado.renda_tributaria
 *     c. Dividendos: lucro*0.3 (post-IRPJ) -> dono.caixa
 *     d. Gastos de classe: if not paid, attribute drops 1 point
 *     e. Salários políticos: estado.renda_tributaria -> político.caixa
 *     f. Investimento cultura & FA: afeta cultura, forcas_armadas, moral_populacao
 *
 * Available conversions are exported so the UI can display them without
 * knowing the engine internals.
 */

import { reconcilePatrimonio } from './world.js';

/** @param {any[]} arr @returns {Map<string, any>} */
function indexById(arr) {
  return new Map(arr.map(x => [x.id, x]));
}

/** @param {number} v @param {number} min @param {number} max @returns {number} */
function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// ── Conversion catalogues ─────────────────────────────────────────────────

/**
 * Fixed conversion options available for Empresas.
 * id is the key passed to scheduleConversion / applyEmpresaConversion.
 */
export const EMPRESA_CONVERSIONS = [
  { id: 'lucro_para_patrimonio',  label: 'Lucro → Patrimônio (50% do lucro)' },
  { id: 'lucro_para_moral',       label: 'Lucro → Moral Corp. (10% do lucro)' },
  { id: 'lucro_para_reputacao',   label: 'Lucro → Reputação Corp. (10% do lucro)' },
];

/**
 * Fixed conversion options available for Estados.
 */
export const ESTADO_CONVERSIONS = [
  { id: 'renda_para_cultura',    label: 'Renda → Cultura (usa investimento_cultura)' },
  { id: 'renda_para_fa',         label: 'Renda → Forças Armadas (usa investimento_fa)' },
  { id: 'renda_para_moral_pop',  label: 'Renda → Moral Popular (10% da renda)' },
];

/**
 * Build the conversion catalogue for Pessoas from the loaded config.
 * Returns entries for both general and renda-to-attribute conversions.
 * @param {Object} config
 * @returns {Array<{id: string, label: string}>}
 */
export function getPessoaConversions(config) {
  const conversoes = config?.conversoes?.conversoes_entre_atributos ?? [];
  return conversoes.map(r => ({
    id: `${r.de}:${r.para}`,
    label: `${r.de} → ${r.para} (taxa ${r.taxa}, -1 ${r.de})`,
  }));
}

// ── Conversion handlers ───────────────────────────────────────────────────

/**
 * Apply a single attribute conversion to a pessoa.
 * conversionId format: "de:para"  (e.g. "influencia:reputacao")
 * Effect: -1 to source attribute, +taxa to target attribute.
 * @param {Object} pessoa
 * @param {string} conversionId
 * @param {Object} config
 * @returns {string} log line
 */
function applyPessoaConversion(pessoa, conversionId, config) {
  const [de, para] = conversionId.split(':');
  const conversoes = config?.conversoes?.conversoes_entre_atributos ?? [];
  const especiais  = config?.conversoes?.conversoes_especiais_por_classe?.[pessoa.classe] ?? [];

  const baseRule    = conversoes.find(r => r.de === de && r.para === para);
  const specialRule = especiais.find(r => r.de === de && r.para === para);
  const taxa = specialRule?.taxa ?? baseRule?.taxa;

  if (!taxa) {
    return `[Conversão] ${pessoa.nome}: conversão "${conversionId}" não disponível`;
  }
  if ((pessoa.atributos[de] ?? 0) < 1) {
    return `[Conversão] ${pessoa.nome}: ${de} insuficiente (${pessoa.atributos[de] ?? 0})`;
  }

  pessoa.atributos[de]  = (pessoa.atributos[de]  || 0) - 1;
  pessoa.atributos[para] = (pessoa.atributos[para] || 0) + taxa;

  // If patrimonio was involved, resync ativos while preserving other assets
  if (de === 'patrimonio' || para === 'patrimonio') {
    if (!pessoa.ativos) pessoa.ativos = {};
    pessoa.ativos.patrimonio_geral = pessoa.atributos.patrimonio;
  }

  return `[Conversão] ${pessoa.nome}: -1 ${de} +${taxa} ${para}`;
}

/**
 * Apply a conversion to an empresa.
 * @param {Object} empresa
 * @param {string} conversionId
 * @returns {string} log line
 */
function applyEmpresaConversion(empresa, conversionId) {
  switch (conversionId) {
    case 'lucro_para_patrimonio': {
      const transfer = empresa.atributos.lucro * 0.5;
      if (transfer <= 0) return `[Conversão] ${empresa.nome}: lucro insuficiente para transferência`;
      empresa.atributos.lucro -= transfer;
      empresa.patrimonio = (empresa.patrimonio || 0) + transfer;
      empresa.ativos = empresa.ativos || {};
      empresa.ativos.patrimonio_acumulado = (empresa.ativos.patrimonio_acumulado || 0) + transfer;
      reconcilePatrimonio(empresa, 'empresa');
      return `[Conversão] ${empresa.nome}: lucro -${transfer.toFixed(0)} → patrimônio +${transfer.toFixed(0)}`;
    }
    case 'lucro_para_moral': {
      const inv = empresa.atributos.lucro * 0.1;
      if (inv <= 0) return `[Conversão] ${empresa.nome}: lucro insuficiente para investimento em moral`;
      empresa.atributos.lucro -= inv;
      const bonus = Math.floor(inv / 10000) * 0.1;
      empresa.atributos.moral_corporativa = Math.min(5, empresa.atributos.moral_corporativa + bonus);
      return `[Conversão] ${empresa.nome}: lucro -${inv.toFixed(0)} → moral corporativa +${bonus.toFixed(2)}`;
    }
    case 'lucro_para_reputacao': {
      const inv = empresa.atributos.lucro * 0.1;
      if (inv <= 0) return `[Conversão] ${empresa.nome}: lucro insuficiente para investimento em reputação`;
      empresa.atributos.lucro -= inv;
      const bonus = Math.floor(inv / 10000) * 0.1;
      empresa.atributos.reputacao_corporativa = Math.min(5, empresa.atributos.reputacao_corporativa + bonus);
      return `[Conversão] ${empresa.nome}: lucro -${inv.toFixed(0)} → reputação corporativa +${bonus.toFixed(2)}`;
    }
    default:
      return `[Conversão] ${empresa.nome}: conversão "${conversionId}" desconhecida`;
  }
}

/**
 * Apply a conversion to an estado.
 * @param {Object} estado
 * @param {string} conversionId
 * @returns {string} log line
 */
function applyEstadoConversion(estado, conversionId) {
  switch (conversionId) {
    case 'renda_para_cultura': {
      const inv = estado.financas.investimento_cultura;
      if (estado.financas.renda_tributaria < inv) {
        return `[Conversão] ${estado.nome}: renda insuficiente para cultura`;
      }
      estado.financas.renda_tributaria -= inv;
      const bonus = Math.floor(inv / 50000) * 0.1;
      estado.atributos.cultura = Math.min(5, estado.atributos.cultura + bonus);
      return `[Conversão] ${estado.nome}: renda -${inv.toFixed(0)} → cultura +${bonus.toFixed(2)}`;
    }
    case 'renda_para_fa': {
      const inv = estado.financas.investimento_fa;
      if (estado.financas.renda_tributaria < inv) {
        return `[Conversão] ${estado.nome}: renda insuficiente para forças armadas`;
      }
      estado.financas.renda_tributaria -= inv;
      const bonus = Math.floor(inv / 100000) * 0.1;
      estado.atributos.forcas_armadas = Math.min(5, estado.atributos.forcas_armadas + bonus);
      return `[Conversão] ${estado.nome}: renda -${inv.toFixed(0)} → forças armadas +${bonus.toFixed(2)}`;
    }
    case 'renda_para_moral_pop': {
      const inv = estado.financas.renda_tributaria * 0.1;
      if (inv <= 0) return `[Conversão] ${estado.nome}: renda insuficiente para moral`;
      estado.financas.renda_tributaria -= inv;
      const bonus = 0.1;
      estado.atributos.moral_populacao = Math.min(5, estado.atributos.moral_populacao + bonus);
      return `[Conversão] ${estado.nome}: renda -${inv.toFixed(0)} → moral popular +${bonus.toFixed(2)}`;
    }
    default:
      return `[Conversão] ${estado.nome}: conversão "${conversionId}" desconhecida`;
  }
}

// ── Scheduled execution ───────────────────────────────────────────────────

/**
 * Apply all scheduled conversions for a given set of scheduled items.
 * Should be called BEFORE tickMensal().
 *
 * @param {Array<{ownerType,ownerId,conversionId}>} scheduledConversions
 * @param {{ pessoas: Object[], empresas: Object[], estados: Object[] }} world
 * @param {Object} config
 * @returns {string[]} log lines
 */
export function applyScheduledConversions(scheduledConversions, world, config) {
  const log = [];
  if (!scheduledConversions || scheduledConversions.length === 0) return log;

  const pessoasById  = indexById(world.pessoas);
  const empresasById = indexById(world.empresas);
  const estadosById  = indexById(world.estados);

  for (const sc of scheduledConversions) {
    switch (sc.ownerType) {
      case 'pessoa': {
        const entity = pessoasById.get(sc.ownerId);
        if (entity) log.push(applyPessoaConversion(entity, sc.conversionId, config));
        else log.push(`[Conversão] Pessoa "${sc.ownerId}" não encontrada`);
        break;
      }
      case 'empresa': {
        const entity = empresasById.get(sc.ownerId);
        if (entity) log.push(applyEmpresaConversion(entity, sc.conversionId));
        else log.push(`[Conversão] Empresa "${sc.ownerId}" não encontrada`);
        break;
      }
      case 'estado': {
        const entity = estadosById.get(sc.ownerId);
        if (entity) log.push(applyEstadoConversion(entity, sc.conversionId));
        else log.push(`[Conversão] Estado "${sc.ownerId}" não encontrado`);
        break;
      }
    }
  }
  return log;
}

/**
 * Apply all scheduled financial injections.
 * Increases caixa for pessoas, lucro for empresas, renda_tributaria for estados.
 * Should be called BEFORE tickMensal().
 *
 * @param {Array<{ownerType,ownerId,amount}>} scheduledInjections
 * @param {{ pessoas: Object[], empresas: Object[], estados: Object[] }} world
 * @returns {string[]} log lines
 */
export function applyScheduledInjections(scheduledInjections, world) {
  const log = [];
  if (!scheduledInjections || scheduledInjections.length === 0) return log;

  const pessoasById  = indexById(world.pessoas);
  const empresasById = indexById(world.empresas);
  const estadosById  = indexById(world.estados);

  for (const inj of scheduledInjections) {
    const amount = Number(inj.amount) || 0;
    switch (inj.ownerType) {
      case 'pessoa': {
        const entity = pessoasById.get(inj.ownerId);
        if (entity) {
          entity.caixa += amount;
          log.push(`[Aporte] ${entity.nome}: +${amount.toLocaleString('pt-BR')} no caixa`);
        } else {
          log.push(`[Aporte] Pessoa "${inj.ownerId}" não encontrada`);
        }
        break;
      }
      case 'empresa': {
        const entity = empresasById.get(inj.ownerId);
        if (entity) {
          entity.atributos.lucro += amount;
          log.push(`[Aporte] ${entity.nome}: +${amount.toLocaleString('pt-BR')} no lucro`);
        } else {
          log.push(`[Aporte] Empresa "${inj.ownerId}" não encontrada`);
        }
        break;
      }
      case 'estado': {
        const entity = estadosById.get(inj.ownerId);
        if (entity) {
          entity.financas.renda_tributaria += amount;
          log.push(`[Aporte] ${entity.nome}: +${amount.toLocaleString('pt-BR')} na renda tributária`);
        } else {
          log.push(`[Aporte] Estado "${inj.ownerId}" não encontrado`);
        }
        break;
      }
    }
  }
  return log;
}

// ── Monthly tick ──────────────────────────────────────────────────────────

/**
 * Run one monthly tick, mutating world objects in place.
 *
 * @param {Object} config  - { classes, atributos, conversoes, fluxos, produtos }
 * @param {Object} world   - { pessoas: Object[], empresas: Object[], estados: Object[] }
 * @returns {string[]} log - Human-readable lines describing what happened
 */
export function tickMensal(config, world) {
  const log = [];
  const pessoasById = indexById(world.pessoas);
  const estadosById = indexById(world.estados);

  // ── 1 & 2) Renda mensal -> caixa, IRPF -> estado ────────────────────────
  for (const p of world.pessoas) {
    const estado = estadosById.get(p.estado_id);
    const aliquota = estado ? estado.impostos.ir_pf : 0;
    const imposto = p.renda_mensal * aliquota;
    const rendaLiquida = p.renda_mensal - imposto;

    p.caixa += rendaLiquida;
    log.push(`[IRPF] ${p.nome}: renda ${p.renda_mensal} | imposto ${imposto.toFixed(2)} -> ${p.estado_id || 'sem estado'} | líquido +${rendaLiquida.toFixed(2)}`);

    if (estado) {
      estado.financas.renda_tributaria += imposto;
    }
  }

  // ── 3 & 4) IRPJ e dividendos ─────────────────────────────────────────────
  for (const emp of world.empresas) {
    const estado = estadosById.get(emp.estado_id);
    if (!estado) continue;

    const impostoJ = emp.atributos.lucro * estado.impostos.ir_pj;
    emp.atributos.lucro -= impostoJ;
    estado.financas.renda_tributaria += impostoJ;
    log.push(`[IRPJ] ${emp.nome}: imposto ${impostoJ.toFixed(2)} -> ${emp.estado_id}`);

    const payout = emp.atributos.lucro * 0.3;
    const dono = pessoasById.get(emp.dono_id);
    if (dono) {
      dono.caixa += payout;
      log.push(`[Dividendos] ${emp.nome}: payout ${payout.toFixed(2)} -> ${dono.nome}`);
    }
    emp.atributos.lucro -= payout;
  }

  // ── 5) Gastos de classe por pessoa ──────────────────────────────────────
  const classesById = new Map((config.classes.classes || []).map(c => [c.id, c]));

  for (const p of world.pessoas) {
    const classeConfig = classesById.get(p.classe);
    if (!classeConfig) continue;

    for (const [attr, custo] of Object.entries(classeConfig.gastos_mensais || {})) {
      const pago = p.gastos_mensais_pagos[attr] !== false;
      if (pago && p.caixa >= custo) {
        p.caixa -= custo;
        log.push(`[Gastos] ${p.nome}: -${custo} (${attr} mantido)`);
      } else {
        // Punição: atributo cai 1 ponto
        const lim = classeConfig.limites_atributos?.[attr];
        if (lim && p.atributos[attr] !== undefined) {
          p.atributos[attr] = clamp(p.atributos[attr] - 1, lim.min, lim.max);
          log.push(`[Gastos] ${p.nome}: sem caixa para ${attr} → atributo caiu para ${p.atributos[attr]}`);
        }
      }
    }
  }

  // ── 6) Salários a políticos ──────────────────────────────────────────────
  for (const p of world.pessoas) {
    if (p.classe !== 'politico') continue;
    const estado = estadosById.get(p.estado_id);
    if (!estado) continue;

    const salario = estado.financas.salarios_politicos;
    if (estado.financas.renda_tributaria >= salario) {
      estado.financas.renda_tributaria -= salario;
      p.caixa += salario;
      log.push(`[Salário político] ${p.nome}: +${salario} de ${estado.nome}`);
    }
  }

  // ── 7 & 8) Investimentos em cultura e FA -> moral_populacao ─────────────
  for (const estado of world.estados) {
    const invCultura = estado.financas.investimento_cultura;
    const invFA      = estado.financas.investimento_fa;

    if (estado.financas.renda_tributaria >= invCultura + invFA) {
      estado.financas.renda_tributaria -= invCultura + invFA;

      const bonusCultura = Math.floor(invCultura / 50000) * 0.1;
      estado.atributos.cultura = Math.min(5, estado.atributos.cultura + bonusCultura);
      estado.atributos.moral_populacao = clamp(estado.atributos.moral_populacao + 0.1, 1, 5);

      const bonusFA = Math.floor(invFA / 100000) * 0.1;
      estado.atributos.forcas_armadas = Math.min(5, estado.atributos.forcas_armadas + bonusFA);
      estado.atributos.moral_populacao = clamp(estado.atributos.moral_populacao + 0.05, 1, 5);

      log.push(`[Investimento] ${estado.nome}: cultura +${bonusCultura.toFixed(2)}, FA +${bonusFA.toFixed(2)}, moral_pop agora ${estado.atributos.moral_populacao.toFixed(2)}`);
    }
  }

  return log;
}
