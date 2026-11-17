// Gera dist/ para a Vercel: copia o site e baixa (somente leitura) as fotos do site original
// para os MESMOS caminhos (/hero.webp, /img/madeiras-1.webp ...). Se alguma foto faltar, o build falha
// e o site que já está no ar continua como estava.
import { cp, rm, mkdir, writeFile, access, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), dist = join(root, 'dist');
const ORIGIN = process.env.ORIGIN || 'https://mirai-madeiras-litoral.wisedesign.chatgpt.site/';
const exists = p => access(p).then(() => true, () => false);
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
for (const item of ['index.html', 'style.css', 'extra.css', 'app.js', 'config.js', 'materials.json', 'catalogo', 'orcamento', 'admin', 'assets'])
  if (await exists(join(root, item))) await cp(join(root, item), join(dist, item), { recursive: true });
const site = ['hero.webp', 'logo.webp', 'img/hero-mobile.webp', 'madeira.webp', 'construcao.webp', 'portas.webp', 'galpao.webp', 'notebook.webp', 'tampa.webp', 'celular.webp', 'img/notebook-perfil.webp'];
const products = JSON.parse(await readFile(join(root, 'materials.json'), 'utf8')).map(m => 'img/' + m.foto + '.webp');
const report = [];
for (const path of [...new Set([...site, ...products])]) {
  const out = join(dist, path);
  if (await exists(join(root, 'assets', path))) { await mkdir(dirname(out), { recursive: true }); await cp(join(root, 'assets', path), out); report.push({ path, ok: true, source: 'local' }); continue; }
  try {
    const res = await fetch(ORIGIN + path, { signal: AbortSignal.timeout(25000) });
    const type = res.headers.get('content-type') || '';
    if (!res.ok || !type.startsWith('image/')) throw new Error('HTTP ' + res.status + ' ' + type);
    const data = Buffer.from(await res.arrayBuffer());
    await mkdir(dirname(out), { recursive: true }); await writeFile(out, data);
    report.push({ path, ok: true, source: 'original', bytes: data.length });
  } catch (e) { report.push({ path, ok: false, reason: String(e.cause?.code || e.message) }); }
}
// vídeo do notebook: vem da pasta assets/ ou do repositório público no GitHub
const VIDEO = 'assets/video/notebook-giro.mp4', RAW = process.env.VIDEO_RAW || 'https://raw.githubusercontent.com/theuzufc-jpg/mirai-madeiras/main/';
for (const v of [VIDEO, 'assets/video/notebook-giro-inicio.webp','assets/video/notebook-giro-fim.webp']) {
  if (await exists(join(dist, v))) continue;
  try { const r = await fetch(RAW + v, { signal: AbortSignal.timeout(25000) }); if (!r.ok) throw new Error('HTTP ' + r.status); await mkdir(dirname(join(dist, v)), { recursive: true }); await writeFile(join(dist, v), Buffer.from(await r.arrayBuffer())); console.log('Baixado do GitHub:', v); }
  catch (e) { console.log('AVISO: sem', v, '-', e.message, '(o site mostra a foto do notebook no lugar)'); }
}
const missing = report.filter(r => !r.ok);
console.log(`Fotos: ${report.length - missing.length}/${report.length}`);
if (missing.length) { for (const m of missing) console.log('FALTA', m.path, m.reason); throw new Error('Fotos faltando — build interrompido para não publicar o site quebrado.'); }
