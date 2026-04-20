/**
 * engine.js — Monthly tick simulation for the mini economic model.
 *
 * Implements the following flows (see data/config/fluxos_economicos.json):
 *  1. renda_mensal -> pessoa.caixa
 *  2. IRPF: percentual da renda_mensal -> estado via pessoa.estado_id
 *  3. IRPJ: percentual do lucro da empresa -> estado via empresa.estado_id
 *  4. Dividendos: lucro*0.3 (após IRPJ) -> pessoa.caixa (dono)
 *  5. Gastos de classe: se não pago, atributo cai 1 ponto
 *  6. Salários a políticos: estado -> político (via pessoa.estado_id e pessoa.classe)
 *  7. Investimento cultura: afeta moral_populacao do estado
 *  8. Investimento FA: afeta moral_populacao do estado
 */

/** @param {any[]} arr @returns {Map<string, any>} */
function indexById(arr) {
  return new Map(arr.map(x => [x.id, x]));
}

/** @param {number} v @param {number} min @param {number} max @returns {number} */
function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

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

      // Cada 50000 investidos em cultura +0.1 na cultura (pontuação) e +0.1 em moral_populacao
      const bonusCultura = Math.floor(invCultura / 50000) * 0.1;
      estado.atributos.cultura = Math.min(5, estado.atributos.cultura + bonusCultura);
      estado.atributos.moral_populacao = clamp(estado.atributos.moral_populacao + 0.1, 1, 5);

      // Cada 100000 em FA +0.1 em forcas_armadas e +0.05 em moral_populacao
      const bonusFA = Math.floor(invFA / 100000) * 0.1;
      estado.atributos.forcas_armadas = Math.min(5, estado.atributos.forcas_armadas + bonusFA);
      estado.atributos.moral_populacao = clamp(estado.atributos.moral_populacao + 0.05, 1, 5);

      log.push(`[Investimento] ${estado.nome}: cultura +${bonusCultura.toFixed(2)}, FA +${bonusFA.toFixed(2)}, moral_pop agora ${estado.atributos.moral_populacao.toFixed(2)}`);
    }
  }

  return log;
}
