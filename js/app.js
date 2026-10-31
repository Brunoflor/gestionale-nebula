/* Gestionale Nebula — Nebula 3D. App statica, dati in IndexedDB (nessun backend). */
(() => {
'use strict';

/* ---------- Utilità ---------- */
const $ = (s, r = document) => r.querySelector(s);
const EUR = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });
const NUM = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2 });
const PCT = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 });
const EURG = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 4 });
const eur = n => EUR.format(Number.isFinite(n) ? n : 0);
const num = v => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) && n >= 0 ? n : 0; };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
const todayISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const fmtDate = iso => { if (!iso) return '—'; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };
const fmtSize = b => b > 1048576 ? NUM.format(b / 1048576) + ' MB' : NUM.format(Math.max(1, b / 1024)) + ' KB';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const slug = s => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const safeUrl = u => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch { return ''; } };

let toastTimer;
function toast(msg, err) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast show' + (err ? ' err' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.className = 'toast', 3200);
}

const urlCache = new WeakMap();
const urlOf = blob => { if (!blob) return ''; if (!urlCache.has(blob)) urlCache.set(blob, URL.createObjectURL(blob)); return urlCache.get(blob); };

/* ---------- IndexedDB ---------- */
const DB_NAME = 'gestionale-nebula', DB_VER = 1;
let db;
function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('clients')) d.createObjectStore('clients', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('settings')) d.createObjectStore('settings', { keyPath: 'key' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
const tx = (store, mode, fn) => new Promise((res, rej) => {
  const t = db.transaction(store, mode); const out = fn(t.objectStore(store));
  t.oncomplete = () => res(out && 'result' in out ? out.result : undefined);
  t.onerror = t.onabort = () => rej(t.error);
});
const dbAll = () => tx('clients', 'readonly', s => s.getAll());
const dbPut = c => tx('clients', 'readwrite', s => s.put(c));
const dbDel = id => tx('clients', 'readwrite', s => s.delete(id));
const dbClear = () => tx('clients', 'readwrite', s => s.clear());
const getSetting = (k, def) => tx('settings', 'readonly', s => s.get(k)).then(r => r ? r.value : def);
const setSetting = (k, v) => tx('settings', 'readwrite', s => s.put({ key: k, value: v }));

/* ---------- Stato ---------- */
let clients = [];
let settings = { rate: 0.10, eurG: 0.025 };
let editing = null; // { id|null, photos:[], stls:[], created }

/* ---------- Calcoli ---------- */
function costs(c) {
  const elec = num(c.hours) * num(c.rate);
  const mat = c.matMode === 'direct' ? num(c.matDirect) : num(c.grams) * num(c.eurG);
  const cost = elec + mat;
  const price = num(c.price);
  const margin = price - cost;
  const pct = price > 0 ? (margin / price) * 100 : null;
  return { elec, mat, cost, price, margin, pct };
}
const pctTxt = p => p === null ? '—' : PCT.format(p) + ' %';

/* ---------- Immagini ---------- */
async function loadBitmap(file) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* fallback */ }
  }
  return new Promise((res, rej) => {
    const img = new Image(), u = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(u); res(img); };
    img.onerror = () => { URL.revokeObjectURL(u); rej(new Error('img')); };
    img.src = u;
  });
}
function scaleToBlob(bmp, max, q) {
  const w = bmp.width, h = bmp.height, k = Math.min(1, max / Math.max(w, h));
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(w * k)); cv.height = Math.max(1, Math.round(h * k));
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
  return new Promise((res, rej) => cv.toBlob(b => b ? res(b) : rej(new Error('blob')), 'image/jpeg', q));
}
async function processPhoto(file) {
  const bmp = await loadBitmap(file);
  const blob = await scaleToBlob(bmp, 1600, 0.8);
  const thumb = await scaleToBlob(bmp, 360, 0.72);
  if (bmp.close) bmp.close();
  return { id: uid(), name: (file.name || 'foto').replace(/\.[^.]+$/, '') + '.jpg', blob, thumb };
}

