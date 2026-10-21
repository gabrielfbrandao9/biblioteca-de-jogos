# Biblioteca de Jogos

Catálogo pessoal de jogos de várias lojas (Steam, Epic, GOG, Amazon, Xbox/Microsoft Store, PlayStation, EA,
Ubisoft, Battle.net, Riot e Legacy Games), publicado no GitHub Pages.

**Site:** https://gabrielfbrandao9.github.io/biblioteca-de-jogos/

## Quem pode ver

Só quem entra com uma conta Google liberada. Os jogos ficam no Supabase (não neste repositório) e o
banco confere o e-mail em toda leitura, então não adianta ter o endereço do site. Detalhes em [SUPABASE.md](SUPABASE.md).

O dono libera as pessoas em **Conta** (a foto no canto de cima): e-mail Google, nome e permissão
(**Só ver** ou **Pode atualizar**).

## Como atualizar

No site, clique em **Atualizar** → **Sincronizar lojas**. Só o dono e quem tem **Pode atualizar** veem o botão.

As lojas são conectadas uma vez, pelo dono, na mesma tela:

| Loja | Como conecta | Horas jogadas |
|------|--------------|---------------|
| Steam | Chave da API (steamcommunity.com/dev/apikey) + link do perfil, com "Detalhes dos jogos" público. Opcional: cookie `steamRefresh_steam` (login.steampowered.com, dura meses) para trazer também jogos grátis nunca abertos, demos e testes | sim |
| Epic | Login da Epic → cola o texto com `authorizationCode` (mesmo método do Heroic/Legendary) | sim |
| GOG | Login do GOG → cola o endereço da página `on_login_success` (mesmo método do GOG Galaxy) | só se o GOG liberar as estatísticas do perfil |
| Amazon | Login da Amazon → cola o endereço da página que abre depois (mesmo método do Nile) | não |
| Xbox / Microsoft Store | Login da Microsoft → cola o endereço `oauth20_desktop.srf?code=…` (como o Playnite). Só lista jogos já abertos | sim |
| PlayStation | Entra em playstation.com → cola o texto com `npsso` (como o psn-api) | sim |
| EA app | Entra em ea.com → cola o texto com `access_token`. **Vale ~1 hora**: cole de novo (Reconectar) antes de sincronizar outro dia | não |
| Ubisoft Connect | E-mail e senha (e código de verificação, se tiver). A senha não fica guardada, só o "lembrar de mim" | não |
| Battle.net | Cookie de sessão de account.battle.net (copiado pelo F12). Vence de tempos em tempos | não |
| Riot Games | Marca os jogos que joga (são gratuitos; a Riot não tem lista de jogos da conta) | não |
| Legacy Games | Só o e-mail da conta (lista os jogos ganhos de brinde) | não |

Só a Steam tem API oficial; os outros métodos não são oficiais: se uma loja mudar algo, aparece o erro ao lado dela
e o resto continua funcionando.

## Como funciona

- `nuvem.js` conversa com o Supabase; `entrada.js` cuida do login, do acesso e da tela Conta.
- A função `jogos-lojas` (Supabase) faz login nas lojas, guarda os tokens (só ela lê) e baixa a lista de jogos
  para `jogos_itens`; também busca capa, gêneros, nota e resumo de cada jogo no GOG GamesDB e o tempo para
  zerar (história, com extras e 100%) no HowLongToBeat. Os nomes da Epic vêm em inglês, como nas outras lojas,
  para o mesmo jogo se juntar.
- Xbox: a Microsoft não informa o que foi comprado e o que veio do Game Pass, então todo jogo da conexão Xbox
  começa como **Game Pass**. No detalhe do jogo (em "Onde eu tenho") quem pode atualizar troca para
  **Xbox / MS Store** (as duas contam como uma loja só); a escolha fica em `jogos_meta` (`origem:xbox:<id>`) e vale
  nas próximas sincronizações.
- `lojas.js` junta as lojas e grava a biblioteca. Jogos com o mesmo nome em lojas diferentes (ignorando
  maiúsculas, acentos e pontuação) aparecem uma vez só, com selos de cada loja e a seção "Onde eu tenho".
- Capas: Steam (função `jogos-capas`) para jogos da Steam; GOG GamesDB ou catálogo da Epic para os outros.
  Jogos sem capa ganham um cartão colorido com o nome.
- A lista de jogos fica guardada no navegador e só é baixada de novo quando muda.
- O site (`index.html`, `styles.css`, `app.js`…) é estático, sem etapa de build.

## Recursos

- Busca por nome, desenvolvedor ou editora (atalho `/`)
- Filtros por loja, gênero, década de lançamento, modo de jogo, plataforma e nota da crítica
- Ordenação por nome, lançamento, notas, data de adição, tempo de jogo e última atividade
- **Sortear**: escolhe um jogo aleatório entre os filtrados (ótimo para o backlog)
- Página de detalhes com banner, descrição e links; setas ← → navegam entre jogos
- Filtros e jogo aberto ficam na URL (o link só abre para quem tem acesso)
- **Baixar backup** (em Conta): JSON completo (com as descrições), CSV para planilha (Excel abre direto) ou HTML para ler e imprimir
