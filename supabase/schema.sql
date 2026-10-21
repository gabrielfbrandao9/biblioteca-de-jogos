-- Biblioteca de Jogos: banco de dados no Supabase (já aplicado em 20/10/2026).
-- Usa o MESMO projeto dos outros sites; tudo aqui começa com "jogos_".
-- Depende de public.meu_email(), criada pelo schema do Controle de Porcos.

-- Acesso: só quem está nesta lista vê os dados.
--   dono   vê, atualiza e decide quem tem acesso
--   editor vê e atualiza
--   leitor só vê
create table if not exists public.jogos_acesso (
  email text primary key check (email = lower(email) and email like '%_@_%'),
  papel text not null check (papel in ('dono', 'editor', 'leitor')),
  nome text not null default '',
  adicionado_por uuid default auth.uid() references auth.users (id) on delete set null,
  adicionado_em timestamptz not null default now()
);
alter table public.jogos_acesso enable row level security;

create or replace function public.jogos_papel()
returns text language sql stable security definer set search_path = '' as $$
  select a.papel from public.jogos_acesso a where a.email = public.meu_email();
$$;
create or replace function public.jogos_pode_ver()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.jogos_papel() is not null;
$$;
create or replace function public.jogos_pode_atualizar()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.jogos_papel() in ('dono', 'editor'), false);
$$;
revoke all on function public.jogos_papel(), public.jogos_pode_ver(), public.jogos_pode_atualizar() from anon, public;
grant execute on function public.jogos_papel(), public.jogos_pode_ver(), public.jogos_pode_atualizar() to authenticated;

create policy "Ver acesso" on public.jogos_acesso for select to authenticated
  using (email = (select public.meu_email()) or (select public.jogos_papel()) = 'dono');
create policy "Dono adiciona" on public.jogos_acesso for insert to authenticated
  with check ((select public.jogos_papel()) = 'dono' and papel in ('editor', 'leitor'));
create policy "Dono altera" on public.jogos_acesso for update to authenticated
  using ((select public.jogos_papel()) = 'dono' and papel <> 'dono')
  with check (papel in ('editor', 'leitor'));
create policy "Dono remove" on public.jogos_acesso for delete to authenticated
  using ((select public.jogos_papel()) = 'dono' and papel <> 'dono');
revoke all on public.jogos_acesso from anon;
grant select, insert, update, delete on public.jogos_acesso to authenticated;

insert into public.jogos_acesso (email, papel, nome)
values ('gabrielfbrandao9@gmail.com', 'dono', 'Gabriel')
on conflict (email) do nothing;

-- Lista de jogos montada das lojas, numa linha só. "json" guarda o texto como veio.
create table if not exists public.jogos_biblioteca (
  id smallint primary key default 1 check (id = 1),
  dados json not null,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid default auth.uid() references auth.users (id) on delete set null
);

-- Resumo de cada jogo (GOG GamesDB, id 'gdb:<id>'). hash = SHA-256 do html.
create table if not exists public.jogos_descricoes (
  id text primary key,
  html text not null,
  hash text not null
);

-- Capas da Steam por appid. {} = jogo sem capa na Steam.
create table if not exists public.jogos_capas (
  steam_id integer primary key,
  art jsonb not null default '{}',
  consultado_em timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['jogos_biblioteca', 'jogos_descricoes', 'jogos_capas'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "Ver" on public.%I for select to authenticated using ((select public.jogos_pode_ver()))', t);
    execute format('create policy "Criar" on public.%I for insert to authenticated with check ((select public.jogos_pode_atualizar()))', t);
    execute format('create policy "Alterar" on public.%I for update to authenticated using ((select public.jogos_pode_atualizar())) with check ((select public.jogos_pode_atualizar()))', t);
    execute format('create policy "Excluir" on public.%I for delete to authenticated using ((select public.jogos_pode_atualizar()))', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Conexão direta com as lojas (20/10/2026)

-- Tokens de login das lojas: nenhum navegador lê (nem o dono). Só a função jogos-lojas (service role).
create table if not exists public.jogos_tokens (
  loja text primary key check (loja in ('steam', 'epic', 'gog', 'amazon', 'xbox', 'psn', 'ea', 'ubisoft', 'battlenet', 'riot', 'legacy')),
  dados jsonb not null,
  atualizado_em timestamptz not null default now()
);
alter table public.jogos_tokens enable row level security;
revoke all on public.jogos_tokens from anon, authenticated;

create table if not exists public.jogos_lojas (
  loja text primary key check (loja in ('steam', 'epic', 'gog', 'amazon', 'xbox', 'psn', 'ea', 'ubisoft', 'battlenet', 'riot', 'legacy')),
  conta text not null default '',
  conectado_em timestamptz not null default now(),
  sincronizado_em timestamptz,
  itens integer,
  erro text
);

create table if not exists public.jogos_itens (
  loja text not null,
  id_loja text not null,
  nome text not null,
  playtime integer,
  ultima_vez timestamptz,
  adicionado timestamptz,
  extra jsonb not null default '{}',
  visto_em timestamptz not null default now(),
  primary key (loja, id_loja)
);

create table if not exists public.jogos_meta (
  chave text primary key,
  dados jsonb not null,
  buscado_em timestamptz not null default now()
);


do $$
declare t text;
begin
  foreach t in array array['jogos_lojas', 'jogos_itens', 'jogos_meta'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "Ver" on public.%I for select to authenticated using ((select public.jogos_pode_atualizar()))', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- Último acesso de cada pessoa da lista (aparece para o dono em Conta → Quem tem acesso)
alter table public.jogos_acesso add column if not exists ultimo_acesso timestamptz;
create or replace function public.jogos_registrar_acesso()
returns void language sql security definer set search_path to '' as $$
  update public.jogos_acesso set ultimo_acesso = now() where email = public.meu_email();
$$;
revoke all on function public.jogos_registrar_acesso() from public, anon;
grant execute on function public.jogos_registrar_acesso() to authenticated;