/* ---------- Dialog helper ---------- */
const open = d => { if (!d.open) d.showModal(); };
const close = d => { if (d.open) d.close(); };
function confirmBox(title, text, yesLabel = 'Elimina') {
  return new Promise(res => {
    const d = $('#dlg-confirm');
    $('#confirm-title').textContent = title; $('#confirm-text').textContent = text; $('#confirm-yes').textContent = yesLabel;
    const done = v => { $('#confirm-yes').onclick = $('#confirm-no').onclick = d.onclose = null; close(d); res(v); };
    $('#confirm-yes').onclick = () => done(true);
    $('#confirm-no').onclick = () => done(false);
    d.onclose = () => done(false);
    open(d);
  });
}

/* ---------- Lista ---------- */
function filtered() {
  const q = $('#search').value.trim().toLowerCase();
  const st = $('#filter-stato').value;
  let arr = clients.filter(c => {
    if (st === '__none' ? c.stato : (st && c.stato !== st)) return false;
    if (!q) return true;
    return [c.name, c.email, c.notes, c.link, c.stato].some(v => (v || '').toLowerCase().includes(q));
  });
  const [key, dir] = $('#sort').value.split('-'); const m = dir === 'asc' ? 1 : -1;
  arr.sort((a, b) => {
    let r;
    if (key === 'name') r = a.name.localeCompare(b.name, 'it', { sensitivity: 'base' });
    else if (key === 'margin') r = costs(a).margin - costs(b).margin;
    else r = (a.date || '').localeCompare(b.date || '') || (a.created || 0) - (b.created || 0);
    return r * m;
  });
  return arr;
}
function renderSummary(arr) {
  let rev = 0, cost = 0;
  arr.forEach(c => { const k = costs(c); rev += k.price; cost += k.cost; });
  const mar = rev - cost, pct = rev > 0 ? mar / rev * 100 : null;
  const filt = arr.length !== clients.length ? `<small>filtrati su ${clients.length}</small>` : '<small>&nbsp;</small>';
  $('#summary').innerHTML = `
    <div class="stat"><span>Clienti</span><b>${arr.length}</b>${filt}</div>
    <div class="stat"><span>Ricavi totali</span><b>${eur(rev)}</b><small>&nbsp;</small></div>
    <div class="stat"><span>Costi totali</span><b>${eur(cost)}</b><small>&nbsp;</small></div>
    <div class="stat"><span>Margine totale</span><b class="${mar < 0 ? 'neg' : ''}">${eur(mar)}</b><small class="${mar < 0 ? 'neg' : ''}">${pctTxt(pct)}</small></div>`;
}
function renderList() {
  const arr = filtered();
  renderSummary(arr);
  $('#empty').hidden = clients.length > 0;
  $('.toolbar').hidden = clients.length === 0;
  const list = $('#list'); list.innerHTML = '';
  if (clients.length && !arr.length) list.innerHTML = '<p class="hint">Nessun risultato per i filtri attuali.</p>';
  for (const c of arr) {
    const k = costs(c), p = c.photos && c.photos[0];
    const el = document.createElement('article');
    el.className = 'client'; el.tabIndex = 0; el.dataset.id = c.id;
    el.innerHTML = `
      <img class="ph" alt="" loading="lazy" src="${p ? urlOf(p.thumb || p.blob) : ''}">
      <div class="body">
        <div class="row-top"><h3>${esc(c.name)}</h3></div>
        <div class="meta">${esc(c.email || 'nessuna email')} · ${fmtDate(c.date)}</div>
        ${c.stato ? `<span class="badge s-${slug(c.stato)}">${esc(c.stato)}</span>` : ''}
        <div class="nums">
          <div><small>Prezzo</small>${eur(k.price)}</div>
          <div style="text-align:right"><small>Margine</small><span class="m ${k.margin < 0 ? 'neg' : 'pos'}">${eur(k.margin)}</span> <small style="display:inline" class="${k.margin < 0 ? 'neg' : ''}">${pctTxt(k.pct)}</small></div>
        </div>
      </div>`;
    el.onclick = () => showDetail(c.id);
    el.onkeydown = e => { if (e.key === 'Enter') showDetail(c.id); };
    list.appendChild(el);
  }
}
async function reload() { clients = await dbAll(); renderList(); }

