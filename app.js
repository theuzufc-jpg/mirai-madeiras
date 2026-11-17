'use strict';
/* Mirai — site público. Mesma lógica do original (lista, catálogo, diálogos, mapa, notebook)
   + materiais vindos do painel (Supabase), intro nova, animações de rolagem e pedido de material. */
document.documentElement.classList.add('js');
const CFG = window.MIRAI || {};
const one = (s, p = document) => p.querySelector(s);
const all = (s, p = document) => [...p.querySelectorAll(s)];
const dataKey = 'mirai-materials-v2';
const freightKey = 'mirai-delivery-v2';
let waNumber = CFG.whatsapp || '5512991862507';
const wa = () => 'https://wa.me/' + waNumber + '?text=';
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const DEPT_ORDER = ['Madeiras', 'Construção', 'Hidráulica', 'Acabamentos', 'Pintura', 'Elétrica'];
let materialMap = {}, materials = [], settings = { mostrar_precos: true }, list = [], noticeTimer;

/* ---------- utilidades ---------- */
function read(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function write(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* a página continua funcionando */ } }
function node(tag, text, cls) { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (cls) el.className = cls; return el; }
function anchor(text, url, cls) { const a = node('a', text, cls); a.href = url; return a; }
function action(text, label, cb, cls) { const b = node('button', text, cls); b.type = 'button'; b.setAttribute('aria-label', label); b.onclick = cb; return b; }
function photoUrl(f) { f = String(f || ''); if (!f) return '/logo.webp'; return /^https?:\/\//.test(f) || f.startsWith('/') ? f : '/img/' + f + '.webp'; }
function money(v) { return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function priceText(m) { if (!settings.mostrar_precos || m.price == null) return ''; return money(m.price) + (m.unit ? ' / ' + m.unit : ''); }
function stockInfo(m) {
  if (m.stock === 'esgotado') return { cls: 'out', text: 'Esgotado' };
  if (m.stock === 'disponivel') return { cls: 'ok', text: m.qty != null ? 'Em estoque · ' + m.qty : 'Em estoque' };
  return null;
}

/* ---------- dados (painel → site) ---------- */
async function api(path, opts = {}) {
  const res = await fetch(CFG.supabaseUrl + path, { ...opts, headers: { apikey: CFG.supabaseKey, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  if (!res.ok) { let msg = 'Erro ' + res.status; try { const j = await res.json(); msg = j.message || j.msg || msg; } catch { } throw new Error(msg); }
  return res.status === 204 ? null : res.json();
}
function normalize(row) {
  return { id: row.id, name: row.nome, cat: row.departamento, spec: row.spec || '', guide: row.guia || '', photo: row.foto || '', price: row.preco == null ? null : Number(row.preco), unit: row.unidade || '', stock: row.estoque_status || 'consulta', qty: row.estoque_qtd, order: row.ordem || 0 };
}
async function loadMaterials() {
  try {
    if (!CFG.supabaseUrl) throw new Error('sem banco');
    const [rows, conf] = await Promise.all([
      api('/rest/v1/materiais?select=id,nome,departamento,spec,guia,foto,preco,unidade,estoque_status,estoque_qtd,ordem&ativo=eq.true&order=ordem.asc,nome.asc'),
      api('/rest/v1/config?select=chave,valor').catch(() => [])
    ]);
    for (const c of conf) settings[c.chave] = c.valor;
    if (settings.whatsapp && /^\d{12,13}$/.test(String(settings.whatsapp))) waNumber = String(settings.whatsapp);
    write('mirai-cache-v4', rows);
    return rows.map(normalize);
  } catch (err) {
    console.warn('[Mirai] usando cópia local do catálogo:', err.message);
    const cached = read('mirai-cache-v4', null);
    if (Array.isArray(cached) && cached.length) return cached.map(normalize);
    const res = await fetch('/materials.json');
    return (await res.json()).map(normalize);
  }
}
function syncWaLinks() { all('[data-wa]').forEach(a => { const u = new URL(a.href); a.href = 'https://wa.me/' + waNumber + u.search; }); }

/* ---------- lista de orçamento (igual ao original) ---------- */
function loadList() {
  const saved = read(dataKey, null);
  if (Array.isArray(saved)) return saved.filter(r => r && materialMap[r.id] && Number.isInteger(r.qty) && r.qty > 0).map(r => ({ id: r.id, qty: Math.min(99999, r.qty), notes: String(r.notes || '').slice(0, 300) }));
  return [];
}
function syncCount() { all('[data-count]').forEach(b => { if (b.textContent !== String(list.length)) { b.textContent = list.length; b.animate?.([{ transform: 'scale(1.5)' }, { transform: 'scale(1)' }], { duration: 380, easing: 'cubic-bezier(.22,1,.36,1)' }); } }); }
function save() { write(dataKey, list); syncCount(); }
function tell(text, withLink = false) {
  const notice = one('#notice'); clearTimeout(noticeTimer);
  notice.replaceChildren(document.createTextNode(text));
  if (withLink) { const a = node('a', 'Ver lista'); a.href = '/orcamento/'; notice.append(a); }
  noticeTimer = setTimeout(() => notice.replaceChildren(), 5200);
}
function add(id, qty, notes) {
  const m = materialMap[id]; if (!m || m.stock === 'esgotado') return;
  list = loadList();
  const ex = list.find(r => r.id === id && r.notes === notes);
  if (ex) ex.qty = Math.min(99999, ex.qty + qty); else list.push({ id, qty, notes });
  save(); tell(m.name + ' na sua lista.', true);
}
function renderList() {
  const target = one('#quote'); if (!target) return;
  target.replaceChildren();
  if (!list.length) { const e = node('div', undefined, 'empty'); e.append(node('h2', 'Sua lista está vazia'), node('p', 'Abra o catálogo e escolha o primeiro material.'), anchor('Explorar catálogo', '/?pagina=catalogo', 'button')); target.append(e); return; }
  const grid = node('div', undefined, 'quoteGrid'), rows = node('div'), summary = node('section', undefined, 'quoteSummary');
  const delivery = read(freightKey, {}) || {};
  const place = node('input'); place.placeholder = 'Cidade e bairro'; place.maxLength = 160; place.value = delivery.place || '';
  const destLabel = node('label', 'Destino para entrega (opcional)'); destLabel.append(place);
  const send = anchor('Enviar lista pelo WhatsApp', '#', 'button'); send.target = '_blank'; send.rel = 'noopener';
  function updateMessage() {
    const lines = list.map(r => r.qty + ' × ' + materialMap[r.id].name + (r.notes ? ' — ' + r.notes : ''));
    send.href = wa() + encodeURIComponent(['Olá, Mirai! Gostaria de um orçamento.', ...lines, place.value.trim() ? 'Entrega: ' + place.value.trim() : ''].filter(Boolean).join('\n'));
  }
  function revise(i, d) { list[i].qty = Math.min(99999, Math.max(1, list[i].qty + d)); save(); renderList(); }
  list.forEach((r, i) => {
    const m = materialMap[r.id], row = node('article', undefined, 'quoteItem'), photo = node('img');
    photo.src = photoUrl(m.photo); photo.alt = '';
    const body = node('div'), controls = node('div', undefined, 'controls');
    const minus = action('−', 'Diminuir quantidade de ' + m.name, () => revise(i, -1)); minus.disabled = r.qty <= 1;
    controls.append(minus, node('span', String(r.qty)), action('+', 'Aumentar quantidade de ' + m.name, () => revise(i, 1)), action('Remover', 'Remover ' + m.name, () => { list.splice(i, 1); save(); renderList(); }, 'remove'));
    const note = node('input'); note.value = r.notes || ''; note.placeholder = 'Medida ou observação'; note.setAttribute('aria-label', 'Observação para ' + m.name); note.maxLength = 300;
    note.oninput = () => { r.notes = note.value; save(); updateMessage(); };
    body.append(anchor(m.name, '/produto/' + m.id + '/', 'itemName'), controls, note);
    row.append(photo, body); rows.append(row);
  });
  place.oninput = () => { write(freightKey, { place: place.value }); updateMessage(); };
  summary.append(node('h2', 'Resumo da consulta'), node('p', list.length + ' ' + (list.length === 1 ? 'item na lista' : 'itens na lista')), destLabel, send, node('p', 'Confira os materiais na conversa e confirme o envio. A equipe retorna com valores e disponibilidade.', 'fine'), anchor('Continuar no catálogo', '/?pagina=catalogo', 'under'));
  grid.append(rows, summary); target.append(grid); updateMessage();
}
function openQuote() { renderList(); if (!one('#quote-dialog').open) one('#quote-dialog').showModal(); }
function showProduct(id) {
  const m = materialMap[id]; if (!m) return;
  const target = one('#product-body'); target.replaceChildren();
  const img = node('img'); img.src = photoUrl(m.photo); img.alt = 'Imagem ilustrativa de ' + m.name;
  const title = node('h2', m.name); title.id = 'product-title';
  const parts = [img, node('small', m.cat), title];
  if (m.spec) parts.push(node('p', m.spec, 'spec'));
  const pt = priceText(m); if (pt) parts.push(node('span', pt, 'price'));
  const st = stockInfo(m); if (st) parts.push(node('p', st.text, 'fine'));
  parts.push(node('p', m.guide || 'Informe as medidas previstas no seu projeto.'));
  if (m.stock === 'esgotado') {
    parts.push(anchor('Perguntar quando chega', wa() + encodeURIComponent('Olá, Mirai! Quando chega ' + m.name + '?'), 'button'));
    parts.at(-1).target = '_blank';
  } else {
    const form = node('form'), qty = node('input'), notes = node('textarea');
    qty.type = 'number'; qty.min = 1; qty.max = 99999; qty.step = 1; qty.value = 1; qty.required = true; notes.maxLength = 300;
    const ql = node('label', 'Quantidade'), nl = node('label', 'Medidas ou observações'); ql.append(qty); nl.append(notes);
    const submit = node('button', 'Adicionar à minha lista', 'button'); submit.type = 'submit'; form.append(ql, nl, submit);
    form.onsubmit = e => { e.preventDefault(); if (!form.reportValidity()) return; add(id, Number(qty.value), notes.value.trim()); one('#product-dialog').close(); };
    parts.push(form);
  }
  parts.push(node('p', 'Imagem ilustrativa. A equipe confirma medidas, preço e disponibilidade.', 'fine'));
  target.append(...parts);
  one('#product-dialog').showModal();
}

/* ---------- catálogo ---------- */
function departments() {
  const seen = [...new Set(materials.map(m => m.cat))];
  return [...DEPT_ORDER.filter(d => seen.includes(d)), ...seen.filter(d => !DEPT_ORDER.includes(d)).sort()];
}
function renderSkeleton() {
  const box = one('#products'); if (!box) return;
  box.replaceChildren(...Array.from({ length: 8 }, () => { const a = node('article', undefined, 'product skel'); a.append(node('div', undefined, 'pack'), node('div', undefined, 'bar'), node('div', undefined, 'bar w')); return a; }));
}
function renderProducts() {
  const box = one('#products'); if (!box) return;
  const cards = materials.map((m, i) => {
    const art = node('article', undefined, 'product enter'); art.dataset.cat = fold(m.cat); art.dataset.search = [m.name, m.spec, m.cat].join(' '); art.style.setProperty('--i', i);
    const link = anchor('', '/produto/' + m.id + '/'), pack = node('div', undefined, 'pack'), img = node('img');
    img.loading = 'lazy'; img.src = photoUrl(m.photo); img.alt = ''; pack.append(img);
    const st = stockInfo(m); if (st) pack.append(node('span', st.text, 'badge ' + st.cls));
    const copy = node('div', undefined, 'pcopy'); copy.append(node('small', m.cat), node('h3', m.name));
    if (m.spec) copy.append(node('p', m.spec));
    const pt = priceText(m); if (pt) { const p = node('span', undefined, 'price'); const [v, u] = pt.split(' / '); p.append(v); if (u) p.append(' ', node('em', '/ ' + u)); copy.append(p); }
    link.append(pack, copy);
    const btn = node('button', m.stock === 'esgotado' ? 'Indisponível' : 'Adicionar à lista'); btn.type = 'button'; btn.dataset.quick = m.id;
    btn.setAttribute('aria-label', (m.stock === 'esgotado' ? m.name + ' esgotado' : 'Adicionar ' + m.name + ' à lista')); btn.disabled = m.stock === 'esgotado';
    btn.onclick = () => add(m.id, 1, '');
    art.append(link, btn); return art;
  });
  box.replaceChildren(...cards); box.removeAttribute('aria-busy');
  const filters = one('#filters');
  filters.replaceChildren(...['Todos', ...departments()].map(d => { const b = node('button', d); b.type = 'button'; b.dataset.filter = d === 'Todos' ? 'todos' : fold(d); return b; }));
  all('[data-dept-count]').forEach(el => el.textContent = departments().length);
}
function initFilters() {
  const search = one('#busca'); if (!search || one('#catalog').hidden) return;
  const params = new URLSearchParams(location.search), filters = all('[data-filter]');
  let cat = fold(params.get('categoria') || 'todos');
  search.value = params.get('busca') || params.get('q') || '';
  if (!filters.some(b => b.dataset.filter === cat)) cat = 'todos';
  let first = true;
  function apply() {
    let total = 0; const term = fold(search.value.trim()); let shown = 0;
    all('[data-search]').forEach(card => {
      const ok = (cat === 'todos' || cat === card.dataset.cat) && fold(card.dataset.search).includes(term);
      card.hidden = !ok; if (ok) { total++; card.style.transitionDelay = (first ? Math.min(shown++, 12) * 45 : 0) + 'ms'; }
    });
    filters.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.filter === cat)));
    one('#matches').textContent = total + ' ' + (total === 1 ? 'material encontrado' : 'materiais encontrados');
    one('#nothing').hidden = total > 0;
    const url = new URL(location.href);
    if (cat === 'todos') url.searchParams.delete('categoria'); else url.searchParams.set('categoria', cat);
    if (term) url.searchParams.set('q', search.value.trim()); else url.searchParams.delete('q');
    try { history.replaceState(null, '', url); } catch { }
    requestAnimationFrame(() => all('.product.enter').forEach(c => { if (!c.hidden) c.classList.remove('enter'); }));
    first = false;
  }
  filters.forEach(b => b.addEventListener('click', () => { cat = b.dataset.filter; apply(); }));
  search.addEventListener('input', apply);
  one('#reset').addEventListener('click', () => { cat = 'todos'; search.value = ''; apply(); search.focus(); });
  apply();
}

/* ---------- telas, cabeçalho, mapa (igual ao original) ---------- */
function initScreens() {
  const catalog = new URLSearchParams(location.search).get('pagina') === 'catalogo';
  one('#home').hidden = catalog; one('#catalog').hidden = !catalog;
  if (catalog) { document.title = 'Catálogo de materiais | Mirai Madeireira'; one('#menu a[href="/?pagina=catalogo"]')?.setAttribute('aria-current', 'page'); }
  all('.closeDialog').forEach(b => b.onclick = () => b.closest('dialog').close());
  all('dialog').forEach(d => d.addEventListener('click', e => { if (e.target === d) d.close(); }));
  document.addEventListener('click', e => {
    if (e.defaultPrevented) return;
    const a = e.target.closest('a'); if (!a) return;
    const url = new URL(a.href, location.href); if (url.origin !== location.origin) return;
    if (url.pathname === '/orcamento/') { e.preventDefault(); openQuote(); }
    if (url.pathname.startsWith('/produto/')) { e.preventDefault(); showProduct(url.pathname.split('/')[2]); }
    if (url.pathname === '/' && url.hash === '#encomenda' && !one('#catalog').hidden) { e.preventDefault(); location.href = '/#encomenda'; }
  });
  one('#menu').addEventListener('click', () => { one('#menu').classList.remove('open'); one('.menuToggle').setAttribute('aria-expanded', 'false'); });
  one('#map-toggle').onclick = e => { const f = one('.mapFrame'), on = f.classList.toggle('active'); one('iframe', f).tabIndex = on ? 0 : -1; e.target.setAttribute('aria-pressed', on); e.target.textContent = on ? 'Voltar à rolagem' : 'Interagir com o mapa'; };
}
function initHeader() {
  const toggle = one('.menuToggle'), nav = one('#menu');
  function menu(open) { nav.classList.toggle('open', open); toggle.setAttribute('aria-expanded', String(open)); toggle.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu'); }
  toggle.addEventListener('click', () => menu(!nav.classList.contains('open')));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && nav.classList.contains('open')) { menu(false); toggle.focus(); } });
  document.addEventListener('click', e => { if (!e.target.closest('header')) menu(false); });
}

