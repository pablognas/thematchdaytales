/**
 * app.js — Browser entry point for the Mini Economic Model Manager.
 *
 * Served from /web/; paths below are relative to the repo root (served at /).
 * Use a static server (e.g. `python -m http.server 8000`) and open /web/index.html.
 */

import { parseCsv, unparseCsv, downloadText } from '../src/core/csv.js';
import {
  rowsToPessoas, pessoasToRows,
  rowsToEmpresas, empresasToRows,
  rowsToEstados,  estadosToRows,
} from '../src/core/world.js';
import { tickMensal } from '../src/core/engine.js';

// ── DOM refs ──────────────────────────────────────────────────────────────
const taPessoas  = document.getElementById('ta-pessoas');
const taEmpresas = document.getElementById('ta-empresas');
const taEstados  = document.getElementById('ta-estados');
const logEl      = document.getElementById('log');
const statusEl   = document.getElementById('status');

// ── Config cache ──────────────────────────────────────────────────────────
let config = null;

async function loadConfig() {
  if (config) return config;
  try {
    const [classes, atributos, conversoes, fluxos, produtos] = await Promise.all([
      fetch('../data/config/classes.json').then(r => r.json()),
      fetch('../data/config/atributos.json').then(r => r.json()),
      fetch('../data/config/conversoes.json').then(r => r.json()),
      fetch('../data/config/fluxos_economicos.json').then(r => r.json()),
      fetch('../data/config/produtos.json').then(r => r.json()),
    ]);
    config = { classes, atributos, conversoes, fluxos, produtos };
    setStatus('Configs JSON carregadas.');
    return config;
  } catch (err) {
    setStatus(`Erro ao carregar configs: ${err.message}`);
    throw err;
  }
}

// ── File input helpers ────────────────────────────────────────────────────
function wireFileInput(inputId, textareaEl) {
  document.getElementById(inputId).addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      textareaEl.value = ev.target.result;
      setStatus(`Carregado: ${file.name}`);
    };
    reader.readAsText(file, 'utf-8');
  });
}

wireFileInput('file-pessoas',  taPessoas);
wireFileInput('file-empresas', taEmpresas);
wireFileInput('file-estados',  taEstados);

// ── Load default CSVs from repo ───────────────────────────────────────────
document.getElementById('btn-defaults').addEventListener('click', async () => {
  try {
    setStatus('Carregando exemplos padrão…');
    const [pCsv, eCsv, sCsv] = await Promise.all([
      fetch('../data/world/pessoas.csv').then(r => r.text()),
      fetch('../data/world/empresas.csv').then(r => r.text()),
      fetch('../data/world/estados.csv').then(r => r.text()),
    ]);
    taPessoas.value  = pCsv.trim();
    taEmpresas.value = eCsv.trim();
    taEstados.value  = sCsv.trim();
    setStatus('Exemplos padrão carregados.');
  } catch (err) {
    setStatus(`Erro ao carregar exemplos: ${err.message}`);
  }
});

// ── Tick mensal ───────────────────────────────────────────────────────────
document.getElementById('btn-tick').addEventListener('click', async () => {
  try {
    const cfg = await loadConfig();

    const pessoasText  = taPessoas.value.trim();
    const empresasText = taEmpresas.value.trim();
    const estadosText  = taEstados.value.trim();

    if (!pessoasText || !empresasText || !estadosText) {
      setStatus('⚠ Carregue os três CSVs antes de rodar o tick.');
      return;
    }

    const world = {
      pessoas:  rowsToPessoas(parseCsv(pessoasText)),
      empresas: rowsToEmpresas(parseCsv(empresasText)),
      estados:  rowsToEstados(parseCsv(estadosText)),
    };

    const tickLog = tickMensal(cfg, world);

    // Rewrite textareas with updated data
    taPessoas.value  = unparseCsv(pessoasToRows(world.pessoas));
    taEmpresas.value = unparseCsv(empresasToRows(world.empresas));
    taEstados.value  = unparseCsv(estadosToRows(world.estados));

    logEl.textContent = tickLog.join('\n');
    setStatus('✅ Tick mensal concluído.');
  } catch (err) {
    setStatus(`Erro no tick: ${err.message}`);
    logEl.textContent = err.stack || err.message;
  }
});

// ── Export CSVs ───────────────────────────────────────────────────────────
document.getElementById('btn-export').addEventListener('click', () => {
  const pessoasText  = taPessoas.value.trim();
  const empresasText = taEmpresas.value.trim();
  const estadosText  = taEstados.value.trim();

  if (!pessoasText && !empresasText && !estadosText) {
    setStatus('⚠ Nenhum dado para exportar.');
    return;
  }
  if (pessoasText)  downloadText('pessoas.csv',  pessoasText);
  if (empresasText) downloadText('empresas.csv', empresasText);
  if (estadosText)  downloadText('estados.csv',  estadosText);
  setStatus('⬇ CSVs exportados.');
});

// ── Helpers ───────────────────────────────────────────────────────────────
function setStatus(msg) {
  statusEl.textContent = msg;
}