/* ---------- Lightbox ---------- */
let lb = { urls: [], i: 0 };
function openLightbox(blobs, i) {
  lb = { urls: blobs.map(urlOf), i };
  paintLb(); open($('#dlg-lightbox'));
}
function paintLb() {
  $('#lb-img').src = lb.urls[lb.i];
  $('#lb-count').textContent = `${lb.i + 1} / ${lb.urls.length}`;
  const multi = lb.urls.length > 1;
  $('#lb-prev').hidden = $('#lb-next').hidden = !multi;
}
const lbStep = d => { lb.i = (lb.i + d + lb.urls.length) % lb.urls.length; paintLb(); };

/* ---------- Dettaglio ---------- */
let detailId = null;
function showDetail(id) {
  const c = clients.find(x => x.id === id); if (!c) return;
  detailId = id;
  const k = costs(c), link = safeUrl(c.link);
  const matLine = c.matMode === 'direct'
    ? 'Materiali (importo diretto)'
    : `Materiali (${NUM.format(num(c.grams))} g × ${EURG.format(num(c.eurG))}/g)`;
  $('#detail').innerHTML = `
    <div class="d-head">
      <div><h2>${esc(c.name)}</h2>
        ${c.stato ? `<span class="badge s-${slug(c.stato)}">${esc(c.stato)}</span>` : ''}</div>
      <button class="btn ghost small" id="d-close">✕ Chiudi</button>
    </div>
    <div class="d-gallery">${(c.photos || []).map((p, i) => `<img src="${urlOf(p.thumb || p.blob)}" data-i="${i}" alt="Foto ${i + 1} del progetto">`).join('')}</div>
    <dl class="kv">
      <dt>Email</dt><dd>${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : '—'}</dd>
      <dt>Data registrazione</dt><dd>${fmtDate(c.date)}</dd>
      <dt>Link Bambu / MakerWorld</dt><dd>${link ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(link)}</a>` : (c.link ? esc(c.link) : '—')}</dd>
      <dt>File STL</dt><dd>${(c.stls || []).length ? `<ul class="files">${c.stls.map((s, i) => `<li><span>${esc(s.name)}</span><small>${fmtSize(s.blob.size)}</small><a class="btn small" data-stl="${i}" href="${urlOf(s.blob)}" download="${esc(s.name)}">⬇️ Scarica</a></li>`).join('')}</ul>` : '—'}</dd>
      <dt>Descrizione</dt><dd>${c.notes ? `<div class="d-notes">${esc(c.notes)}</div>` : '—'}</dd>
    </dl>
    <div class="d-money">
      <div><span>Ore di stampa</span><span>${NUM.format(num(c.hours))} h</span></div>
      <div><span>Elettricità (${NUM.format(num(c.hours))} h × ${eur(num(c.rate))}/h)</span><span>${eur(k.elec)}</span></div>
      <div><span>${esc(matLine)}</span><span>${eur(k.mat)}</span></div>
      <div><span>Costi totali</span><span>${eur(k.cost)}</span></div>
      <div><span>Prezzo di vendita</span><span>${eur(k.price)}</span></div>
      <div class="tot"><span>Margine</span><span class="${k.margin < 0 ? 'neg' : 'pos'}">${eur(k.margin)} · ${pctTxt(k.pct)}</span></div>
    </div>
    <div class="d-actions">
      <button class="btn danger" id="d-del">🗑 Elimina</button>
      <button class="btn primary" id="d-edit">✏️ Modifica</button>
    </div>`;
  const blobs = (c.photos || []).map(p => p.blob);
  $('#detail').querySelectorAll('.d-gallery img').forEach(im => im.onclick = () => openLightbox(blobs, +im.dataset.i));
  $('#d-close').onclick = () => close($('#dlg-detail'));
  $('#d-edit').onclick = () => { close($('#dlg-detail')); openForm(id); };
  $('#d-del').onclick = () => deleteClient(id);
  open($('#dlg-detail'));
}
async function deleteClient(id) {
  const c = clients.find(x => x.id === id); if (!c) return;
  if (!await confirmBox('Eliminare il cliente?', `Verrà eliminata la scheda di "${c.name}" con foto e file. L'operazione non si può annullare.`)) return;
  await dbDel(id); close($('#dlg-detail')); await reload(); toast('Cliente eliminato');
}

