# Biblioteca de Jogos

Catálogo pessoal de jogos gerado a partir da exportação do **Playnite** (extensão *HTML Exporter*), publicado no GitHub Pages.

**Site:** https://gabrielfbrandao9.github.io/biblioteca-de-jogos/

## Como atualizar

No Playnite, exporte a biblioteca com o HTML Exporter. Depois, escolha um dos caminhos:

**Pelo site (de qualquer computador):** clique em **Atualizar biblioteca** no rodapé, escolha a pasta da
exportação e clique em **Publicar**. Na primeira vez o site pede um token do GitHub
([criar aqui](https://github.com/settings/personal-access-tokens/new)): acesso só ao repositório
`biblioteca-de-jogos`, permissão **Contents: Read and write**. O token fica salvo apenas no seu navegador.
O navegador não consegue consultar a Steam, então a Action `Completar capas` busca as capas dos jogos novos
logo depois da publicação.

**Pelo PC:** dê dois cliques em `atualizar.bat` (ou rode os comandos abaixo).

```bash
python scripts/build_data.py "D:\Backup\Documentos\HTML Exporter"
git add -A && git commit -m "Atualiza biblioteca" && git push
```

## Como funciona

- `scripts/build_data.py` lê as páginas de cada jogo da exportação e gera:
  - `data/games.json` — lista de todos os jogos (nome, loja, gêneros, notas, tempo de jogo…)
  - `data/desc/<id>.json` — descrição de cada jogo, carregada só quando você abre o jogo
- Jogos com o mesmo nome em lojas diferentes (ignorando maiúsculas, acentos e pontuação) aparecem uma vez só,
  com selos de cada loja e a seção "Onde eu tenho" mostrando status e tempo de jogo de cada cópia.
  Edições diferentes (GOTY, Remastered etc.) continuam separadas.
- Capas, banners e fundos vêm da CDN da Steam. Os caminhos são consultados na API pública da loja
  e guardados em `scripts/steam_cache.json` (só jogos novos geram consultas; `--refresh-steam` consulta tudo de novo).
  Jogos sem página na Steam ganham um cartão colorido com o nome.
- O site (`index.html`, `styles.css`, `app.js`) é estático, sem dependências.

## Recursos

- Busca por nome, desenvolvedor ou editora (atalho `/`)
- Filtros por loja, gênero, década de lançamento, modo de jogo, plataforma e nota da crítica
- Ordenação por nome, lançamento, notas, data de adição, tempo de jogo e última atividade
- **Sortear**: escolhe um jogo aleatório entre os filtrados (ótimo para o backlog)
- Página de detalhes com banner, descrição e links; setas ← → navegam entre jogos
- Filtros e jogo aberto ficam na URL, então dá para compartilhar um link direto
