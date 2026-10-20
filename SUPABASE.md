# Banco de dados (Supabase)

A Biblioteca de Jogos usa **o mesmo projeto Supabase** do Otimizador de Cortes, dos Orçamentos e do
Controle de Porcos: o mesmo login com Google e a mesma chave, que estão em [`config.js`](config.js).
As tabelas dela começam com `jogos_` e não mexem nas dos outros sites.

## Endereço do site liberado no login

Em **Authentication** → **URL Configuration** → **Redirect URLs** precisa estar:

- `https://gabrielfbrandao9.github.io/biblioteca-de-jogos/**`

Sem esse endereço na lista, o Google devolve a pessoa para o Otimizador depois do login.

## Quem pode ver e atualizar

Só entra quem está na tabela `jogos_acesso`. O banco confere o e-mail da conta Google em toda
leitura e gravação (regras de segurança, RLS).

| Permissão | Ver | Atualizar a biblioteca | Dar e tirar acesso |
|-----------|-----|------------------------|--------------------|
| Dono      | sim | sim                    | sim                |
| Pode atualizar (`editor`) | sim | sim    | não                |
| Só ver (`leitor`) | sim | não            | não                |

O dono (gabrielfbrandao9@gmail.com) foi cadastrado direto no banco; os outros são liberados no site, em **Conta**.

## Tabelas

| Tabela | O que guarda |
|--------|--------------|
| `jogos_biblioteca` | A lista de todos os jogos montada das lojas (uma linha só, coluna `dados`) |
| `jogos_descricoes` | Resumo de cada jogo do GOG GamesDB (`gdb:<id>`) |
| `jogos_capas` | Caminhos das capas da Steam por appid (`{}` = sem capa na Steam) |
| `jogos_acesso` | Quem pode entrar e com qual permissão |
| `jogos_lojas` | Lojas conectadas: conta, quando sincronizou, quantos jogos, último erro |
| `jogos_itens` | Jogos de cada loja como ela devolveu (horas em segundos; vazio = a loja não informa) |
| `jogos_meta` | Cache do GOG GamesDB (`gdb:<loja>:<id>`), do catálogo da Epic (`epiccat:…`, em inglês) e do HowLongToBeat (`hltb:<nome normalizado>`; `{}` = não achou) |
| `jogos_tokens` | Tokens de login das lojas. **Nenhum navegador lê**, nem o do dono: só a função `jogos-lojas` |

## Funções

- `jogos-lojas` ([código](supabase/functions/jogos-lojas/index.ts)): conectar, desconectar e sincronizar
  as lojas (Steam, Epic, GOG, Amazon, Xbox, PlayStation, EA, Ubisoft, Battle.net, Riot e Legacy Games), e buscar metadados no GOG GamesDB. Conectar e desconectar: só o dono.
- `jogos-capas` ([código](supabase/functions/jogos-capas/index.ts)): capas da Steam (o navegador não consegue
  consultar a API da Steam, por CORS).

Para desconectar uma loja de vez, além do botão **Desconectar** do site: na Steam, revogue a chave em
steamcommunity.com/dev/apikey; na Amazon, o aparelho "AGSLauncher" aparece em Gerenciar conteúdo e dispositivos.

## Bom saber

- **Projeto pausado**: no plano gratuito, o Supabase pausa o projeto depois de 1 semana sem acesso
  a nenhum dos sites. Se acontecer, entre no painel e clique em **Restore**. Os dados não se perdem.
