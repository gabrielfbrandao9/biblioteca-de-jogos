"use strict";
// Configuração do Supabase. Veja SUPABASE.md.
//
// É o mesmo projeto Supabase do Otimizador de Cortes, dos Orçamentos e do Controle de Porcos:
// o login (Google) é o mesmo e os dados ficam nas tabelas "jogos_*".
// A chave "publishable" é pública por natureza: quem protege os dados são as regras
// de segurança (RLS) do banco. NUNCA coloque aqui a chave "service_role" ou "secret".
window.APP_CONFIG = {
  supabaseUrl: "https://hvpafupdzqoochnlkfvp.supabase.co",
  supabaseKey: "sb_publishable_gxZJWsTHWsg4tZkcIAnhCA_tQPPYppf",
  // Quem decide os acessos (aparece na tela "sem acesso")
  donoNome: "Gabriel",
};
