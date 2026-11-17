# Mirai Madeiras — site + painel (v4)

**No ar:** https://mirai-madeiras-copia.vercel.app
**Painel:** https://mirai-madeiras-copia.vercel.app/admin/ (atalho: /painel)
O site original (wisedesign.chatgpt.site) não foi alterado: ele só foi lido.

## Como funciona
- `index.html`, `style.css` (CSS do site original, sem mudanças) e `extra.css` (intro, animações, encomenda, preço/estoque).
- `app.js`: lógica do original (lista de orçamento, catálogo, diálogos, mapa, notebook girando) + materiais vindos do banco + intro + rolagem + pedido de material.
- `admin/`: painel (login, materiais, pedidos, ajustes).
- Banco: Supabase, projeto `mirai-madeiras` (xwwijigqofzcwsnkdtgf). Tabelas `materiais`, `pedidos`, `config`, `admins`; fotos no bucket `materiais`.
- `config.js`: endereço e chave pública do Supabase (a chave pública só permite o que as regras do banco liberam).
- `materials.json`: cópia de segurança do catálogo, usada se o banco estiver fora do ar.
- `tools/build.mjs`: na Vercel, copia o site para `dist/` e baixa as fotos do site original (mesmos caminhos). Se faltar alguma foto, o build para e o site atual continua no ar.

## Segurança (regras do banco)
- Visitante: lê materiais ativos e config; envia pedido só pela função `criar_pedido` (com campo-armadilha contra robôs e limite de 6 pedidos/hora por número).
- Só e-mails na tabela `admins` criam/alteram/excluem materiais, fotos, pedidos e ajustes.
- Para dar acesso ao dono: no Supabase, criar o usuário dele (Authentication) e inserir o e-mail em `public.admins`.

## Testes
- Locais (Chrome automático, celular 390 px e desktop 1440 px, banco simulado): 58/58 — `docs/evidencias/`.
- Reais no Supabase (login, permissões, criar/editar/foto/excluir, pedido, anti-robô): 21/21.