/* ---------- intro ---------- */
function runIntro(done) {
  const intro = one('#intro');
  const home = !one('#home').hidden;
  let seen = false; try { seen = !!sessionStorage.getItem('miraiIntroV4'); } catch { }
  if (!intro || !home || reduced() || location.hash || seen) { intro && (intro.hidden = true); done(); return; }
  intro.hidden = false; document.body.classList.add('introing');
  let finished = false;
  const yearEl = one('[data-year]', intro); const start = performance.now();
  (function tick(t) { const p = Math.min(1, (t - start - 1250) / 900); if (p > 0) yearEl.textContent = String(Math.round(1900 + 72 * (1 - Math.pow(1 - p, 3)))); if (p < 1 && !finished) requestAnimationFrame(tick); })(start);
  function finish() {
    if (finished) return; finished = true; yearEl.textContent = '1972';
    try { sessionStorage.setItem('miraiIntroV4', '1'); } catch { }
    intro.classList.add('opening'); document.body.classList.remove('introing'); done();
    setTimeout(() => { intro.hidden = true; intro.classList.remove('opening'); }, 950);
  }
  one('.skipIntro', intro).addEventListener('click', finish);
  setTimeout(finish, 2650);
}

/* ---------- movimento ao rolar ---------- */
function setupMotion() {
  const progress = one('.progress'), header = one('header'), hero = one('.hero'), storyImg = one('.storyImg img');
  const observer = 'IntersectionObserver' in window && !reduced() ? new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); observer.unobserve(e.target); if (e.target.matches('.stats')) countUp(e.target); }
  }, { threshold: .14, rootMargin: '0px 0px -6% 0px' }) : null;
  all('[data-reveal]').forEach(el => observer ? observer.observe(el) : el.classList.add('in'));
  if (!observer) all('.stats').forEach(countUp);
  // notebook do Instagram: vídeo que avança/volta conforme a rolagem + parallax + barra de progresso
  const scene = one('.social'), video = one('.turn video');
  let vTarget = 0, vLoaded = false, vFailed = false;
  if (video) {
    const fail = () => { vFailed = true; video.hidden = true; one('.turnFallback').hidden = false; };
    video.addEventListener('error', fail);
    const load = () => { if (vLoaded) return; vLoaded = true; video.src = video.dataset.src; video.preload = 'auto'; video.load(); };
    if ('IntersectionObserver' in window) { const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { load(); io.disconnect(); } }, { rootMargin: '900px 0px' }); io.observe(scene); } else load();
    if (reduced()) { video.addEventListener('loadeddata', () => { try { video.currentTime = video.duration - .05; } catch { } }, { once: true }); }
  }
  function seekVideo() {
    if (!video || vFailed || video.readyState < 1 || !video.duration) return;
    const want = vTarget * (video.duration - .05);
    if (Math.abs(video.currentTime - want) > 1 / 48 && !video.seeking) video.currentTime = want;
  }
  if (video) video.addEventListener('seeked', seekVideo);
  let pending = false;
  function frame() {
    pending = false;
    const h = document.documentElement, max = h.scrollHeight - innerHeight;
    progress.style.setProperty('--p', max > 0 ? (scrollY / max).toFixed(4) : 0);
    header.classList.toggle('scrolled', scrollY > 8);
    if (reduced()) return;
    if (hero && !hero.closest('[hidden]') && matchMedia('(min-width:761px)').matches) { const r = hero.getBoundingClientRect(); if (r.bottom > 0) hero.style.setProperty('--py', (-r.top * .18).toFixed(1) + 'px'); }
    if (storyImg && !storyImg.closest('[hidden]')) { const r = storyImg.parentElement.getBoundingClientRect(); const p = Math.min(1, Math.max(0, (innerHeight - r.top) / (innerHeight + r.height))); storyImg.style.setProperty('--sp', p.toFixed(3)); }
    if (scene && video && matchMedia('(min-width:761px)').matches) {
      // começa a girar quando a seção entra na tela e termina de frente quando ela chega perto do meio
      const r = video.parentElement.getBoundingClientRect(); vTarget = Math.min(1, Math.max(0, (innerHeight - r.top) / (innerHeight * .5 + r.height * .5))); video.parentElement.classList.toggle('done', vTarget > .985 && !vFailed);
      seekVideo();
    }
  }
  const update = () => { if (!pending) { pending = true; requestAnimationFrame(frame); } };
  addEventListener('scroll', update, { passive: true }); addEventListener('resize', update); frame();
}
function countUp(box) {
  const years = new Date().getFullYear() - 1972;
  all('[data-years]', box).forEach(el => el.dataset.countTo = years);
  all('[data-count-to],[data-years]', box).forEach(el => {
    const to = Number(el.dataset.countTo || el.textContent), from = Number(el.dataset.from || 0);
    if (reduced()) { el.textContent = to; return; }
    const t0 = performance.now(), dur = 1400;
    (function step(t) { const p = Math.min(1, (t - t0) / dur); el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - p, 4))); if (p < 1) requestAnimationFrame(step); })(t0);
  });
}

