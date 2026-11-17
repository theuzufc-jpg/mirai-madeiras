'use strict';
/* Painel Mirai — materiais (preço, estoque, foto, ordem), pedidos e ajustes.
   Fala direto com o Supabase. As regras do banco só deixam e-mails da tabela "admins" alterar. */
const CFG = window.MIRAI;
const $ = (s, p = document) => p.querySelector(s);
const $$ = (s, p = document) => [...p.querySelectorAll(s)];
const SKEY = 'mirai-painel-sessao';
let sess = null, items = [], orders = [], settings = {}, editing = null, newPhoto = null, ofilter = 'aberto', toastT;

function el(tag, text, cls) { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; }
function toast(t) { clearTimeout(toastT); $('#toast').textContent = t; toastT = setTimeout(() => $('#toast').textContent = '', 3400); }
const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const money = v => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
function photoUrl(f) { f = String(f || ''); if (!f) return '/logo.webp'; return /^https?:\/\//.test(f) || f.startsWith('/') ? f : '/img/' + f + '.webp'; }
function slug(s) { return fold(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'material'; }

/* ---------- sessão ---------- */
function keep(d) {
  sess = d ? { access: d.access_token, refresh: d.refresh_token, exp: Date.now() + (d.expires_in || 3600) * 1000, email: d.user?.email || sess?.email || '' } : null;
  try { sess ? localStorage.setItem(SKEY, JSON.stringify(sess)) : localStorage.removeItem(SKEY); } catch { }
}
async function auth(path, body, method = 'POST', bearer) {
  const headers = { apikey: CFG.supabaseKey, 'Content-Type': 'application/json' };
  if (bearer) headers.Authorization = 'Bearer ' + bearer;
  const r = await fetch(CFG.supabaseUrl + '/auth/v1/' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const m = j.msg || j.error_description || j.message || '';
    if (/invalid login|invalid_grant|credentials/i.test(m + j.error_code)) throw new Error('E-mail ou senha incorretos.');
    throw new Error(m || 'Não foi possível concluir (' + r.status + ').');
  }
  return j;
}
async function token() {
  if (!sess) throw new Error('Sessão encerrada. Entre de novo.');
  if (Date.now() > sess.exp - 90_000) {
    try { keep(await auth('token?grant_type=refresh_token', { refresh_token: sess.refresh })); }
    catch { leave(); throw new Error('Sessão expirada. Entre de novo.'); }
  }
  return sess.access;
}
async function api(path, opt = {}) {
  const t = await token();
  const headers = { apikey: CFG.supabaseKey, Authorization: 'Bearer ' + t, ...(typeof opt.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...(opt.headers || {}) };
  const r = await fetch(CFG.supabaseUrl + path, { ...opt, headers });
  if (r.status === 401) { leave(); throw new Error('Sessão expirada. Entre de novo.'); }
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    let m = j.message || j.error || 'Erro ' + r.status;
    if (/duplicate/.test(m)) m = 'Já existe um material com esse código.';
    if (/row-level security|permission/.test(m)) m = 'Esta conta não tem permissão para alterar.';
    if (/check constraint/.test(m)) m = 'Algum campo passou do tamanho permitido. Revise e tente de novo.';
    throw new Error(m);
  }
  if (r.status === 204) return null;
  const txt = await r.text(); return txt ? JSON.parse(txt) : null;
}
function screen(inside) { $('#login').hidden = inside; $('#app').hidden = !inside; }
function leave() { keep(null); screen(false); }

/* ---------- entrar ---------- */
$('#login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.currentTarget, err = $('.err', f), btn = $('button[type=submit]', f);
  err.textContent = '';
  if (!f.reportValidity()) return;
  btn.disabled = true; btn.textContent = 'Entrando…';
  try {
    keep(await auth('token?grant_type=password', { email: f.email.value.trim(), password: f.password.value }));
    await enter();
    f.password.value = '';
  } catch (ex) { keep(null); err.textContent = ex.message; }
  btn.disabled = false; btn.textContent = 'Entrar';
});
$('[data-show]').addEventListener('click', e => { const i = $('#login-form').password; i.type = i.type === 'password' ? 'text' : 'password'; e.target.textContent = i.type === 'password' ? 'Mostrar' : 'Ocultar'; });
$('[data-logout]').addEventListener('click', async () => { try { await auth('logout', null, 'POST', sess?.access); } catch { } leave(); toast('Você saiu do painel.'); });

async function enter() {
  const ok = await api('/rest/v1/rpc/is_admin', { method: 'POST', body: '{}' });
  if (ok !== true) { keep(null); throw new Error('Este e-mail não tem acesso ao painel.'); }
  screen(true); $('[data-user]').textContent = sess.email;
  const want = (location.hash || '').slice(1);
  tab(['materiais', 'pedidos', 'ajustes'].includes(want) ? want : 'materiais');
  await Promise.all([loadItems(), loadOrders(), loadSettings()]);
}

/* ---------- abas ---------- */
function tab(name) {
  $$('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  $$('[data-panel]').forEach(p => p.hidden = p.dataset.panel !== name);
  history.replaceState(null, '', '#' + name);
}
$$('[data-tab]').forEach(b => b.addEventListener('click', () => tab(b.dataset.tab)));

/* ---------- materiais ---------- */
async function loadItems() {
  items = await api('/rest/v1/materiais?select=*&order=ordem.asc,nome.asc');
  const depts = [...new Set(items.map(i => i.departamento))].sort((a, b) => a.localeCompare(b, 'pt'));
  const sel = $('#mat-dept'), cur = sel.value;
  sel.replaceChildren(el('option', 'Todos os departamentos'), ...depts.map(d => { const o = el('option', d); o.value = d; return o; }));
  sel.firstChild.value = ''; sel.value = depts.includes(cur) ? cur : '';
  $('#dept-options').replaceChildren(...depts.map(d => { const o = el('option'); o.value = d; return o; }));
  renderItems();
}
function renderItems() {
  const q = fold($('#mat-search').value.trim()), d = $('#mat-dept').value, st = $('#mat-state').value;
  const shown = items.filter(i => (!d || i.departamento === d) && (!q || fold([i.nome, i.spec, i.departamento].join(' ')).includes(q)) && (
    !st || (st === 'ativo' && i.ativo) || (st === 'oculto' && !i.ativo) || (st === 'esgotado' && i.estoque_status === 'esgotado') || (st === 'disponivel' && i.estoque_status === 'disponivel') || (st === 'semPreco' && i.preco == null)));
  const active = items.filter(i => i.ativo).length;
  $('[data-mat-summary]').textContent = `${items.length} materiais · ${active} no site · ${items.length - active} ocultos`;
  const box = $('#mat-list');
  if (!shown.length) { box.replaceChildren(el('div', items.length ? 'Nenhum material com esse filtro.' : 'Nenhum material ainda. Toque em “+ Novo material”.', 'empty')); return; }
  const canMove = !q && !d && !st;
  box.replaceChildren(...shown.map(i => {
    const row = el('article', null, 'mat' + (i.ativo ? '' : ' off'));
    const img = el('img'); img.src = photoUrl(i.foto); img.alt = ''; img.loading = 'lazy';
    const info = el('div'); info.append(el('h3', i.nome));
    const meta = el('div', null, 'meta'); meta.append(el('span', i.departamento));
    if (i.spec) meta.append(el('span', i.spec));
    if (i.estoque_status === 'disponivel') meta.append(el('span', 'Em estoque' + (i.estoque_qtd != null ? ' · ' + i.estoque_qtd : ''), 'pill ok'));
    if (i.estoque_status === 'esgotado') meta.append(el('span', 'Esgotado', 'pill out'));
    if (!i.ativo) meta.append(el('span', 'Oculto no site', 'pill hide'));
    info.append(meta);
    const price = el('div', i.preco == null ? 'Sob consulta' : money(i.preco) + (i.unidade ? ' / ' + i.unidade : ''), 'price');
    const acts = el('div', null, 'acts');
    if (canMove) {
      const ob = el('div', null, 'order-btns');
      const up = el('button', '▲'); up.type = 'button'; up.title = 'Subir na lista'; up.setAttribute('aria-label', 'Subir ' + i.nome); up.onclick = () => move(i, -1);
      const dn = el('button', '▼'); dn.type = 'button'; dn.title = 'Descer na lista'; dn.setAttribute('aria-label', 'Descer ' + i.nome); dn.onclick = () => move(i, 1);
      ob.append(up, dn); acts.append(ob);
    }
    const vis = el('button', i.ativo ? 'Ocultar' : 'Mostrar', 'ghost sm'); vis.type = 'button'; vis.onclick = () => quick(i, { ativo: !i.ativo }, i.ativo ? 'Oculto no site.' : 'Agora aparece no site.');
    const ed = el('button', 'Editar', 'btn sm'); ed.type = 'button'; ed.onclick = () => openEditor(i);
    acts.append(vis, ed);
    row.append(img, info, price, acts); return row;
  }));
}
['#mat-search', '#mat-dept', '#mat-state'].forEach(s => $(s).addEventListener('input', renderItems));
async function quick(i, patch, msg) {
  try { await api('/rest/v1/materiais?id=eq.' + encodeURIComponent(i.id), { method: 'PATCH', body: JSON.stringify(patch), headers: { Prefer: 'return=minimal' } }); Object.assign(i, patch); renderItems(); toast(msg); }
  catch (ex) { toast(ex.message); }
}
async function move(i, dir) {
  const idx = items.indexOf(i), other = items[idx + dir]; if (!other) return;
  // reordena tudo em passos de 10 para a ordem ficar estável
  [items[idx], items[idx + dir]] = [other, i];
  const changed = items.map((it, n) => ({ it, ordem: (n + 1) * 10 })).filter(x => x.it.ordem !== x.ordem);
  renderItems();
  try {
    await Promise.all(changed.map(x => api('/rest/v1/materiais?id=eq.' + encodeURIComponent(x.it.id), { method: 'PATCH', body: JSON.stringify({ ordem: x.ordem }), headers: { Prefer: 'return=minimal' } }).then(() => x.it.ordem = x.ordem)));
  } catch (ex) { toast(ex.message); await loadItems(); }
}

/* ---------- editor ---------- */
const ed = $('#editor'), form = $('#ed-form');
$('[data-new]').addEventListener('click', () => openEditor(null));
$$('[data-close]', ed).forEach(b => b.addEventListener('click', () => ed.close()));
function openEditor(i) {
  editing = i; newPhoto = null; form.reset(); $('.err', form).textContent = '';
  $('#ed-title').textContent = i ? 'Editar material' : 'Novo material';
  $('[data-delete]', form).hidden = !i;
  const v = i || { nome: '', departamento: $('#mat-dept').value || '', spec: '', guia: '', preco: null, unidade: '', estoque_status: 'consulta', estoque_qtd: null, ativo: true, foto: '' };
  form.nome.value = v.nome; form.departamento.value = v.departamento; form.spec.value = v.spec || ''; form.guia.value = v.guia || '';
  form.preco.value = v.preco == null ? '' : String(v.preco).replace('.', ','); form.unidade.value = v.unidade || '';
  $$('[name=estoque_status]', form).forEach(r => r.checked = r.value === (v.estoque_status || 'consulta'));
  form.estoque_qtd.value = v.estoque_qtd ?? ''; form.ativo.checked = !!v.ativo;
  $('#ed-photo').src = photoUrl(v.foto);
  ed.showModal(); setTimeout(() => form.nome.focus(), 50);
}
$('#ed-file').addEventListener('change', async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  if (!file.type.startsWith('image/')) { toast('Escolha um arquivo de imagem.'); return; }
  try { newPhoto = await shrink(file); $('#ed-photo').src = URL.createObjectURL(newPhoto); }
  catch { toast('Não deu para ler essa imagem. Tente outra.'); }
});
function shrink(file) {
  return new Promise((ok, fail) => {
    const img = new Image(); img.onload = () => {
      const max = 1200, s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
      c.toBlob(b => b ? ok(b) : c.toBlob(b2 => b2 ? ok(b2) : fail(), 'image/jpeg', .85), 'image/webp', .82);
      URL.revokeObjectURL(img.src);
    }; img.onerror = fail; img.src = URL.createObjectURL(file);
  });
}
async function uploadPhoto(id, blob) {
  const ext = blob.type === 'image/webp' ? 'webp' : 'jpg', path = id + '-' + Date.now().toString(36) + '.' + ext;
  const t = await token();
  const r = await fetch(CFG.supabaseUrl + '/storage/v1/object/materiais/' + path, { method: 'POST', headers: { apikey: CFG.supabaseKey, Authorization: 'Bearer ' + t, 'Content-Type': blob.type, 'cache-control': '31536000' }, body: blob });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error('Foto não enviada: ' + (j.message || r.status)); }
  return CFG.supabaseUrl + '/storage/v1/object/public/materiais/' + path;
}
form.addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('.err', form), btn = $('button[type=submit]', form); err.textContent = '';
  const nome = form.nome.value.trim(), dep = form.departamento.value.trim();
  if (!nome || !dep) { err.textContent = 'Preencha o nome e o departamento.'; (nome ? form.departamento : form.nome).focus(); return; }
  const precoTxt = form.preco.value.trim().replace(/\s|R\$/g, '');
  let preco = null;
  if (precoTxt) { preco = Number(precoTxt.includes(',') ? precoTxt.replace(/\./g, '').replace(',', '.') : precoTxt); if (!isFinite(preco) || preco < 0) { err.textContent = 'Preço inválido. Use só números, ex.: 49,90'; form.preco.focus(); return; } }
  const qtdTxt = form.estoque_qtd.value.trim();
  const data = {
    nome, departamento: dep, spec: form.spec.value.trim(), guia: form.guia.value.trim(), preco, unidade: form.unidade.value.trim(),
    estoque_status: form.estoque_status.value || 'consulta', estoque_qtd: qtdTxt === '' ? null : Math.max(0, Math.round(Number(qtdTxt))), ativo: form.ativo.checked
  };
  btn.disabled = true; btn.textContent = 'Salvando…';
  try {
    const id = editing ? editing.id : slug(nome) + '-' + Math.random().toString(36).slice(2, 6);
    if (newPhoto) { $('.uploading', ed).hidden = false; data.foto = await uploadPhoto(id, newPhoto); }
    if (editing) {
      await api('/rest/v1/materiais?id=eq.' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(data), headers: { Prefer: 'return=minimal' } });
    } else {
      data.id = id; data.ordem = (Math.max(0, ...items.map(i => i.ordem || 0)) + 10); if (!data.foto) data.foto = '';
      await api('/rest/v1/materiais', { method: 'POST', body: JSON.stringify(data), headers: { Prefer: 'return=minimal' } });
    }
    ed.close(); toast(editing ? 'Material atualizado.' : 'Material criado e já está no site.'); await loadItems();
  } catch (ex) { err.textContent = ex.message; }
  $('.uploading', ed).hidden = true; btn.disabled = false; btn.textContent = 'Salvar';
});
$('[data-delete]', form).addEventListener('click', async () => {
  if (!editing) return;
  if (!(await confirmBox('Excluir “' + editing.nome + '”?', 'O material sai do site e do painel. Se for só por um tempo, use “Ocultar” em vez de excluir.'))) return;
  try {
    await api('/rest/v1/materiais?id=eq.' + encodeURIComponent(editing.id), { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    ed.close(); toast('Material excluído.'); await loadItems();
  } catch (ex) { $('.err', form).textContent = ex.message; }
});
function confirmBox(title, text) {
  const d = $('#confirm'); $('[data-c-title]', d).textContent = title; $('[data-c-text]', d).textContent = text;
  d.returnValue = ''; d.showModal();
  return new Promise(ok => d.addEventListener('close', () => ok(d.returnValue === 'yes'), { once: true }));
}

/* ---------- pedidos ---------- */
const STATUS = { novo: 'Novo', em_andamento: 'Em andamento', atendido: 'Atendido', arquivado: 'Arquivado' };
async function loadOrders() {
  orders = await api('/rest/v1/pedidos?select=*&order=criado_em.desc&limit=300');
  renderOrders();
}
function renderOrders() {
  const n = orders.filter(o => o.status === 'novo').length, dot = $('[data-new-count]');
  dot.textContent = n; dot.hidden = !n;
  const shown = orders.filter(o => ofilter === 'todos' || (ofilter === 'aberto' ? ['novo', 'em_andamento'].includes(o.status) : o.status === ofilter));
  const box = $('#order-list');
  if (!shown.length) { box.replaceChildren(el('div', orders.length ? 'Nenhum pedido nesse filtro.' : 'Ainda não chegou nenhum pedido pelo site.', 'empty')); return; }
  const today = new Date(); today.setHours(0, 0, 0, 0);
  box.replaceChildren(...shown.map(o => {
    const card = el('article', null, 'ord st-' + o.status);
    const head = el('div', null, 'row'); const t = el('div');
    t.append(el('h3', o.material), el('span', 'Pedido nº ' + o.id + ' · ' + new Date(o.criado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }), 'muted tiny'));
    head.append(t, el('span', STATUS[o.status] || o.status, 'pill' + (o.status === 'novo' ? ' ok' : '')));
    const kv = el('div', null, 'kv');
    const add = (k, v, cls) => { if (!v) return; const s = el('span', null, cls); s.append(k + ': ', el('b', v)); kv.append(s); };
    add('Quantidade', o.quantidade);
    if (o.prazo) { const d = new Date(o.prazo + 'T12:00'); const days = Math.round((d - today) / 864e5); add('Para', d.toLocaleDateString('pt-BR') + (days <= 1 && ['novo', 'em_andamento'].includes(o.status) ? (days < 0 ? ' (atrasado)' : days === 0 ? ' (hoje)' : ' (amanhã)') : ''), days <= 1 && ['novo', 'em_andamento'].includes(o.status) ? 'urgent' : ''); } else add('Para', 'sem pressa');
    add('Receber', o.modo === 'retirada' ? 'Retira na loja' : 'Entrega' + (o.local_entrega ? ' — ' + o.local_entrega : ''));
    add('Cliente', o.nome); add('WhatsApp', o.whatsapp);
    card.append(head, kv);
    if (o.detalhes) card.append(el('p', o.detalhes));
    const note = el('textarea'); note.placeholder = 'Anotação interna (só aparece aqui)'; note.maxLength = 500; note.value = o.observacao_interna || '';
    note.setAttribute('aria-label', 'Anotação interna do pedido ' + o.id);
    note.addEventListener('change', () => patchOrder(o, { observacao_interna: note.value.trim() }, 'Anotação salva.'));
    const acts = el('div', null, 'acts');
    const phone = String(o.whatsapp || '').replace(/\D/g, ''); const full = phone.length <= 11 ? '55' + phone : phone;
    const msg = `Olá${o.nome ? ', ' + o.nome.split(' ')[0] : ''}! Aqui é da Mirai Madeireira, sobre o seu pedido nº ${o.id} (${o.material}).`;
    const w = el('a', 'Responder no WhatsApp', 'btn sm'); w.href = 'https://wa.me/' + full + '?text=' + encodeURIComponent(msg); w.target = '_blank'; w.rel = 'noopener';
    w.addEventListener('click', () => { if (o.status === 'novo') patchOrder(o, { status: 'em_andamento' }, 'Marcado como em andamento.'); });
    const sel = el('select'); sel.setAttribute('aria-label', 'Situação do pedido ' + o.id);
    for (const [k, v] of Object.entries(STATUS)) { const op = el('option', v); op.value = k; sel.append(op); }
    sel.value = o.status; sel.addEventListener('change', () => patchOrder(o, { status: sel.value }, 'Situação atualizada.'));
    const del = el('button', 'Excluir', 'ghost sm danger'); del.type = 'button';
    del.onclick = async () => { if (await confirmBox('Excluir pedido nº ' + o.id + '?', 'Isso não pode ser desfeito. Para só tirar da lista, use “Arquivado”.')) { try { await api('/rest/v1/pedidos?id=eq.' + o.id, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }); orders = orders.filter(x => x !== o); renderOrders(); toast('Pedido excluído.'); } catch (ex) { toast(ex.message); } } };
    acts.append(w, sel, del);
    card.append(note, acts); return card;
  }));
}
async function patchOrder(o, patch, msg) {
  try { await api('/rest/v1/pedidos?id=eq.' + o.id, { method: 'PATCH', body: JSON.stringify(patch), headers: { Prefer: 'return=minimal' } }); Object.assign(o, patch); renderOrders(); toast(msg); }
  catch (ex) { toast(ex.message); }
}
$$('[data-ofilter]').forEach(b => b.addEventListener('click', () => { ofilter = b.dataset.ofilter; $$('[data-ofilter]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); renderOrders(); }));
$('[data-reload-orders]').addEventListener('click', async () => { try { await loadOrders(); toast('Pedidos atualizados.'); } catch (ex) { toast(ex.message); } });

/* ---------- ajustes ---------- */
async function loadSettings() {
  const rows = await api('/rest/v1/config?select=chave,valor');
  settings = Object.fromEntries(rows.map(r => [r.chave, r.valor]));
  const f = $('#settings-form'); f.mostrar_precos.checked = settings.mostrar_precos !== false; f.whatsapp.value = settings.whatsapp || CFG.whatsapp || '';
}
$('#settings-form').addEventListener('submit', async e => {
  e.preventDefault(); const f = e.currentTarget, ok = $('.ok', f); ok.textContent = '';
  const fone = f.whatsapp.value.replace(/\D/g, '');
  if (fone && !/^\d{12,13}$/.test(fone)) { toast('WhatsApp deve ter DDI + DDD + número, ex.: 5512991862507'); f.whatsapp.focus(); return; }
  try {
    const rows = [{ chave: 'mostrar_precos', valor: f.mostrar_precos.checked }];
    if (fone) rows.push({ chave: 'whatsapp', valor: fone });
    await api('/rest/v1/config?on_conflict=chave', { method: 'POST', body: JSON.stringify(rows), headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } });
    ok.textContent = 'Ajustes salvos.';
  } catch (ex) { toast(ex.message); }
});
$('#password-form').addEventListener('submit', async e => {
  e.preventDefault(); const f = e.currentTarget, ok = $('.ok', f); ok.textContent = '';
  if (f.p1.value.length < 8) { toast('A senha precisa ter pelo menos 8 caracteres.'); return; }
  if (f.p1.value !== f.p2.value) { toast('As duas senhas não são iguais.'); return; }
  try { await auth('user', { password: f.p1.value }, 'PUT', await token()); f.reset(); ok.textContent = 'Senha trocada. Use a nova no próximo acesso.'; }
  catch (ex) { toast(/same|different/i.test(ex.message) ? 'A nova senha precisa ser diferente da atual.' : ex.message); }
});

/* ---------- início ---------- */
(async function boot() {
  try { sess = JSON.parse(localStorage.getItem(SKEY)); } catch { sess = null; }
  if (!sess) { screen(false); return; }
  try { await enter(); } catch (ex) { leave(); $('#login .err').textContent = ex.message; }
})();
