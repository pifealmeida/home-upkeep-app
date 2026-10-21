// Home Upkeep — app shell hospedado no GitHub Pages.
// A planilha do Google continua sendo a única fonte de dados; este arquivo só fala
// com o Apps Script (já reescrito como uma API JSON) via fetch().

const API_URL = 'https://script.google.com/macros/s/AKfycbxcb1I03e6wfoBXzfX8bvSi41yph45Eo96QlisnYF6ypkmpDEP3lCNzpbDojWX2IOebSA/exec';
const API_KEY = 'EAymKiJNwWXufQInoUQjJxl7hVin';

// O Apps Script web app bloqueia fetch()/XHR entre domínios (o Google responde com
// erro só pra chamadas CORS). Por isso falamos com ele sem CORS:
// - Leituras: JSONP (tag <script>).
// - Escritas: um <form> escondido enviado para um <iframe> escondido, com o resultado
//   voltando via postMessage.
let __seq = 0;

function apiGet(action, params) {
  return new Promise((resolve, reject) => {
    const cbName = '__huCb' + (__seq++);
    const qs = new URLSearchParams(Object.assign({ action, key: API_KEY, callback: cbName }, params || {}));
    const script = document.createElement('script');
    const cleanup = () => { delete window[cbName]; script.remove(); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('Tempo esgotado ao buscar dados.')); }, 15000);
    window[cbName] = (json) => {
      clearTimeout(timer); cleanup();
      if (!json || !json.ok) reject(new Error((json && json.error) || 'Erro desconhecido.'));
      else resolve(json.data);
    };
    script.src = API_URL + '?' + qs.toString();
    script.onerror = () => { clearTimeout(timer); cleanup(); reject(new Error('Erro de rede.')); };
    document.body.appendChild(script);
  });
}

function apiPost(action, payload) {
  return new Promise((resolve, reject) => {
    const frameName = '__huFrame' + (__seq++);
    const iframe = document.createElement('iframe');
    iframe.name = frameName;
    iframe.style.display = 'none';
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = API_URL;
    form.target = frameName;
    form.style.display = 'none';
    const data = Object.assign({ action, key: API_KEY }, payload || {});
    Object.keys(data).forEach(k => {
      const v = data[k];
      const input = document.createElement('input');
      input.name = k;
      input.value = (v && typeof v === 'object') ? JSON.stringify(v) : (v == null ? '' : String(v));
      form.appendChild(input);
    });
    const cleanup = () => {
      window.removeEventListener('message', onMsg);
      form.remove();
      setTimeout(() => iframe.remove(), 0);
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error('Tempo esgotado ao salvar.')); }, 15000);
    function onMsg(e) {
      if (typeof e.data !== 'string') return;
      let json;
      try { json = JSON.parse(e.data); } catch (err) { return; }
      if (typeof json.ok !== 'boolean') return;
      clearTimeout(timer); cleanup();
      if (!json.ok) reject(new Error(json.error || 'Erro desconhecido.'));
      else resolve(json.data);
    }
    window.addEventListener('message', onMsg);
    document.body.appendChild(iframe);
    document.body.appendChild(form);
    form.submit();
  });
}

const $ = s => document.querySelector(s);
let DATA = null, filter = 'All', showArchived = false, doneId = null, editId = null, toastTimer = null;
let WHO = localStorage.getItem('homeUpkeepWho') || '';

function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmt(iso){
  if (!iso) return '';
  const d = new Date(iso + 'T12:00:00');
  const opts = {month:'short', day:'numeric'};
  if (!DATA || iso.slice(0,4) !== DATA.today.slice(0,4)) opts.year = 'numeric';
  return d.toLocaleDateString('pt-BR', opts);
}
function whoLabel(w){ return w || ''; }
function everyLabel(t){
  if (t.every === 1) return {days:'Diário', weeks:'Semanal', months:'Mensal', years:'Anual'}[t.unit];
  const unitWords = {days:'dias', weeks:'semanas', months:'meses', years:'anos'};
  return 'A cada ' + t.every + ' ' + (unitWords[t.unit] || t.unit);
}
function status(t){
  if (!t.lastDone) return ['start', 'Defina quando foi feito'];
  const d = t.daysUntil;
  if (d < 0) return ['over', 'Atrasado há ' + (-d) + ' dia' + (d === -1 ? '' : 's')];
  if (d === 0) return ['soon', 'Vence hoje'];
  if (d === 1) return ['soon', 'Vence amanhã'];
  if (d <= 7) return ['soon', 'Vence em ' + d + ' dias'];
  return ['later', 'Vence em ' + fmt(t.nextDue)];
}
function toast(msg){
  const el = $('#toast'); el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.hidden = true, 3200);
}
function fail(e){ setBusy(false); toast((e && e.message) || String(e)); }
function setBusy(b){ document.querySelectorAll('.sheet .btn').forEach(x => x.disabled = b); }

