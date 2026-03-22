// ══════════════════════════════════════════════════════════════
// supabase.js — Cliente VSLT + todas as funções do banco
// Coloque este arquivo em: src/supabase.js
// ══════════════════════════════════════════════════════════════

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY;

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ══════════════════════════════════════════════════════════════
// AUTENTICAÇÃO (simples, sem Supabase Auth)
// ══════════════════════════════════════════════════════════════

export async function loginUsuario(username, password) {
  const { data, error } = await supabase
    .from("usuarios")
    .select("*")
    .eq("username", username.toLowerCase().trim())
    .eq("password_hash", password)
    .eq("ativo", true)
    .single();
  if (error || !data) return { user: null, error: "Credenciais inválidas" };
  return { user: data, error: null };
}

export async function listarUsuarios() {
  const { data, error } = await supabase
    .from("usuarios")
    .select("id, username, nome, role, color")
    .eq("ativo", true);
  return data || [];
}

// ══════════════════════════════════════════════════════════════
// EVENTOS
// ══════════════════════════════════════════════════════════════

export async function listarEventos() {
  const { data, error } = await supabase
    .from("vw_eventos_resumo")
    .select("*")
    .order("criado_em", { ascending: false });
  return data || [];
}

export async function criarEvento({ nome, data_evento, criado_por }) {
  const { data, error } = await supabase
    .from("eventos")
    .insert({ nome, data_evento, criado_por })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function buscarEvento(id) {
  const { data, error } = await supabase
    .from("eventos")
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

export async function atualizarEvento(id, campos) {
  const { data, error } = await supabase
    .from("eventos")
    .update(campos)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deletarEvento(id) {
  const { error } = await supabase.from("eventos").delete().eq("id", id);
  if (error) throw error;
}

export async function encerrarEvento(id) {
  return atualizarEvento(id, { encerrado: true, encerrado_em: new Date().toISOString() });
}

export async function reabrirEvento(id) {
  return atualizarEvento(id, { encerrado: false, encerrado_em: null });
}

export async function salvarCondicoes(id, condicoes) {
  return atualizarEvento(id, { condicoes });
}

// ══════════════════════════════════════════════════════════════
// METAS
// ══════════════════════════════════════════════════════════════

export async function listarMetas(evento_id) {
  const { data } = await supabase
    .from("metas")
    .select("*")
    .eq("evento_id", evento_id)
    .order("percentual", { ascending: false });
  return data || [];
}

export async function salvarMetas(evento_id, metas) {
  // Deleta todas e reinserir (simples e confiável)
  await supabase.from("metas").delete().eq("evento_id", evento_id);
  if (!metas.length) return [];
  const rows = metas.map((m, i) => ({
    evento_id,
    label: m.label,
    percentual: m.percentual,
    ordem: i,
  }));
  const { data, error } = await supabase.from("metas").insert(rows).select();
  if (error) throw error;
  return data;
}

// ══════════════════════════════════════════════════════════════
// AÇÕES
// ══════════════════════════════════════════════════════════════

export async function listarAcoes(evento_id) {
  const { data } = await supabase
    .from("acoes")
    .select("*")
    .eq("evento_id", evento_id)
    .order("numero", { ascending: true });
  return data || [];
}

export async function criarAcao({ evento_id, numero, nome, total_participantes }) {
  const { data, error } = await supabase
    .from("acoes")
    .insert({ evento_id, numero, nome, total_participantes })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function atualizarAcao(id, campos) {
  const { data, error } = await supabase
    .from("acoes")
    .update(campos)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deletarAcao(id) {
  const { error } = await supabase.from("acoes").delete().eq("id", id);
  if (error) throw error;
}

// ══════════════════════════════════════════════════════════════
// DIVULGADORAS
// ══════════════════════════════════════════════════════════════

export async function listarDivulgadoras(evento_id) {
  const { data } = await supabase
    .from("divulgadoras")
    .select("*")
    .eq("evento_id", evento_id)
    .order("criado_em", { ascending: true });
  return data || [];
}

export async function criarDivulgadora({ evento_id, nome, instagram, entrada_acao }) {
  const { data, error } = await supabase
    .from("divulgadoras")
    .insert({ evento_id, nome, instagram: instagram || "", entrada_acao })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function atualizarDivulgadora(id, campos) {
  const { data, error } = await supabase
    .from("divulgadoras")
    .update(campos)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deletarDivulgadora(id) {
  const { error } = await supabase.from("divulgadoras").delete().eq("id", id);
  if (error) throw error;
}

// ══════════════════════════════════════════════════════════════
// MARCAÇÕES
// ══════════════════════════════════════════════════════════════

export async function listarMarcacoes(evento_id) {
  const { data } = await supabase
    .from("marcacoes")
    .select("divulgadora_id, acao_id, valor")
    .eq("evento_id", evento_id);
  // Retorna no formato { "divId_acaoId": "OK" | "X" } igual ao sistema atual
  const map = {};
  for (const m of data || []) {
    map[`${m.divulgadora_id}_${m.acao_id}`] = m.valor;
  }
  return map;
}

export async function upsertMarcacao({ evento_id, divulgadora_id, acao_id, valor }) {
  const { error } = await supabase
    .from("marcacoes")
    .upsert({ evento_id, divulgadora_id, acao_id, valor }, { onConflict: "divulgadora_id,acao_id" });
  if (error) throw error;
}

export async function upsertMarcacoesBatch(marcacoes) {
  // marcacoes = [{ evento_id, divulgadora_id, acao_id, valor }]
  if (!marcacoes.length) return;
  const { error } = await supabase
    .from("marcacoes")
    .upsert(marcacoes, { onConflict: "divulgadora_id,acao_id" });
  if (error) throw error;
}

export async function deletarMarcacoesDaAcao(acao_id) {
  const { error } = await supabase.from("marcacoes").delete().eq("acao_id", acao_id);
  if (error) throw error;
}

export async function deletarMarcacoesDaDivulgadora(divulgadora_id) {
  const { error } = await supabase.from("marcacoes").delete().eq("divulgadora_id", divulgadora_id);
  if (error) throw error;
}

// ══════════════════════════════════════════════════════════════
// PROMOTERS
// ══════════════════════════════════════════════════════════════

export async function listarPromoters(evento_id) {
  const { data } = await supabase
    .from("promoters")
    .select("*, vendas(*)")
    .eq("evento_id", evento_id)
    .order("criado_em", { ascending: true });
  return data || [];
}

export async function criarPromoter({ evento_id, nome, email, link, categoria }) {
  const { data, error } = await supabase
    .from("promoters")
    .insert({ evento_id, nome, email, link, categoria })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function atualizarPromoter(id, campos) {
  const { data, error } = await supabase
    .from("promoters")
    .update(campos)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deletarPromoter(id) {
  const { error } = await supabase.from("promoters").delete().eq("id", id);
  if (error) throw error;
}

// ══════════════════════════════════════════════════════════════
// VENDAS
// ══════════════════════════════════════════════════════════════

export async function criarVenda({ promoter_id, evento_id, qtd, valor, comprovante, obs }) {
  const { data, error } = await supabase
    .from("vendas")
    .insert({ promoter_id, evento_id, qtd, valor, comprovante: comprovante || "", obs: obs || "" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function atualizarVenda(id, campos) {
  const { data, error } = await supabase
    .from("vendas")
    .update(campos)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deletarVenda(id) {
  const { error } = await supabase.from("vendas").delete().eq("id", id);
  if (error) throw error;
}

// ══════════════════════════════════════════════════════════════
// SORTEIOS
// ══════════════════════════════════════════════════════════════

export async function listarSorteios(evento_id) {
  const { data } = await supabase
    .from("sorteios")
    .select("*")
    .eq("evento_id", evento_id)
    .order("realizado_em", { ascending: false });
  return data || [];
}

export async function listarTodosSorteios() {
  const { data } = await supabase
    .from("sorteios")
    .select("*, eventos(nome)")
    .order("realizado_em", { ascending: false });
  return data || [];
}

export async function criarSorteio({ evento_id, acao_id, acao_nome, titulo, premio, observacao, vencedoras }) {
  const { data, error } = await supabase
    .from("sorteios")
    .insert({ evento_id, acao_id, acao_nome, titulo, premio: premio || "", observacao: observacao || "", vencedoras })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deletarSorteio(id) {
  const { error } = await supabase.from("sorteios").delete().eq("id", id);
  if (error) throw error;
}

// ══════════════════════════════════════════════════════════════
// AUDITORIA
// ══════════════════════════════════════════════════════════════

export async function listarAuditLog(limit = 200) {
  const { data } = await supabase
    .from("audit_log")
    .select("*")
    .order("criado_em", { ascending: false })
    .limit(limit);
  return data || [];
}

export async function inserirAuditLog({ tipo, usuario, acao, pagina, detalhe }) {
  const { error } = await supabase
    .from("audit_log")
    .insert({ tipo, usuario, acao, pagina, detalhe: detalhe || "" });
  // Não lança erro para não bloquear a UI
  if (error) console.warn("Audit log error:", error.message);
}

export async function limparAuditLog() {
  const { error } = await supabase.from("audit_log").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  if (error) throw error;
}

// ══════════════════════════════════════════════════════════════
// CARREGAMENTO COMPLETO DE UM EVENTO
// Retorna tudo que o sistema precisa em uma chamada paralela
// ══════════════════════════════════════════════════════════════

export async function carregarEvento(evento_id) {
  const [acoes, divulgadoras, marcacoesMap, metas, promoters, sorteios] = await Promise.all([
    listarAcoes(evento_id),
    listarDivulgadoras(evento_id),
    listarMarcacoes(evento_id),
    listarMetas(evento_id),
    listarPromoters(evento_id),
    listarSorteios(evento_id),
  ]);
  return { acoes, divulgadoras, marcacoes: marcacoesMap, metas, promoters, sorteios };
}