/* ---------- pedido de material fora do catálogo ---------- */
function initOrder() {
  const form = one('#order-form'); if (!form) return;
  const done = one('#order-done'), err = one('.formError', form), btn = one('button[type=submit]', form);
  const prazo = form.elements.prazo; const today = new Date(); today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
  prazo.min = today.toISOString().slice(0, 10);
  all('.quick button', form).forEach(b => b.addEventListener('click', () => {
    all('.quick button', form).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    if (b.dataset.days === '') { prazo.value = ''; return; }
    const d = new Date(today); d.setDate(d.getDate() + Number(b.dataset.days)); prazo.value = d.toISOString().slice(0, 10);
  }));
  prazo.addEventListener('input', () => all('.quick button', form).forEach(x => x.setAttribute('aria-pressed', 'false')));
  const localBox = one('[data-local]', form);
  form.addEventListener('change', () => { localBox.hidden = form.elements.modo.value === 'retirada'; });
  form.elements.whatsapp.addEventListener('input', e => {
    const d = e.target.value.replace(/\D/g, '').slice(0, 11);
    e.target.value = d.length > 6 ? `(${d.slice(0, 2)}) ${d.slice(2, d.length - 4)}-${d.slice(-4)}` : d.length > 2 ? `(${d.slice(0, 2)}) ${d.slice(2)}` : d;
  });
  function message(f, id) {
    const when = f.prazo ? new Date(f.prazo + 'T12:00').toLocaleDateString('pt-BR') : 'sem pressa';
    return ['Olá, Mirai! Fiz um pedido de material pelo site' + (id ? ' (nº ' + id + ')' : '') + '.', 'Material: ' + f.material, f.quantidade ? 'Quantidade: ' + f.quantidade : '', 'Para: ' + when, f.modo === 'retirada' ? 'Vou retirar na loja.' : 'Entrega' + (f.local ? ': ' + f.local : ' na obra'), f.detalhes ? 'Detalhes: ' + f.detalhes : '', f.nome ? 'Nome: ' + f.nome : ''].filter(Boolean).join('\n');
  }
  form.addEventListener('submit', async e => {
    e.preventDefault(); err.textContent = '';
    const f = Object.fromEntries(new FormData(form)); for (const k in f) f[k] = String(f[k]).trim();
    const bad = [];
    form.elements.material.setAttribute('aria-invalid', f.material.length < 2); if (f.material.length < 2) bad.push('o material');
    const phoneOk = f.whatsapp.replace(/\D/g, '').length >= 10; form.elements.whatsapp.setAttribute('aria-invalid', !phoneOk); if (!phoneOk) bad.push('um WhatsApp com DDD');
    if (bad.length) { err.textContent = 'Informe ' + bad.join(' e ') + '.'; form.querySelector('[aria-invalid=true]').focus(); return; }
    btn.disabled = true; btn.textContent = 'Enviando…';
    let id = null;
    try {
      id = await api('/rest/v1/rpc/criar_pedido', { method: 'POST', body: JSON.stringify({ p_material: f.material, p_quantidade: f.quantidade, p_detalhes: f.detalhes, p_nome: f.nome, p_whatsapp: f.whatsapp, p_local: f.modo === 'retirada' ? '' : f.local, p_prazo: f.prazo || null, p_modo: f.modo, p_site: f.site }) });
    } catch (ex) {
      btn.disabled = false; btn.textContent = 'Enviar pedido';
      if (/Muitos pedidos|Informe/.test(ex.message)) { err.textContent = ex.message; return; }
      err.textContent = 'Não conseguimos registrar agora. Envie pelo WhatsApp:';
      const a = anchor('abrir WhatsApp', wa() + encodeURIComponent(message(f)), ''); a.target = '_blank'; a.rel = 'noopener'; err.append(' ', a); return;
    }
    one('.doneNo', done).textContent = 'Pedido nº ' + id;
    one('.slipNo', form).textContent = 'Nº ' + id;
    const link = one('[data-order-wa]', done); link.href = wa() + encodeURIComponent(message(f, id));
    form.hidden = true; done.hidden = false; done.focus({ preventScroll: true });
    done.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'center' });
    btn.disabled = false; btn.textContent = 'Enviar pedido';
  });
  one('[data-order-new]', done).addEventListener('click', () => { form.reset(); localBox.hidden = false; one('.slipNo', form).textContent = 'Nº —'; done.hidden = true; form.hidden = false; form.elements.material.focus(); });
  // vindo do catálogo com a busca que não achou nada
  const q = new URLSearchParams(location.search).get('pedir'); if (q) form.elements.material.value = q.slice(0, 200);
}

/* ---------- início ---------- */
async function start() {
  initScreens(); initHeader();
  const heroReady = () => one('.hero')?.classList.add('heroReady');
  runIntro(heroReady);
  setupMotion(); initOrder();
  one('[data-ask]')?.addEventListener('click', e => { const t = one('#busca').value.trim(); if (t) { e.preventDefault(); location.href = '/?pedir=' + encodeURIComponent(t) + '#encomenda'; } });
  renderSkeleton();
  try {
    materials = await loadMaterials();
    materialMap = Object.fromEntries(materials.map(m => [m.id, m]));
  } catch { tell('Não foi possível carregar o catálogo. Atualize a página.'); return; }
  syncWaLinks(); renderProducts(); initFilters();
  list = loadList(); save(); renderList();
  addEventListener('pageshow', () => { list = loadList(); syncCount(); renderList(); });
  addEventListener('storage', e => { if (e.key === dataKey) { list = loadList(); syncCount(); renderList(); } });
  const p = new URLSearchParams(location.search);
  if (p.get('produto') && materialMap[p.get('produto')]) showProduct(p.get('produto'));
  if (p.has('lista')) openQuote();
}
start();
