import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error("Variáveis VITE_SUPABASE_URL e VITE_SUPABASE_KEY são obrigatórias");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const EVENTO_ID = "6763727a-1b4f-45d2-8eae-98e76699df88";
const BASE_DIR = "C:/Users/LEOCADETE/Documents/Acoes follow the sun";
const LIST_SKIP_PATTERNS = [
  /https?:\/\//i,
  /curtir/i,
  /marcar\s+\d+/i,
  /respostar/i,
  /story/i,
  /colocar o link/i,
  /o post abaixo/i,
  /complete a lista/i,
  /nome completo/i,
  /follow the sun/i,
];

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }

  return dp[m][n];
}

const normStr = (s = "") =>
  s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");

const normHandle = (s = "") =>
  normStr(s)
    .replace(/^@/, "")
    .replace(/\s/g, "")
    .replace(/[^a-z0-9._]/g, "");

const similarity = (a, b) => {
  const na = normStr(a);
  const nb = normStr(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  return 1 - levenshtein(na, nb) / Math.max(na.length, nb.length);
};

function parseLista(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\u200b/g, "").trim())
    .filter(Boolean);

  const results = [];
  const isStandaloneInstagram = (line) => /^@?[a-zA-Z0-9_.]+$/.test(line.trim());
  const isListItem = (line) => /^\d+\s*[-_.:)\]]*/.test(line.trim());
  const shouldSkipLine = (line) => {
    const atCount = (line.match(/@/g) || []).length;
    return atCount > 1 || LIST_SKIP_PATTERNS.some((pattern) => pattern.test(line));
  };

  for (const line of lines) {
    if (shouldSkipLine(line)) continue;

    if (isStandaloneInstagram(line) && results.length && !results[results.length - 1].instagram) {
      results[results.length - 1].instagram = line.replace(/^@/, "").toLowerCase();
      if (!results[results.length - 1].nome) {
        results[results.length - 1].nome = results[results.length - 1].instagram;
      }
      continue;
    }

    if (!isListItem(line)) continue;

    const cleaned = line
      .replace(/^\d+[\s\-_.:)\]]*/, "")
      .replace(/^\*+|\*+$/g, "")
      .trim();

    if (!cleaned) continue;

    let nome = "";
    let instagram = "";

    const instaMatch = cleaned.match(/@([a-zA-Z0-9_.]+)/);
    if (instaMatch) {
      instagram = instaMatch[1].toLowerCase();
      const beforeAt = cleaned.substring(0, cleaned.indexOf(instaMatch[0]));
      nome = beforeAt
        .replace(/[\/\\@\-\u2013\s]+$/g, "")
        .replace(/^\d+[\s\-.\)]*/g, "")
        .trim();
      if (!nome) {
        nome = cleaned
          .substring(cleaned.indexOf(instaMatch[0]) + instaMatch[0].length)
          .replace(/^[\/\\\-\u2013\s]+/g, "")
          .trim();
      }
    } else {
      const parts = cleaned.split(/\s*[\/\\]+\s*/);
      if (parts.length >= 2) {
        nome = parts[0].trim();
        instagram = parts[parts.length - 1].trim().toLowerCase().replace(/^@/, "");
      } else {
        nome = cleaned;
      }
    }

    nome = nome.replace(/\s+/g, " ").trim();
    const finalInstagram = normHandle(instagram);
    const finalNome = nome || finalInstagram;
    if (!finalNome) continue;
    results.push({ nome: finalNome, instagram: finalInstagram });
  }

  return results;
}

function pickBetterName(currentName, nextName) {
  if (!currentName) return nextName;
  if (!nextName) return currentName;
  const currentNorm = normStr(currentName);
  const nextNorm = normStr(nextName);
  if (currentNorm === nextNorm) return nextName.length > currentName.length ? nextName : currentName;
  return nextName.length > currentName.length ? nextName : currentName;
}

function scoreCandidate(entry, candidate) {
  const entryIg = normHandle(entry.instagram);
  const candidateIg = normHandle(candidate.instagram);
  const entryName = normStr(entry.nome);
  const candidateName = normStr(candidate.nome);

  if (entryIg && candidateIg && entryIg === candidateIg) return 1;
  if (entryName && candidateName && entryName === candidateName) return 0.98;

  const igSim = entryIg && candidateIg ? similarity(entryIg, candidateIg) : 0;
  const nameSim = entryName && candidateName ? similarity(entryName, candidateName) : 0;

  if (entryIg && candidateIg && (entryIg.includes(candidateIg) || candidateIg.includes(entryIg)) && Math.max(entryIg.length, candidateIg.length) >= 6) {
    return 0.95;
  }

  if (igSim >= 0.9 && nameSim >= 0.5) return 0.93;
  if (nameSim >= 0.95) return 0.9;
  if (igSim >= 0.95) return 0.88;
  if (nameSim >= 0.88 && igSim >= 0.7) return 0.86;
  return 0;
}