function load(){ apiGet('getData').then(render).catch(fail); }

function card(t){
  const st = status(t);
  const meta = [everyLabel(t), t.category, whoLabel(t.who)].filter(Boolean).map(esc).join(' · ');
  return '<div class="card ' + (st[0] === 'over' ? 'over' : '') + '">' +
    '<div class="main" data-open="' + esc(t.id) + '">' +
      '<div class="title">' + esc(t.task) + '</div><div class="meta">' + meta + '</div>' +
      '<div class="row"><span class="pill ' + st[0] + '">' + esc(st[1]) + '</span>' +
      (t.lastDone ? '<span class="last">Feito em ' + esc(fmt(t.lastDone)) + '</span>' : '') + '</div>' +
    '</div>' +
    (t.active ? '<button class="btn" data-done="' + esc(t.id) + '">' + (t.lastDone ? 'Feito' : 'Iniciar') + '</button>' : '') +
  '</div>';
}

function render(d){
  if (d) DATA = d;
  setBusy(false);
  const all = DATA.tasks;
  const cats = Array.from(new Set(all.map(t => t.category).filter(Boolean))).sort();
  $('#cats').innerHTML = cats.map(c => '<option value="' + esc(c) + '">').join('');

  const chipDefs = [{code:'All', label:'Tudo'}, {code:'DIY', label:'DIY'}, {code:'Pro', label:'Pro'}]
    .concat(cats.map(c => ({code: c, label: c})));
  if (chipDefs.findIndex(c => c.code === filter) < 0) filter = 'All';
  $('#chips').innerHTML = chipDefs.map(c => '<button class="chip' + (c.code === filter ? ' on' : '') + '" data-chip="' + esc(c.code) + '">' + esc(c.label) + '</button>').join('');

  const pass = t => filter === 'All' || t.who === filter || t.category === filter;
  const active = all.filter(t => t.active && pass(t));
  const by = (a, b) => a.daysUntil - b.daysUntil || a.task.localeCompare(b.task);
  const groups = [
    ['Atrasadas', active.filter(t => t.lastDone && t.daysUntil < 0).sort(by)],
    ['Esta semana', active.filter(t => t.lastDone && t.daysUntil >= 0 && t.daysUntil <= 7).sort(by)],
    ['Precisa de data inicial', active.filter(t => !t.lastDone).sort((a, b) => a.task.localeCompare(b.task))],
    ['Mais tarde', active.filter(t => t.lastDone && t.daysUntil > 7).sort(by)],
  ];

  const allActive = all.filter(t => t.active);
  const over = allActive.filter(t => t.lastDone && t.daysUntil < 0).length;
  const week = allActive.filter(t => t.lastDone && t.daysUntil >= 0 && t.daysUntil <= 7).length;
  $('#summary').textContent = over + ' atrasada(s) · ' + week + ' esta semana · ' + allActive.length + ' tarefa(s)';

  let html = groups.filter(g => g[1].length).map(g => '<h2>' + g[0] + ' · ' + g[1].length + '</h2>' + g[1].map(card).join('')).join('');
  if (!active.length) html = '<div class="empty">Nada por aqui.</div>';

  const archived = all.filter(t => !t.active && pass(t));
  if (archived.length) {
    html += '<button class="linkbtn" id="archToggle">' + (showArchived ? 'Ocultar' : 'Mostrar') + ' arquivadas (' + archived.length + ')</button>';
    if (showArchived) html += '<h2>Arquivadas</h2>' + archived.map(card).join('');
  }
  $('#list').innerHTML = html;
}

function find(id){ return DATA.tasks.find(t => t.id === id); }
function open(el){ el.hidden = false; document.body.style.overflow = 'hidden'; }
function closeAll(){ document.querySelectorAll('.overlay').forEach(o => o.hidden = true); document.body.style.overflow = ''; }