/* ---------- Form ---------- */
const F = id => $('#' + id);
function showView(name) {
  $('#view-list').hidden = name !== 'list'; $('#view-form').hidden = name !== 'form';
  $('#btn-new').hidden = name === 'form';
  window.scrollTo(0, 0);
}
function openForm(id) {
  const c = id ? clients.find(x => x.id === id) : null;
  editing = { id: c ? c.id : null, created: c ? c.created : Date.now(), photos: c ? [...(c.photos || [])] : [], stls: c ? [...(c.stls || [])] : [] };
  $('#form-title').textContent = c ? 'Modifica cliente' : 'Nuovo cliente';
  F('f-name').value = c ? c.name : '';
  F('f-email').value = c ? c.email || '' : '';
  F('f-date').value = c ? c.date : todayISO();
  F('f-stato').value = c ? c.stato || '' : '';
  F('f-link').value = c ? c.link || '' : '';
  F('f-notes').value = c ? c.notes || '' : '';
  F('f-hours').value = c && c.hours ? c.hours : '';
  F('f-rate').value = c ? c.rate : settings.rate;
  const mode = c ? c.matMode : 'filament';
  document.querySelector(`input[name=mmode][value=${mode}]`).checked = true;
  F('f-grams').value = c && c.grams ? c.grams : '';
  F('f-eurg').value = c ? c.eurG : settings.eurG;
  F('f-matdirect').value = c && c.matDirect ? c.matDirect : '';
  F('f-price').value = c && c.price ? c.price : '';
  F('f-stl').value = ''; F('f-photos').value = '';
  F('photo-error').hidden = true; F('photo-card').classList.remove('invalid');
  F('f-name').classList.remove('invalid');
  renderFiles(); renderPhotos(); syncMode(); renderCalc();
  showView('form');
  if (!c) F('f-name').focus({ preventScroll: true });
}
function closeForm() { editing = null; showView('list'); }
function renderPhotos() {
  const box = F('photo-list'); box.innerHTML = '';
  editing.photos.forEach((p, i) => {
    const d = document.createElement('div'); d.className = 'thumb';
    d.innerHTML = `<img src="${urlOf(p.thumb || p.blob)}" alt="Foto ${i + 1}"><button type="button" aria-label="Rimuovi foto">✕</button>`;
    d.querySelector('img').onclick = () => openLightbox(editing.photos.map(x => x.blob), i);
    d.querySelector('button').onclick = () => { editing.photos.splice(i, 1); renderPhotos(); };
    box.appendChild(d);
  });
  if (editing.photos.length) { F('photo-error').hidden = true; F('photo-card').classList.remove('invalid'); }
}
function renderFiles() {
  const ul = F('stl-list'); ul.innerHTML = '';
  editing.stls.forEach((s, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span>📦 ${esc(s.name)}</span><small>${fmtSize(s.blob.size)}</small><button type="button" aria-label="Rimuovi file">✕</button>`;
    li.querySelector('button').onclick = () => { editing.stls.splice(i, 1); renderFiles(); };
    ul.appendChild(li);
  });
}
function syncMode() {
  const direct = document.querySelector('input[name=mmode]:checked').value === 'direct';
  F('mat-filament').hidden = direct; F('mat-direct').hidden = !direct;
}
function formData() {
  return {
    name: F('f-name').value.trim(), email: F('f-email').value.trim(), date: F('f-date').value || todayISO(),
    stato: F('f-stato').value, link: F('f-link').value.trim(), notes: F('f-notes').value.trim(),
    hours: num(F('f-hours').value), rate: num(F('f-rate').value),
    matMode: document.querySelector('input[name=mmode]:checked').value,
    grams: num(F('f-grams').value), eurG: num(F('f-eurg').value), matDirect: num(F('f-matdirect').value),
    price: num(F('f-price').value)
  };
}
function renderCalc() {
  const k = costs(formData());
  F('calc').innerHTML = `
    <div><span>Costo elettricità</span><b>${eur(k.elec)}</b></div>
    <div><span>Costo materiali</span><b>${eur(k.mat)}</b></div>
    <div><span>Costi totali</span><b>${eur(k.cost)}</b></div>
    <div class="tot"><span>Margine</span><span class="${k.margin < 0 ? 'neg' : ''}">${eur(k.margin)} · ${pctTxt(k.pct)}</span></div>`;
}
async function addPhotos(files) {
  const list = [...files].filter(f => f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i.test(f.name));
  if (!list.length) return;
  const btn = F('btn-save'); btn.disabled = true;
  let fail = 0;
  for (const f of list) { try { editing.photos.push(await processPhoto(f)); } catch { fail++; } }
  btn.disabled = false; renderPhotos();
  if (fail) toast(`${fail} immagine/i non leggibile/i (formato non supportato)`, true);
}
function addStl(files) {
  for (const f of files) editing.stls.push({ id: uid(), name: f.name, type: f.type || 'model/stl', blob: new Blob([f], { type: f.type || 'model/stl' }) });
  renderFiles();
}
async function saveForm(e) {
  e.preventDefault();
  const d = formData();
  let ok = true;
  F('f-name').classList.toggle('invalid', !d.name);
  if (!d.name) { ok = false; F('f-name').focus(); }
  if (d.email && !F('f-email').checkValidity()) { toast('Indirizzo email non valido', true); F('f-email').focus(); return; }
  if (!editing.photos.length) {
    F('photo-error').hidden = false; F('photo-card').classList.add('invalid');
    if (ok) F('photo-card').scrollIntoView({ behavior: 'smooth', block: 'center' });
    ok = false;
  }
  if (!ok) { toast(!d.name ? 'Inserisci nome e cognome' : 'Aggiungi almeno una foto del progetto', true); return; }
  const rec = { id: editing.id || uid(), created: editing.created, updated: Date.now(), ...d, photos: editing.photos, stls: editing.stls };
  try { await dbPut(rec); } catch (err) { toast('Errore di salvataggio: spazio insufficiente?', true); return; }
  const wasEdit = !!editing.id;
  closeForm(); await reload(); toast(wasEdit ? 'Scheda aggiornata' : 'Cliente aggiunto');
}

/* ---------- Impostazioni ---------- */
function openSettings() {
  F('s-rate').value = settings.rate; F('s-eurg').value = settings.eurG; open(F('dlg-settings'));
}
async function saveSettings(e) {
  e.preventDefault();
  settings = { rate: num(F('s-rate').value), eurG: num(F('s-eurg').value) };
  await setSetting('rate', settings.rate); await setSetting('eurG', settings.eurG);
  close(F('dlg-settings')); toast('Impostazioni salvate');
}

/* ---------- Export / Import ---------- */
function download(name, blob) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const toDataURL = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
const fromDataURL = async u => (await fetch(u)).blob();
const stamp = () => todayISO();

async function exportJSON() {
  if (!clients.length) { toast('Nessun dato da esportare', true); return; }
  toast('Preparazione backup…');
  const out = { app: 'gestionale-nebula', version: 1, exportedAt: new Date().toISOString(), settings, clients: [] };
  for (const c of clients) {
    const { photos, stls, ...rest } = c;
    out.clients.push({
      ...rest,
      photos: await Promise.all((photos || []).map(async p => ({ id: p.id, name: p.name, type: p.blob.type, data: await toDataURL(p.blob), thumb: p.thumb ? await toDataURL(p.thumb) : null }))),
      stls: await Promise.all((stls || []).map(async s => ({ id: s.id, name: s.name, type: s.type || s.blob.type, size: s.blob.size, data: await toDataURL(s.blob) })))
    });
  }
  download(`gestionale-nebula-backup-${stamp()}.json`, new Blob([JSON.stringify(out)], { type: 'application/json' }));
  toast('Backup scaricato');
}
function exportCSV() {
  if (!clients.length) { toast('Nessun dato da esportare', true); return; }
  const dec4 = n => String(Math.round(n * 10000) / 10000).replace('.', ',');
  const dec = n => String(Math.round(n * 100) / 100).replace('.', ',');
  const cell = v => { v = String(v ?? ''); if (/^[=+\-@\t\r]/.test(v) && !/^-?[\d.,]+$/.test(v)) v = "'" + v; return /[";\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const head = ['Nome e Cognome', 'Email', 'Data registrazione', 'Stato', 'Link Bambu/MakerWorld', 'File STL', 'N. foto', 'Note', 'Ore di stampa', 'Tariffa €/h', 'Costo elettricità €', 'Grammi filamento', '€/g', 'Costo materiali €', 'Costi totali €', 'Prezzo di vendita €', 'Margine €', 'Margine %'];
  const rows = [...clients].sort((a, b) => (a.date || '').localeCompare(b.date || '')).map(c => {
    const k = costs(c);
    return [c.name, c.email, fmtDate(c.date), c.stato, c.link, (c.stls || []).map(s => s.name).join(' | '), (c.photos || []).length, c.notes,
      dec(num(c.hours)), dec(num(c.rate)), dec(k.elec), c.matMode === 'direct' ? '' : dec(num(c.grams)), c.matMode === 'direct' ? '' : dec4(num(c.eurG)),
      dec(k.mat), dec(k.cost), dec(k.price), dec(k.margin), k.pct === null ? '' : dec(k.pct)].map(cell).join(';');
  });
  download(`gestionale-nebula-clienti-${stamp()}.csv`, new Blob(['\ufeff' + [head.map(cell).join(';'), ...rows].join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  toast('CSV scaricato');
}
let pendingImport = null;
async function readImport(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { toast('File non valido', true); return; }
  if (!data || data.app !== 'gestionale-nebula' || !Array.isArray(data.clients)) { toast('Non è un backup di Gestionale Nebula', true); return; }
  pendingImport = data;
  $('#import-info').textContent = `Il backup contiene ${data.clients.length} client${data.clients.length === 1 ? 'e' : 'i'} (esportato il ${data.exportedAt ? new Date(data.exportedAt).toLocaleString('it-IT') : '—'}). Unendo, le schede con lo stesso ID vengono aggiornate.`;
  close(F('dlg-data')); open(F('dlg-import'));
}
async function doImport(replace) {
  const data = pendingImport; if (!data) return;
  close(F('dlg-import')); toast('Importazione…');
  try {
    if (replace) await dbClear();
    for (const c of data.clients) {
      const photos = await Promise.all((c.photos || []).map(async p => ({ id: p.id || uid(), name: p.name, blob: await fromDataURL(p.data), thumb: p.thumb ? await fromDataURL(p.thumb) : null })));
      for (const p of photos) if (!p.thumb) { try { p.thumb = await scaleToBlob(await loadBitmap(p.blob), 360, 0.72); } catch { p.thumb = null; } }
      const stls = await Promise.all((c.stls || []).map(async s => ({ id: s.id || uid(), name: s.name, type: s.type, blob: await fromDataURL(s.data) })));
      if (c.eurKg != null && c.eurG == null) c.eurG = num(c.eurKg) / 1000;
      await dbPut({ ...c, id: c.id || uid(), created: c.created || Date.now(), photos, stls });
    }
    if (replace && data.settings) {
      settings = { rate: num(data.settings.rate), eurG: num(data.settings.eurG) || settings.eurG };
      await setSetting('rate', settings.rate); await setSetting('eurG', settings.eurG);
    }
    await reload(); toast('Importazione completata');
  } catch (err) { console.error(err); toast('Errore durante l\'importazione', true); }
  pendingImport = null;
}

/* ---------- Init ---------- */
async function init() {
  try { db = await openDB(); }
  catch { document.querySelector('main').innerHTML = '<div class="empty"><h2>Archivio non disponibile</h2><p>Il browser non permette il salvataggio locale (navigazione privata?). Apri l\'app in una finestra normale.</p></div>'; return; }
  settings = { rate: await getSetting('rate', 0.10), eurG: await getSetting('eurG', 0.025) };
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  $('#search').oninput = renderList; $('#sort').onchange = renderList; $('#filter-stato').onchange = renderList;
  $('#btn-new').onclick = $('#btn-new-empty').onclick = () => openForm(null);
  $('#btn-cancel').onclick = $('#btn-cancel2').onclick = closeForm;
  $('#form').onsubmit = saveForm;
  $('#form').addEventListener('input', renderCalc);
  document.querySelectorAll('input[name=mmode]').forEach(r => r.onchange = () => { syncMode(); renderCalc(); });
  F('f-photos').onchange = async e => { await addPhotos(e.target.files); e.target.value = ''; };
  F('f-stl').onchange = e => { addStl(e.target.files); e.target.value = ''; };
  F('f-name').addEventListener('input', () => F('f-name').classList.remove('invalid'));

  $('#btn-settings').onclick = openSettings;
  F('settings-form').onsubmit = saveSettings; F('s-cancel').onclick = () => close(F('dlg-settings'));
  $('#btn-data').onclick = () => open(F('dlg-data')); F('data-close').onclick = () => close(F('dlg-data'));
  F('btn-export-json').onclick = exportJSON; F('btn-export-csv').onclick = exportCSV;
  F('btn-import').onclick = () => F('import-file').click();
  F('import-file').onchange = e => { if (e.target.files[0]) readImport(e.target.files[0]); e.target.value = ''; };
  F('imp-merge').onclick = () => doImport(false);
  F('imp-replace').onclick = async () => { if (await confirmBox('Sostituire tutti i dati?', 'Tutte le schede attuali verranno cancellate e rimpiazzate dal backup.', 'Sostituisci')) doImport(true); else { open(F('dlg-import')); } };
  F('imp-cancel').onclick = () => { pendingImport = null; close(F('dlg-import')); };

  F('lb-close').onclick = () => close(F('dlg-lightbox'));
  F('lb-prev').onclick = () => lbStep(-1); F('lb-next').onclick = () => lbStep(1);
  F('dlg-lightbox').addEventListener('click', e => { if (e.target === F('dlg-lightbox')) close(F('dlg-lightbox')); });
  document.addEventListener('keydown', e => {
    if (!F('dlg-lightbox').open) return;
    if (e.key === 'ArrowLeft') lbStep(-1); if (e.key === 'ArrowRight') lbStep(1);
  });
  for (const id of ['dlg-detail', 'dlg-settings', 'dlg-data']) F(id).addEventListener('click', e => { if (e.target === F(id)) close(F(id)); });

  await reload();
}
init();
})();