function findBestMatch(entry, identities) {
  let best = null;
  let bestScore = 0;
  for (const candidate of identities) {
    const score = scoreCandidate(entry, candidate);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return bestScore >= 0.88 ? best : null;
}

const dryRun = process.argv.includes("--dry-run");

const fileActions = [];
for (let num = 1; num <= 13; num++) {
  const raw = fs.readFileSync(path.join(BASE_DIR, `${num}.txt`), "utf8");
  fileActions.push({
    numero: num,
    entries: parseLista(raw),
  });
}

const [acoesRes, divsRes, marcRes] = await Promise.all([
  supabase.from("acoes").select("*").eq("evento_id", EVENTO_ID).order("numero"),
  supabase.from("divulgadoras").select("*").eq("evento_id", EVENTO_ID).order("criado_em"),
  supabase.from("marcacoes").select("*").eq("evento_id", EVENTO_ID),
]);

for (const res of [acoesRes, divsRes, marcRes]) {
  if (res.error) throw res.error;
}

const acoes = acoesRes.data;
const currentDivs = divsRes.data;
const identities = currentDivs.map((div) => ({
  id: div.id,
  nome: div.nome,
  instagram: normHandle(div.instagram),
  entrada_acao: Number(div.entrada_acao) || 1,
  source: "existing",
  original: div,
  actions: new Set(),
}));

const byActionIds = new Map();
for (const action of fileActions) {
  const ids = new Set();
  for (const entry of action.entries) {
    const match = findBestMatch(entry, identities);
    let identity = match;
    if (!identity) {
      identity = {
        id: null,
        nome: entry.nome,
        instagram: normHandle(entry.instagram),
        entrada_acao: action.numero,
        source: "new",
        actions: new Set(),
      };
      identities.push(identity);
    }

    identity.nome = pickBetterName(identity.nome, entry.nome);
    if (entry.instagram && (!identity.instagram || entry.instagram.length > identity.instagram.length)) {
      identity.instagram = normHandle(entry.instagram);
    }
    identity.entrada_acao = Math.min(identity.entrada_acao || action.numero, action.numero);
    identity.actions.add(action.numero);
    ids.add(identity);
  }
  byActionIds.set(action.numero, [...ids]);
}

const usedExistingIds = new Set(identities.filter((item) => item.id && item.actions.size > 0).map((item) => item.id));
const orphanDivs = currentDivs.filter((div) => !usedExistingIds.has(div.id));
const newIdentities = identities.filter((item) => !item.id);

const drySummary = {
  actions: fileActions.map((action) => ({
    acao: action.numero,
    parsed: action.entries.length,
    uniqueMatched: byActionIds.get(action.numero).length,
  })),
  currentDivulgadoras: currentDivs.length,
  usedExisting: usedExistingIds.size,
  orphans: orphanDivs.length,
  toCreate: newIdentities.length,
  orphanSample: orphanDivs.slice(0, 10).map((item) => ({
    id: item.id,
    nome: item.nome,
    instagram: item.instagram,
    entrada_acao: item.entrada_acao,
  })),
  createSample: newIdentities.slice(0, 10).map((item) => ({
    nome: item.nome,
    instagram: item.instagram,
    entrada_acao: item.entrada_acao,
    actions: [...item.actions].sort((a, b) => a - b),
  })),
};

if (dryRun) {
  console.log(JSON.stringify(drySummary, null, 2));
  process.exit(0);
}

if (newIdentities.length) {
  const payload = newIdentities.map((item) => ({
    evento_id: EVENTO_ID,
    nome: item.nome,
    instagram: item.instagram || "",
    entrada_acao: item.entrada_acao,
  }));
  const { data, error } = await supabase.from("divulgadoras").insert(payload).select("*");
  if (error) throw error;
  data.forEach((row, index) => {
    newIdentities[index].id = row.id;
    newIdentities[index].original = row;
  });
}

const updates = identities
  .filter((item) => item.id)
  .map((item) => ({
    id: item.id,
    nome: item.nome,
    instagram: item.instagram || "",
    entrada_acao: item.entrada_acao,
  }));

for (const update of updates) {
  const { error } = await supabase
    .from("divulgadoras")
    .update({
      nome: update.nome,
      instagram: update.instagram,
      entrada_acao: update.entrada_acao,
    })
    .eq("id", update.id);
  if (error) throw error;
}

const desiredMarks = [];
for (const acao of acoes) {
  const participants = new Set((byActionIds.get(Number(acao.numero)) || []).map((item) => item.id));
  for (const identity of identities) {
    if (!identity.id) continue;
    const valor = participants.has(identity.id) ? "OK" : "X";
    desiredMarks.push({
      evento_id: EVENTO_ID,
      divulgadora_id: identity.id,
      acao_id: acao.id,
      valor,
    });
  }
}

const { error: deleteMarksError } = await supabase.from("marcacoes").delete().eq("evento_id", EVENTO_ID);
if (deleteMarksError) throw deleteMarksError;

const BATCH_SIZE = 500;
for (let i = 0; i < desiredMarks.length; i += BATCH_SIZE) {
  const batch = desiredMarks.slice(i, i + BATCH_SIZE);
  const { error } = await supabase
    .from("marcacoes")
    .insert(batch);
  if (error) throw error;
}

for (const acao of acoes) {
  const totalParticipantes = (byActionIds.get(Number(acao.numero)) || []).length;
  const { error } = await supabase
    .from("acoes")
    .update({ total_participantes: totalParticipantes })
    .eq("id", acao.id);
  if (error) throw error;
}

if (orphanDivs.length) {
  const orphanIds = orphanDivs.map((item) => item.id);
  const { error } = await supabase.from("divulgadoras").delete().in("id", orphanIds);
  if (error) throw error;
}

console.log(
  JSON.stringify(
    {
      repaired: true,
      actions: fileActions.map((action) => ({
        acao: action.numero,
        total_participantes: (byActionIds.get(action.numero) || []).length,
      })),
      divulgadorasAtivas: identities.length,
      deletedOrphans: orphanDivs.length,
      created: newIdentities.length,
      desiredMarks: desiredMarks.length,
    },
    null,
    2,
  ),
);