function openDone(id){
  const t = find(id); doneId = id;
  $('#doneTitle').textContent = t.task;
  $('#doneMeta').textContent = t.lastDone ? everyLabel(t) + ' · feito pela última vez em ' + fmt(t.lastDone) : 'Quando foi feito pela última vez? Uma estimativa está ok.';
  $('#doneDate').value = DATA.today; $('#doneDate').max = DATA.today;
  $('#doneNote').value = '';
  $('#doneSave').textContent = t.lastDone ? 'Marcar como feito' : 'Salvar data inicial';
  open($('#doneSheet'));
}

function openEdit(id){
  const t = id ? find(id) : null; editId = id || null;
  $('#editTitle').textContent = t ? 'Detalhes da tarefa' : 'Nova tarefa';
  $('#fTask').value = t ? t.task : '';
  $('#fEvery').value = t ? t.every : 1;
  $('#fUnit').value = t ? t.unit : 'months';
  $('#fWho').value = t && t.who === 'Pro' ? 'Pro' : 'DIY';
  $('#fCat').value = t ? t.category : '';
  $('#fLast').value = t ? t.lastDone : ''; $('#fLast').max = DATA.today;
  $('#fNotes').value = t ? t.notes : '';
  $('#fActive').checked = t ? t.active : true;
  $('#fActiveWrap').style.display = t ? '' : 'none';
  $('#hist').innerHTML = '';
  open($('#editSheet'));
  if (t) {
    $('#hist').innerHTML = '<h2>Histórico</h2><div class="last">Carregando…</div>';
    apiGet('getHistory', { id: t.id }).then(rows => {
      $('#hist').innerHTML = '<h2>Histórico</h2>' + (rows.length
        ? rows.map(r => '<div>' + esc(fmt(r.date)) + ' <small>· ' + esc(r.by) + '</small>' + (r.note ? '<br><small>' + esc(r.note) + '</small>' : '') + '</div>').join('')
        : '<div class="last">Ainda sem histórico.</div>');
    }).catch(() => { $('#hist').innerHTML = ''; });
  } else {
    setTimeout(() => $('#fTask').focus(), 50);
  }
}

function updateWhoBtn(){ $('#whoBtn').textContent = WHO ? WHO : 'Quem é você?'; }

function setWho(name){
  name = String(name || '').trim();
  if (!name) return;
  WHO = name;
  localStorage.setItem('homeUpkeepWho', WHO);
  updateWhoBtn();
  closeAll();
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-done],[data-open],[data-chip],[data-close],[data-who],#archToggle,#addBtn,#whoBtn,#whoOtherSave');
  if (e.target.classList.contains('overlay')) return closeAll();
  if (!el) return;
  if (el.dataset.done) openDone(el.dataset.done);
  else if (el.dataset.open) openEdit(el.dataset.open);
  else if (el.dataset.chip) { filter = el.dataset.chip; render(); }
  else if (el.dataset.who) setWho(el.dataset.who);
  else if (el.id === 'whoOtherSave') setWho($('#whoOther').value);
  else if (el.hasAttribute('data-close')) closeAll();
  else if (el.id === 'archToggle') { showArchived = !showArchived; render(); }
  else if (el.id === 'addBtn') openEdit(null);
  else if (el.id === 'whoBtn') open($('#whoSheet'));
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAll(); });

$('#doneSave').addEventListener('click', () => {
  const date = $('#doneDate').value;
  if (!date) return toast('Escolha uma data.');
  const t = find(doneId);
  setBusy(true);
  apiPost('markDone', { id: doneId, dateIso: date, note: $('#doneNote').value, who: WHO }).then(d => {
    closeAll(); render(d);
    const nt = find(doneId);
    toast(nt && nt.nextDue ? '✓ ' + t.task + ' · próximo vencimento em ' + fmt(nt.nextDue) : '✓ Salvo');
  }).catch(fail);
});

$('#editSave').addEventListener('click', () => {
  const payload = {
    id: editId, task: $('#fTask').value, every: $('#fEvery').value, unit: $('#fUnit').value,
    who: $('#fWho').value, category: $('#fCat').value, lastDone: $('#fLast').value,
    notes: $('#fNotes').value, active: $('#fActive').checked,
  };
  setBusy(true);
  apiPost('saveTask', { task: payload, who: WHO }).then(d => { closeAll(); render(d); toast('✓ Salvo'); }).catch(fail);
});

// Atualiza quando o app volta a ficar em primeiro plano (ex: a outra pessoa marcou algo como feito).
document.addEventListener('visibilitychange', () => { if (!document.hidden && DATA) load(); });

updateWhoBtn();
if (!WHO) open($('#whoSheet'));
load();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
