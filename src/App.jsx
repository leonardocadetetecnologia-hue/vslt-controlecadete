import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  loginUsuario, listarUsuarios,
  listarEventos, buscarEvento, criarEvento as dbCriarEvento, atualizarEvento, deletarEvento as dbDeletarEvento,
  encerrarEvento as dbEncerrarEvento, reabrirEvento as dbReabrirEvento, salvarCondicoes,
  listarMetas, salvarMetas as dbSalvarMetas,
  listarAcoes, criarAcao, atualizarAcao, deletarAcao,
  listarDivulgadoras, criarDivulgadora, atualizarDivulgadora, deletarDivulgadora,
  listarMarcacoes, upsertMarcacoesBatch, deletarMarcacoesDaAcao, deletarMarcacoesDaDivulgadora,
  listarPromoters, criarPromoter, atualizarPromoter, deletarPromoter as dbDeletarPromoter,
  criarVenda, atualizarVenda, deletarVenda as dbDeletarVenda,
  listarSorteios, listarTodosSorteios, criarSorteio, deletarSorteio as dbDeletarSorteio,
  listarAuditLog, inserirAuditLog, limparAuditLog,
  carregarEvento,
} from "./supabase";

// ── HELPERS ──────────────────────────────────────────────────
const fmtCur = (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtShort = (ts) => new Date(ts).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const CATS = ["Promoter", "Divulgadora", "Bday"];
const VIEWS = { HOME: "home", EVENTO: "evento", CRIAR: "criar", SORTEIO: "sorteio", STATS: "stats", RELATORIOS: "relatorios", AUDITORIA: "auditoria" };

// ── SIMILARITY ───────────────────────────────────────────────
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1]===b[j-1] ? dp[i-1][j-1] : 1+Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}
const normStr = (s) => (s||"").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g," ");
const normInsta = (s) => (s||"").trim().toLowerCase().replace(/^@/,"").replace(/\s/g,"");
const similarity = (a,b) => { const na=normStr(a),nb=normStr(b); if(!na||!nb) return 0; if(na===nb) return 1; return 1-levenshtein(na,nb)/Math.max(na.length,nb.length); };
function findDuplicates(newEntries, existing, threshold=0.78) {
  const suspects = [];
  for (const entry of newEntries) {
    const ni = normInsta(entry.instagram);
    for (const ex of existing) {
      const ei = normInsta(ex.instagram);
      if (ni&&ei&&ni===ei) { suspects.push({new:entry,existing:ex,reason:"Instagram idêntico",score:1}); break; }
      const sim = similarity(entry.nome,ex.nome);
      if (sim>=threshold&&sim<1) suspects.push({new:entry,existing:ex,reason:`Nome similar (${(sim*100).toFixed(0)}%)`,score:sim});
      else if (sim===1) { suspects.push({new:entry,existing:ex,reason:"Nome idêntico",score:1}); break; }
    }
  }
  return suspects;
}

// ── PARSER ───────────────────────────────────────────────────
function parseLista(text) {
  const lines = text.split("\n").filter(l=>l.trim());
  const results = [];
  for (const line of lines) {
    const cleaned = line.replace(/^\d+[\s\-.\)]*/,"").trim();
    if (!cleaned) continue;
    let nome="",insta="";
    const instaMatch = cleaned.match(/@([a-zA-Z0-9_.]+)/);
    if (instaMatch) {
      insta = instaMatch[1].toLowerCase();
      const beforeAt = cleaned.substring(0,cleaned.indexOf(instaMatch[0]));
      nome = beforeAt.replace(/[\/\\@\-\u2013\s]+$/,"").replace(/^\d+[\s\-.\)]*/,"").trim();
      if (!nome) nome = cleaned.substring(cleaned.indexOf(instaMatch[0])+instaMatch[0].length).replace(/^[\/\\\-\u2013\s]+/,"").trim();
    } else {
      const parts = cleaned.split(/\s*[\/\\]+\s*/);
      if (parts.length>=2) { nome=parts[0].trim(); insta=parts[parts.length-1].trim().toLowerCase().replace(/^@/,""); }
      else nome=cleaned;
    }
    nome=nome.replace(/\s+/g," ").trim();
    if (nome||insta) results.push({nome:nome||insta,instagram:insta});
  }
  return results;
}

// ── MODAL ────────────────────────────────────────────────────
function Modal({open,onClose,title,children,width=500}) {
  if (!open) return null;
  return (
    <div style={mbs} onClick={onClose}>
      <div style={{...mbox,maxWidth:width}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
          <span style={{fontSize:17,fontWeight:700,color:"#fff"}}>{title}</span>
          <button onClick={onClose} style={{background:"rgba(255,255,255,.06)",border:"none",color:"#64748b",fontSize:20,cursor:"pointer",width:32,height:32,borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
const mbs={position:"fixed",inset:0,background:"rgba(0,0,0,.85)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(4px)"};
const mbox={background:"#0d0d18",border:"1px solid rgba(139,92,246,.2)",borderRadius:22,padding:28,width:"92%",maxHeight:"88vh",overflowY:"auto",boxShadow:"0 30px 80px rgba(0,0,0,.6)"};

function Field({label,children,style}) {
  return (
    <div style={{marginBottom:13,...style}}>
      {label&&<label style={{display:"block",fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:1.5,color:"#64748b",marginBottom:7}}>{label}</label>}
      {children}
    </div>
  );
}
const inp={width:"100%",background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.08)",borderRadius:10,padding:"11px 15px",color:"#e2e8f0",fontSize:14,outline:"none",fontFamily:"inherit",transition:"all .2s"};

// ══════════════════════════════════════════════════════════════
// MAIN APP
// ══════════════════════════════════════════════════════════════
export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [users, setUsers] = useState({});
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState(VIEWS.HOME);
  const [toast, setToast] = useState(null);

  // Login
  const [loginUser, setLoginUser] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [loginErr, setLoginErr] = useState("");

  // Eventos
  const [eventos, setEventos] = useState([]);
  const [activeEventoId, setActiveEventoId] = useState(null);

  // Estado do evento ativo (carregado do Supabase)
  const [evtData, setEvtData] = useState(null); // { acoes, divulgadoras, marcacoes, metas, promoters, sorteios }
  const [evtInfo, setEvtInfo] = useState(null); // registro da tabela eventos

  // Auditoria
  const [auditLog, setAuditLog] = useState([]);
  const [auditFilter, setAuditFilter] = useState("all");

  // Sorteio global
  const [todosOsSorteios, setTodosOsSorteios] = useState([]);

  // UI states
  const [evtTab, setEvtTab] = useState("dashboard");
  const [searchTerm, setSearchTerm] = useState("");
  const [editingDiv, setEditingDiv] = useState(null);
  const [editDivNome, setEditDivNome] = useState("");
  const [editDivIg, setEditDivIg] = useState("");

  // Formulários
  const [novoNome, setNovoNome] = useState("");
  const [novoData, setNovoData] = useState("");
  const [novoMetas, setNovoMetas] = useState([{label:"",percentual:""}]);
  const [acaoTexto, setAcaoTexto] = useState("");
  const [acaoNum, setAcaoNum] = useState("");
  const [acaoNome, setAcaoNome] = useState("");
  const [dupReview, setDupReview] = useState(null);
  const [editingAcaoId, setEditingAcaoId] = useState(null);
  const [editAcaoTexto, setEditAcaoTexto] = useState("");

  // Modais
  const [editEvtModal, setEditEvtModal] = useState(false);
  const [editEvtNome, setEditEvtNome] = useState("");
  const [editEvtData, setEditEvtData] = useState("");
  const [metasModal, setMetasModal] = useState(false);
  const [tempMetas, setTempMetas] = useState([]);
  const [promModal, setPromModal] = useState(false);
  const [editingProm, setEditingProm] = useState(null);
  const [pNome, setPNome] = useState("");
  const [pEmail, setPEmail] = useState("");
  const [pLink, setPLink] = useState("");
  const [pCat, setPCat] = useState("Promoter");
  const [vendaModal, setVendaModal] = useState(false);
  const [vendaPromId, setVendaPromId] = useState(null);
  const [editingVendaId, setEditingVendaId] = useState(null);
  const [vQtd, setVQtd] = useState(1);
  const [vValor, setVValor] = useState("");
  const [vComp, setVComp] = useState("");
  const [vObs, setVObs] = useState("");
  const [condModal, setCondModal] = useState(false);
  const [condCat, setCondCat] = useState("Divulgadora");
  const [condTexto, setCondTexto] = useState("");
  const [showEncerrar, setShowEncerrar] = useState(false);
  const [showExport, setShowExport] = useState(false);

  // Sorteio
  const [sortEventoId, setSortEventoId] = useState("");
  const [sortAcaoId, setSortAcaoId] = useState("");
  const [sortQtd, setSortQtd] = useState(1);
  const [sortResult, setSortResult] = useState(null);
  const [sortAnimating, setSortAnimating] = useState(false);
  const [sortAnimName, setSortAnimName] = useState("");
  const [sortTitulo, setSortTitulo] = useState("");
  const [sortPremio, setSortPremio] = useState("");
  const [sortObs, setSortObs] = useState("");
  const [diceFace, setDiceFace] = useState("⚄");
  const [sortEventoAcoes, setSortEventoAcoes] = useState([]);
  const [sortEventoDivs, setSortEventoDivs] = useState([]);
  const [sortEventoMarcacoes, setSortEventoMarcacoes] = useState({});

  // ── INIT ─────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const [evts, audit, usrs, sorteios] = await Promise.all([
        listarEventos(),
        listarAuditLog(),
        listarUsuarios(),
        listarTodosSorteios(),
      ]);
      setEventos(evts);
      setAuditLog(audit);
      setTodosOsSorteios(sorteios);
      const usersMap = {};
      for (const u of usrs) usersMap[u.username] = u;
      setUsers(usersMap);
      setLoading(false);
    })();
  }, []);

  const showToast = useCallback((msg, type="ok") => {
    setToast({msg,type}); setTimeout(()=>setToast(null),3000);
  }, []);

  const audit = useCallback(async (tipo, acao, pagina, detalhe="") => {
    const entry = {tipo, usuario: currentUser?.username||"system", acao, pagina, detalhe};
    await inserirAuditLog(entry);
    setAuditLog(prev=>[{...entry, id: Date.now().toString(), criado_em: new Date().toISOString()},...prev].slice(0,200));
  }, [currentUser]);

  // ── AUTH ─────────────────────────────────────────────────────
  const doLogin = useCallback(async () => {
    const {user, error} = await loginUsuario(loginUser, loginPass);
    if (error) { setLoginErr(error); setTimeout(()=>setLoginErr(""),3000); return; }
    setCurrentUser(user);
    await inserirAuditLog({tipo:"system",usuario:user.username,acao:`Login realizado`,pagina:"Sistema",detalhe:""});
  }, [loginUser, loginPass]);

  const doLogout = useCallback(async () => {
    await inserirAuditLog({tipo:"system",usuario:currentUser?.username,acao:"Logout",pagina:"Sistema",detalhe:""});
    setCurrentUser(null);
    setActiveEventoId(null);
    setEvtData(null);
    setEvtInfo(null);
    setView(VIEWS.HOME);
  }, [currentUser]);

  // ── CARREGAR EVENTO ──────────────────────────────────────────
  const abrirEvento = useCallback(async (id) => {
    setLoading(true);
    try {
      const evtRow = await buscarEvento(id);
      const loaded = await carregarEvento(id);
      setEvtInfo(evtRow);
      setEvtData(loaded);
      setActiveEventoId(id);
      setView(VIEWS.EVENTO);
      setEvtTab("dashboard");
    } catch(e) {
      showToast("Erro ao carregar evento","del");
    }
    setLoading(false);
  }, [showToast]);

  const recarregarEvento = useCallback(async () => {
    if (!activeEventoId) return;
    const [evtRow, loaded] = await Promise.all([
      buscarEvento(activeEventoId),
      carregarEvento(activeEventoId),
    ]);
    setEvtInfo(evtRow);
    setEvtData(loaded);
  }, [activeEventoId]);

  // ── CALC STATS ───────────────────────────────────────────────
  const calcStats = useCallback((divulgadoras, acoes, marcacoes) => {
    if (!divulgadoras?.length||!acoes?.length) return {ranking:[],avg:0,topCount:0,acaoStats:[]};
    const totalAcoes = acoes.length;
    const ranking = divulgadoras.map(d=>{
      let ok=0;
      for (const a of acoes) if (marcacoes[`${d.id}_${a.id}`]==="OK") ok++;
      return {...d,ok,total:totalAcoes,pct:(ok/totalAcoes)*100};
    }).sort((a,b)=>b.pct-a.pct||b.ok-a.ok);
    const avg = ranking.length ? ranking.reduce((s,r)=>s+r.pct,0)/ranking.length : 0;
    const topCount = ranking.filter(r=>r.pct===100).length;
    const acaoStats = acoes.map(a=>{
      let ok=0,t=0;
      for (const d of divulgadoras) { const k=`${d.id}_${a.id}`; if(marcacoes[k]){t++;if(marcacoes[k]==="OK")ok++;} }
      return {...a,ok,total:t};
    });
    return {ranking,avg,topCount,acaoStats};
  }, []);

  const stats = useMemo(()=>{
    if (!evtData) return null;
    return calcStats(evtData.divulgadoras, evtData.acoes, evtData.marcacoes);
  }, [evtData, calcStats]);

  // ── EVENTO CRUD ───────────────────────────────────────────────
  const criarEvento = useCallback(async ()=>{
    if (!novoNome.trim()){ showToast("Informe o nome","del"); return; }
    const evt = await dbCriarEvento({nome:novoNome.trim(),data_evento:novoData,criado_por:currentUser?.username});
    if (novoMetas.filter(m=>m.label&&m.percentual).length>0) {
      await dbSalvarMetas(evt.id, novoMetas.filter(m=>m.label&&m.percentual).map(m=>({label:m.label.trim(),percentual:parseFloat(m.percentual)})));
    }
    await audit("create",`Evento "${evt.nome}" criado`,"Eventos",`Data: ${novoData||"—"}`);
    const evts = await listarEventos();
    setEventos(evts);
    setNovoNome(""); setNovoData(""); setNovoMetas([{label:"",percentual:""}]);
    showToast(`✅ Evento "${evt.nome}" criado!`);
    setView(VIEWS.HOME);
  }, [novoNome, novoData, novoMetas, currentUser, audit, showToast]);

  const deletarEvento = useCallback(async(id)=>{
    const evt = eventos.find(e=>e.id===id);
    await dbDeletarEvento(id);
    await audit("delete",`Evento "${evt?.nome}" removido`,"Eventos","");
    setEventos(prev=>prev.filter(e=>e.id!==id));
    if (activeEventoId===id){ setActiveEventoId(null); setEvtData(null); setEvtInfo(null); setView(VIEWS.HOME); }
    showToast("🗑 Evento removido","del");
  }, [eventos, activeEventoId, audit, showToast]);

  const salvarEditEvt = useCallback(async()=>{
    await atualizarEvento(activeEventoId,{nome:editEvtNome.trim(),data_evento:editEvtData});
    await audit("edit","Evento editado","Eventos",`Nome: ${evtInfo?.nome} → ${editEvtNome}`);
    setEvtInfo(prev=>({...prev,nome:editEvtNome.trim(),data_evento:editEvtData}));
    setEventos(prev=>prev.map(e=>e.id===activeEventoId?{...e,nome:editEvtNome.trim()}:e));
    setEditEvtModal(false);
    showToast("✅ Evento atualizado","edit");
  }, [activeEventoId, editEvtNome, editEvtData, evtInfo, audit, showToast]);

  const doEncerrar = useCallback(async()=>{
    await dbEncerrarEvento(activeEventoId);
    await audit("edit","Evento encerrado","Eventos",`${evtData?.acoes.length} ações finais`);
    setEvtInfo(prev=>({...prev,encerrado:true}));
    setShowEncerrar(false);
    showToast("🔒 Evento encerrado!");
  }, [activeEventoId, evtData, audit, showToast]);

  const doReabrir = useCallback(async()=>{
    await dbReabrirEvento(activeEventoId);
    await audit("edit","Evento reaberto","Eventos","");
    setEvtInfo(prev=>({...prev,encerrado:false}));
    showToast("🔓 Evento reaberto!");
  }, [activeEventoId, audit, showToast]);

  // ── METAS ────────────────────────────────────────────────────
  const doSalvarMetas = useCallback(async()=>{
    const metas = tempMetas.filter(m=>m.label&&m.percentual).map(m=>({label:m.label.trim(),percentual:parseFloat(m.percentual)}));
    const saved = await dbSalvarMetas(activeEventoId, metas);
    await audit("edit","Metas atualizadas","Metas",metas.map(m=>`${m.label} ≥${m.percentual}%`).join(" · "));
    setEvtData(prev=>({...prev,metas:saved}));
    setMetasModal(false);
    showToast("✅ Metas salvas","edit");
  }, [activeEventoId, tempMetas, audit, showToast]);

  // ── IMPORTAR AÇÃO ─────────────────────────────────────────────
  const processarAcao = useCallback(()=>{
    if (!acaoTexto.trim()){ showToast("Cole a lista","del"); return; }
    const num = parseInt(acaoNum)||(evtData.acoes.length+1);
    if (evtData.acoes.find(a=>a.numero===num)){ showToast(`Ação ${num} já existe!`,"del"); return; }
    const parsed = parseLista(acaoTexto);
    if (!parsed.length){ showToast("Nenhum nome encontrado","del"); return; }
    const suspects = findDuplicates(parsed, evtData.divulgadoras).filter(s=>s.score<1);
    if (suspects.length>0) {
      setDupReview({parsed,num,nome:acaoNome||`Ação ${num}`,suspects,decisions:suspects.map(()=>"merge")});
    } else {
      confirmarAcao(parsed,num,acaoNome||`Ação ${num}`,[]);
    }
  }, [acaoTexto, acaoNum, acaoNome, evtData, showToast]);

  const confirmarAcao = useCallback(async(parsed,num,nome,mergeDecisions)=>{
    try {
      // 1. Cria a ação
      const acao = await criarAcao({evento_id:activeEventoId,numero:num,nome,total_participantes:parsed.length});
      const mergeMap={};
      for (const md of (mergeDecisions||[])) if(md.action==="merge") mergeMap[normStr(md.newEntry.nome)]=md.existingId;

      const marcacoesNovas=[];
      const novasDivs=[];
      let participantIds=new Set();

      for (const p of parsed) {
        const pNorm=normStr(p.nome); let div=null;
        if (mergeMap[pNorm]) div=evtData.divulgadoras.find(d=>d.id===mergeMap[pNorm]);
        if (!div){ const ni=normInsta(p.instagram); if(ni) div=evtData.divulgadoras.find(d=>normInsta(d.instagram)===ni); }
        if (!div) div=evtData.divulgadoras.find(d=>normStr(d.nome)===pNorm);
        if (!div) {
          div = await criarDivulgadora({evento_id:activeEventoId,nome:p.nome,instagram:p.instagram||"",entrada_acao:num});
          novasDivs.push(div);
          // X retroativo nas ações anteriores
          for (const a of evtData.acoes) {
            marcacoesNovas.push({evento_id:activeEventoId,divulgadora_id:div.id,acao_id:a.id,valor:"X"});
          }
        }
        participantIds.add(div.id);
        marcacoesNovas.push({evento_id:activeEventoId,divulgadora_id:div.id,acao_id:acao.id,valor:"OK"});
      }
      // X para quem não participou
      const todasDivs=[...evtData.divulgadoras,...novasDivs];
      for (const d of todasDivs) {
        if (!participantIds.has(d.id)) {
          marcacoesNovas.push({evento_id:activeEventoId,divulgadora_id:d.id,acao_id:acao.id,valor:"X"});
        }
      }
      await upsertMarcacoesBatch(marcacoesNovas);
      await audit("create",`Ação ${num} importada`,"Ações",`${parsed.length} participantes, ${novasDivs.length} novas`);
      await recarregarEvento();
      setAcaoTexto(""); setAcaoNum(""); setAcaoNome(""); setDupReview(null);
      showToast(`✅ Ação ${num} registrada! ${novasDivs.length} novas`);
    } catch(e){
      showToast("Erro ao importar ação","del");
    }
  }, [activeEventoId, evtData, audit, recarregarEvento, showToast]);

  const doRemoverAcao = useCallback(async(acaoId)=>{
    const a=evtData.acoes.find(x=>x.id===acaoId);
    await deletarAcao(acaoId);
    await audit("delete",`Ação ${a?.numero} removida`,"Ações","");
    await recarregarEvento();
    showToast("🗑 Ação removida","del");
  }, [evtData, audit, recarregarEvento, showToast]);

  const limparAcao = useCallback(async(acaoId)=>{
    await deletarMarcacoesDaAcao(acaoId);
    await recarregarEvento();
    setEditingAcaoId(acaoId); setEditAcaoTexto("");
    showToast("Marcações limpas. Submeta a nova lista.");
  }, [recarregarEvento, showToast]);

  const resubmitAcao = useCallback(async()=>{
    if (!editingAcaoId||!editAcaoTexto.trim()){ showToast("Cole a nova lista","del"); return; }
    const acao=evtData.acoes.find(a=>a.id===editingAcaoId); if(!acao) return;
    const parsed=parseLista(editAcaoTexto); if(!parsed.length){ showToast("Nenhum nome","del"); return; }
    try {
      await deletarMarcacoesDaAcao(editingAcaoId);
      const marcacoesNovas=[];
      const participantIds=new Set();
      for (const p of parsed) {
        const pNorm=normStr(p.nome),ni=normInsta(p.instagram); let div=null;
        if(ni) div=evtData.divulgadoras.find(d=>normInsta(d.instagram)===ni);
        if(!div) div=evtData.divulgadoras.find(d=>normStr(d.nome)===pNorm);
        if(!div) { div=await criarDivulgadora({evento_id:activeEventoId,nome:p.nome,instagram:p.instagram||"",entrada_acao:acao.numero}); }
        participantIds.add(div.id);
        marcacoesNovas.push({evento_id:activeEventoId,divulgadora_id:div.id,acao_id:editingAcaoId,valor:"OK"});
      }
      for (const d of evtData.divulgadoras) {
        if (!participantIds.has(d.id)) marcacoesNovas.push({evento_id:activeEventoId,divulgadora_id:d.id,acao_id:editingAcaoId,valor:"X"});
      }
      await upsertMarcacoesBatch(marcacoesNovas);
      await atualizarAcao(editingAcaoId,{total_participantes:parsed.length});
      await audit("edit",`Ação ${acao.numero} reprocessada`,"Ações",`${parsed.length} participantes`);
      await recarregarEvento();
      setEditingAcaoId(null); setEditAcaoTexto("");
      showToast(`✅ Ação ${acao.numero} reprocessada!`);
    } catch(e){ showToast("Erro ao reprocessar","del"); }
  }, [editingAcaoId, editAcaoTexto, evtData, activeEventoId, audit, recarregarEvento, showToast]);

  // ── DIVULGADORAS ──────────────────────────────────────────────
  const salvarEditDiv = useCallback(async(divId)=>{
    const d=evtData.divulgadoras.find(x=>x.id===divId);
    const changes=[];
    if(d.nome!==editDivNome) changes.push(`Nome: ${d.nome} → ${editDivNome}`);
    if(d.instagram!==editDivIg) changes.push(`Instagram: ${d.instagram} → ${editDivIg}`);
    await atualizarDivulgadora(divId,{nome:editDivNome,instagram:editDivIg});
    await audit("edit",`Divulgadora "${editDivNome}" editada`,"Divulgadoras",changes.join(" · ")||"Dados atualizados");
    setEvtData(prev=>({...prev,divulgadoras:prev.divulgadoras.map(x=>x.id===divId?{...x,nome:editDivNome,instagram:editDivIg}:x)}));
    setEditingDiv(null);
    showToast("✅ Divulgadora atualizada","edit");
  }, [evtData, editDivNome, editDivIg, audit, showToast]);

  const doRemoverDiv = useCallback(async(divId)=>{
    const d=evtData.divulgadoras.find(x=>x.id===divId);
    await deletarDivulgadora(divId);
    await audit("delete",`Divulgadora "${d?.nome}" removida`,"Divulgadoras","");
    await recarregarEvento();
    showToast("🗑 Divulgadora removida","del");
  }, [evtData, audit, recarregarEvento, showToast]);

  // ── PROMOTERS ─────────────────────────────────────────────────
  const salvarPromoter = useCallback(async()=>{
    if (!pNome.trim()||!pEmail.trim()||!pLink.trim()){ showToast("Nome, email e link obrigatórios","del"); return; }
    if (editingProm) {
      const p=evtData.promoters.find(x=>x.id===editingProm);
      const changes=[];
      if(p.nome!==pNome) changes.push(`Nome: ${p.nome} → ${pNome}`);
      if(p.categoria!==pCat) changes.push(`Cat: ${p.categoria} → ${pCat}`);
      await atualizarPromoter(editingProm,{nome:pNome.trim(),email:pEmail.trim(),link:pLink.trim(),categoria:pCat});
      await audit("edit",`Promoter "${pNome}" editado`,"Promoters",changes.join(" · ")||"Dados atualizados");
      showToast("✅ Promoter atualizado","edit");
    } else {
      await criarPromoter({evento_id:activeEventoId,nome:pNome.trim(),email:pEmail.trim(),link:pLink.trim(),categoria:pCat});
      await audit("create",`Promoter "${pNome}" cadastrado`,"Promoters",`Categoria: ${pCat}`);
      showToast("✅ Promoter cadastrado");
    }
    await recarregarEvento();
    setPromModal(false); setEditingProm(null); setPNome(""); setPEmail(""); setPLink(""); setPCat("Promoter");
  }, [pNome, pEmail, pLink, pCat, editingProm, activeEventoId, evtData, audit, recarregarEvento, showToast]);

  const doRemoverPromoter = useCallback(async(promId)=>{
    const p=evtData.promoters.find(x=>x.id===promId);
    await dbDeletarPromoter(promId);
    await audit("delete",`Promoter "${p?.nome}" removido`,"Promoters","");
    await recarregarEvento();
    showToast("🗑 Promoter removido","del");
  }, [evtData, audit, recarregarEvento, showToast]);

  const salvarVenda = useCallback(async()=>{
    if (!vQtd||!vValor){ showToast("Qtd e valor obrigatórios","del"); return; }
    const p=evtData.promoters.find(x=>x.id===vendaPromId);
    if (editingVendaId) {
      const v=p.vendas.find(x=>x.id===editingVendaId);
      await atualizarVenda(editingVendaId,{qtd:parseInt(vQtd),valor:parseFloat(vValor),comprovante:vComp,obs:vObs});
      await audit("edit",`Venda editada — ${p?.nome}`,"Promoters",`Qtd: ${v?.qtd}→${vQtd} R$${v?.valor}→${vValor}`);
      showToast("✅ Venda atualizada","edit");
    } else {
      await criarVenda({promoter_id:vendaPromId,evento_id:activeEventoId,qtd:parseInt(vQtd),valor:parseFloat(vValor),comprovante:vComp,obs:vObs});
      await audit("create",`Venda registrada — ${p?.nome}`,"Promoters",`${vQtd}× ${fmtCur(parseInt(vQtd)*parseFloat(vValor))}`);
      showToast("✅ Venda registrada");
    }
    await recarregarEvento();
    setVendaModal(false); setEditingVendaId(null); setVQtd(1); setVValor(""); setVComp(""); setVObs("");
  }, [vQtd, vValor, vComp, vObs, vendaPromId, editingVendaId, activeEventoId, evtData, audit, recarregarEvento, showToast]);

  const doRemoverVenda = useCallback(async(vendaId)=>{
    await dbDeletarVenda(vendaId);
    await audit("delete","Venda removida","Promoters","");
    await recarregarEvento();
    showToast("🗑 Venda removida","del");
  }, [audit, recarregarEvento, showToast]);

  const doSalvarCondicoes = useCallback(async()=>{
    const novasCondicoes={...(evtInfo?.condicoes||{}),[condCat]:condTexto};
    await salvarCondicoes(activeEventoId,novasCondicoes);
    await audit("edit",`Condições — ${condCat} atualizadas`,"Promoters","");
    setEvtInfo(prev=>({...prev,condicoes:novasCondicoes}));
    setCondModal(false);
    showToast("✅ Condições salvas","edit");
  }, [activeEventoId, evtInfo, condCat, condTexto, audit, showToast]);

  // ── SORTEIO ───────────────────────────────────────────────────
  useEffect(()=>{
    if (!sortEventoId) return;
    (async()=>{
      const [acoes,divs,marc] = await Promise.all([
        listarAcoes(sortEventoId),
        listarDivulgadoras(sortEventoId),
        listarMarcacoes(sortEventoId),
      ]);
      setSortEventoAcoes(acoes);
      setSortEventoDivs(divs);
      setSortEventoMarcacoes(marc);
    })();
  }, [sortEventoId]);

  const sortParticipantes = useMemo(()=>{
    if (!sortAcaoId) return [];
    return sortEventoDivs.filter(d=>sortEventoMarcacoes[`${d.id}_${sortAcaoId}`]==="OK");
  }, [sortEventoDivs, sortEventoMarcacoes, sortAcaoId]);

  const realizarSorteio = useCallback(()=>{
    if (!sortParticipantes.length){ showToast("Nenhuma participante","del"); return; }
    if (!sortTitulo.trim()){ showToast("Informe o título","del"); return; }
    const qtd=Math.min(parseInt(sortQtd)||1,sortParticipantes.length);
    setSortResult(null); setSortAnimating(true);
    const pool=[...sortParticipantes];
    const faces=["⚀","⚁","⚂","⚃","⚄","⚅"];
    let count=0;
    const iv=setInterval(()=>{
      setSortAnimName(pool[Math.floor(Math.random()*pool.length)].nome);
      setDiceFace(faces[Math.floor(Math.random()*6)]);
      count++;
      if(count>=32){
        clearInterval(iv);
        const winners=[...pool].sort(()=>Math.random()-.5).slice(0,qtd);
        setSortResult(winners); setSortAnimating(false); setSortAnimName("");
        const acao=sortEventoAcoes.find(a=>a.id===sortAcaoId);
        (async()=>{
          const s=await criarSorteio({evento_id:sortEventoId,acao_id:sortAcaoId,acao_nome:acao?`Ação ${acao.numero}`:"?",titulo:sortTitulo,premio:sortPremio,observacao:sortObs,vencedoras:winners.map(w=>({id:w.id,nome:w.nome,instagram:w.instagram}))});
          await audit("create",`Sorteio "${sortTitulo}" realizado`,"Sorteio",`Vencedora: ${winners[0]?.nome}`);
          const todos=await listarTodosSorteios();
          setTodosOsSorteios(todos);
        })();
        showToast("🎉 Sorteio realizado!");
      }
    },80);
  }, [sortParticipantes,sortQtd,sortEventoId,sortAcaoId,sortTitulo,sortPremio,sortObs,sortEventoAcoes,audit,showToast]);

  const doRemoverSorteio = useCallback(async(id)=>{
    await dbDeletarSorteio(id);
    await audit("delete","Sorteio removido","Sorteio","");
    const todos=await listarTodosSorteios();
    setTodosOsSorteios(todos);
    showToast("🗑 Sorteio removido","del");
  }, [audit, showToast]);

  // ── RELATÓRIOS ────────────────────────────────────────────────
  const generateReport = useCallback((divulgadoras,acoes,marcacoes,metas)=>{
    const s=calcStats(divulgadoras,acoes,marcacoes);
    return (metas||[]).sort((a,b)=>b.percentual-a.percentual).map(meta=>({
      meta, qualified:s.ranking.filter(r=>r.pct>=meta.percentual), notQualified:s.ranking.filter(r=>r.pct<meta.percentual)
    }));
  }, [calcStats]);

  const exportCSV = useCallback(async(tipo="parcial")=>{
    if (!evtData||!evtInfo) return;
    const {divulgadoras,acoes,marcacoes,metas,promoters,sorteios}=evtData;
    const report=generateReport(divulgadoras,acoes,marcacoes,metas);
    let csv="\uFEFF";
    csv+=`RELATÓRIO ${tipo.toUpperCase()} — ${evtInfo.nome}\nGerado em: ${new Date().toLocaleDateString("pt-BR")}\nTotal Ações: ${acoes.length}\nTotal Divulgadoras: ${divulgadoras.length}\n\n`;
    for (const r of report) {
      csv+=`META: ${r.meta.label} (>= ${r.meta.percentual}%)\nClassificadas: ${r.qualified.length}\nNome;Instagram;OKs;Total;%;Entrou\n`;
      for (const q of r.qualified) csv+=`${q.nome};${q.instagram?"@"+q.instagram:""};${q.ok};${acoes.length};${q.pct.toFixed(1)}%;Ação ${q.entrada_acao||"?"}\n`;
      csv+=`\nNão classificadas:\n`;
      for (const q of r.notQualified) csv+=`${q.nome};${q.instagram?"@"+q.instagram:""};${q.ok};${acoes.length};${q.pct.toFixed(1)}%;Ação ${q.entrada_acao||"?"}\n`;
      csv+="\n";
    }
    if (sorteios.length) {
      csv+=`SORTEIOS\nTítulo;Prêmio;Ação;Data;Vencedoras\n`;
      for (const s of sorteios) csv+=`${s.titulo};${s.premio||""};${s.acao_nome};${new Date(s.realizado_em).toLocaleString("pt-BR")};${(s.vencedoras||[]).map(v=>v.nome).join(" | ")}\n`;
      csv+="\n";
    }
    if (promoters.length) {
      csv+=`PROMOTERS\nNome;Email;Cat;Ingressos;Total R$\n`;
      for (const p of promoters) {
        const tQ=(p.vendas||[]).reduce((s,v)=>s+v.qtd,0),tV=(p.vendas||[]).reduce((s,v)=>s+(v.qtd*v.valor),0);
        csv+=`${p.nome};${p.email};${p.categoria};${tQ};${tV.toFixed(2)}\n`;
      }
    }
    const blob=new Blob([csv],{type:"text/csv;charset=utf-8"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a"); a.href=url; a.download=`relatorio_${tipo}_${evtInfo.nome.replace(/\s/g,"_")}.csv`; a.click(); URL.revokeObjectURL(url);
    await audit("export",`Relatório ${tipo} exportado`,"Relatórios",evtInfo.nome);
    showToast(`📊 Relatório ${tipo} exportado!`);
  }, [evtData, evtInfo, generateReport, audit, showToast]);

  // ── AUDITORIA ─────────────────────────────────────────────────
  const filteredAudit = useMemo(()=>
    auditFilter==="all" ? auditLog : auditLog.filter(l=>l.tipo===auditFilter||l.type===auditFilter)
  , [auditLog, auditFilter]);

  const doLimparAudit = useCallback(async()=>{
    await limparAuditLog();
    setAuditLog([]);
    showToast("🗑 Logs limpos","del");
  }, [showToast]);

  // ══════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════
  if (loading&&!currentUser) return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100vh",background:"#07070d"}}>
      <div style={{fontSize:40,animation:"pulse 1.5s infinite"}}>🎯</div>
      <div style={{fontSize:11,letterSpacing:3,color:"#555",marginTop:12,textTransform:"uppercase"}}>Carregando...</div>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}`}</style>
    </div>
  );

  if (!currentUser) return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh",background:"radial-gradient(ellipse 80% 60% at 50% -10%,rgba(139,92,246,.2),transparent)",fontFamily:"'Inter',system-ui,sans-serif"}}>
      <div style={{width:420,background:"rgba(17,17,32,.9)",border:"1px solid rgba(139,92,246,.25)",borderRadius:24,padding:"52px 44px"}}>
        <div style={{textAlign:"center",marginBottom:36}}>
          <div style={{fontSize:32,fontWeight:800,letterSpacing:3,background:"linear-gradient(135deg,#a78bfa,#7c3aed)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>VSLT</div>
          <div style={{fontSize:12,color:"#64748b",marginTop:4,letterSpacing:2}}>Sistema de Gestão · Produções</div>
        </div>
        <div style={{marginBottom:14}}>
          <label style={{display:"block",fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:1.5,color:"#64748b",marginBottom:8}}>Usuário</label>
          <input style={{...inp,boxSizing:"border-box"}} value={loginUser} onChange={e=>setLoginUser(e.target.value)} placeholder="admin" type="text"/>
        </div>
        <div style={{marginBottom:16}}>
          <label style={{display:"block",fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:1.5,color:"#64748b",marginBottom:8}}>Senha</label>
          <input style={{...inp,boxSizing:"border-box"}} value={loginPass} onChange={e=>setLoginPass(e.target.value)} placeholder="••••••••" type="password" onKeyDown={e=>e.key==="Enter"&&doLogin()}/>
        </div>
        <button onClick={doLogin} style={{width:"100%",padding:"15px",background:"linear-gradient(135deg,#8b5cf6,#7c3aed)",border:"none",borderRadius:12,color:"#fff",fontSize:16,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Entrar no Sistema</button>
        {loginErr&&<div style={{color:"#f87171",fontSize:13,textAlign:"center",marginTop:12}}>⚠ {loginErr}</div>}
      </div>
    </div>
  );

  const activeUser = currentUser;
  const evtTabs=[
    {id:"dashboard",icon:"📊",label:"Dashboard"},
    {id:"importar",icon:"📥",label:"Importar"},
    {id:"divulgadoras",icon:"👥",label:"Divulgadoras"},
    {id:"tabela",icon:"📋",label:"Tabela"},
    {id:"metas",icon:"🎯",label:"Metas"},
    {id:"promoters",icon:"🔗",label:"Promoters"},
    {id:"lista",icon:"🏆",label:"Lista Final"},
  ];

  return (
    <div style={{minHeight:"100vh",background:"#07070d",color:"#e2e8f0",fontFamily:"'Inter',system-ui,sans-serif",fontSize:14,display:"flex"}}>
      <style>{GLOBAL_CSS}</style>
      {toast&&<div className={`toast toast-${toast.type}`}>{toast.msg}</div>}
      {loading&&<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.6)",zIndex:2000,display:"flex",alignItems:"center",justifyContent:"center"}}><div style={{color:"#a78bfa",fontSize:14}}>Carregando...</div></div>}

      {/* SIDEBAR */}
      <div className="sidebar">
        <div className="sb-head">
          <div className="sb-brand">VSLT</div>
          <div className="sb-sub">Produções — v7 DB</div>
        </div>
        <nav className="sb-nav">
          {[
            {key:VIEWS.HOME,icon:"🏠",label:"Eventos",pill:eventos.length},
            {key:VIEWS.SORTEIO,icon:"🎲",label:"Sorteio"},
            {key:VIEWS.STATS,icon:"📈",label:"Estatísticas"},
            {key:VIEWS.RELATORIOS,icon:"📑",label:"Relatórios"},
            {key:VIEWS.AUDITORIA,icon:"🔍",label:"Auditoria",pill:auditLog.length,pillColor:"#ef4444"},
          ].map(item=>(
            <button key={item.key} className={`nb ${(view===item.key||(view===VIEWS.EVENTO&&item.key===VIEWS.HOME))?"active":""}`}
              onClick={()=>{if(item.key===VIEWS.HOME){setView(VIEWS.HOME);}else setView(item.key);}}>
              <span className="nb-ic">{item.icon}</span>
              <span style={{flex:1}}>{item.label}</span>
              {item.pill>0&&<span className="nb-pill" style={item.pillColor?{background:`${item.pillColor}25`,color:item.pillColor}:{}}>{item.pill}</span>}
            </button>
          ))}
          {eventos.length>0&&(
            <>
              <div className="sb-sec">Eventos</div>
              {eventos.map(evt=>(
                <button key={evt.id} className={`eb ${activeEventoId===evt.id&&view===VIEWS.EVENTO?"active":""}`} onClick={()=>abrirEvento(evt.id)}>
                  <div className={`edot ${evt.encerrado?"closed":""}`}/>
                  <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{evt.nome}</span>
                </button>
              ))}
            </>
          )}
        </nav>
        <div className="sb-foot">
          <div className="urow">
            <div className="uav" style={{background:`linear-gradient(135deg,${activeUser.color},${activeUser.color}99)`}}>{activeUser.nome[0]}</div>
            <div><div className="uname">{activeUser.nome}</div><div className="urole">{activeUser.role}</div></div>
            <button className="uout" onClick={doLogout} title="Sair">⏻</button>
          </div>
        </div>
      </div>

      {/* MAIN */}
      <div className="main">

        {/* HOME */}
        {view===VIEWS.HOME&&(
          <div className="page-in">
            <div className="ph">
              <div><div className="ph-t">🎪 Eventos</div><div className="ph-s">{eventos.length} evento{eventos.length!==1?"s":""}</div></div>
              <button className="btn bp" onClick={()=>setView(VIEWS.CRIAR)}>+ Novo Evento</button>
            </div>
            {eventos.length===0?<div className="empty"><div style={{fontSize:48,marginBottom:12}}>🎪</div><div style={{fontSize:15,fontWeight:700}}>Nenhum evento cadastrado</div></div>:(
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:16}}>
                {eventos.map(evt=>(
                  <div key={evt.id} className="evt-card" onClick={()=>abrirEvento(evt.id)}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                      <div style={{fontSize:15,fontWeight:800,flex:1,marginRight:8}}>{evt.nome}</div>
                      <div style={{display:"flex",gap:6,flexShrink:0}}>
                        {evt.encerrado&&<span className="badge br" style={{fontSize:9}}>ENC.</span>}
                        <button className="btn bd bsm" onClick={e=>{e.stopPropagation();deletarEvento(evt.id);}}>✕</button>
                      </div>
                    </div>
                    {evt.data_evento&&<div style={{fontSize:11,color:"#64748b",marginBottom:8}}>📅 {evt.data_evento}</div>}
                    <div style={{display:"flex",gap:14,marginTop:10}}>
                      {[{n:evt.total_divulgadoras||0,l:"DIVULG.",c:"#a78bfa"},{n:evt.total_acoes||0,l:"AÇÕES",c:"#34d399"},{n:evt.total_promoters||0,l:"PROMO.",c:"#fbbf24"},{n:evt.total_ingressos||0,l:"INGR.",c:"#f87171"}].map((st,i)=>(
                        <div key={i} style={{textAlign:"center"}}>
                          <div style={{fontFamily:"monospace",fontSize:18,fontWeight:800,color:st.c}}>{st.n}</div>
                          <div style={{fontSize:9,color:"#64748b",textTransform:"uppercase",letterSpacing:1}}>{st.l}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* CRIAR EVENTO */}
        {view===VIEWS.CRIAR&&(
          <div className="page-in" style={{maxWidth:560}}>
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:24}}>
              <button className="btn bg bsm" onClick={()=>setView(VIEWS.HOME)}>← Voltar</button>
              <span style={{fontSize:20,fontWeight:800}}>Novo Evento</span>
            </div>
            <div className="card" style={{marginBottom:14}}><Field label="Nome *"><input style={inp} value={novoNome} onChange={e=>setNovoNome(e.target.value)} placeholder="Ex: Never Ends 5 Anos"/></Field></div>
            <div className="card" style={{marginBottom:14}}><Field label="Data"><input style={inp} value={novoData} onChange={e=>setNovoData(e.target.value)} placeholder="Ex: 15/03/2026"/></Field></div>
            <div className="card" style={{marginBottom:14}}>
              <div className="ct">Metas de Divulgação</div>
              {novoMetas.map((m,i)=>(
                <div key={i} style={{display:"flex",gap:8,marginBottom:8,alignItems:"center"}}>
                  <input style={{...inp,flex:1}} value={m.label} onChange={e=>{const c=[...novoMetas];c[i].label=e.target.value;setNovoMetas(c);}} placeholder="Ex: Ouro"/>
                  <input style={{...inp,width:80,textAlign:"center"}} type="number" value={m.percentual} onChange={e=>{const c=[...novoMetas];c[i].percentual=e.target.value;setNovoMetas(c);}} placeholder="%"/>
                  <span style={{color:"#64748b"}}>%</span>
                  {novoMetas.length>1&&<button className="btn bd bsm" onClick={()=>setNovoMetas(novoMetas.filter((_,j)=>j!==i))}>✕</button>}
                </div>
              ))}
              <button className="btn bg bsm" onClick={()=>setNovoMetas([...novoMetas,{label:"",percentual:""}])}>+ Faixa</button>
            </div>
            <button className="btn bp" style={{width:"100%",padding:14,fontSize:15,justifyContent:"center"}} onClick={criarEvento}>Criar Evento</button>
          </div>
        )}

        {/* EVENTO */}
        {view===VIEWS.EVENTO&&evtInfo&&evtData&&(
          <div className="page-in">
            <div style={{background:"linear-gradient(135deg,rgba(139,92,246,.1),rgba(124,58,237,.05))",border:"1px solid rgba(139,92,246,.2)",borderRadius:16,padding:"18px 22px",marginBottom:20,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <span style={{fontSize:19,fontWeight:800}}>{evtInfo.nome}</span>
                  {evtInfo.encerrado&&<span className="badge br" style={{fontSize:10}}>ENCERRADO</span>}
                  <button className="btn bg bsm" onClick={()=>{setEditEvtNome(evtInfo.nome);setEditEvtData(evtInfo.data_evento||"");setEditEvtModal(true);}}>✏️</button>
                </div>
                <div style={{fontSize:12,color:"#64748b",marginTop:3}}>
                  {evtInfo.data_evento&&`📅 ${evtInfo.data_evento} · `}
                  {evtData.divulgadoras.length} divulg. · {evtData.acoes.length} ações · {evtData.promoters.length} promoters
                </div>
              </div>
              <div style={{display:"flex",gap:9}}>
                {evtInfo.encerrado?<button className="btn bg bsm" onClick={doReabrir}>🔓 Reabrir</button>:<button className="btn bd bsm" onClick={()=>setShowEncerrar(true)}>🔒 Encerrar</button>}
                <button className="btn bp bsm" onClick={()=>setShowExport(true)}>📤 Exportar</button>
              </div>
            </div>

            <div className="tabs">
              {evtTabs.map(t=>(
                <button key={t.id} className={`tab ${evtTab===t.id?"active":""}`} onClick={()=>setEvtTab(t.id)}>
                  <span style={{fontSize:17}}>{t.icon}</span>{t.label}
                </button>
              ))}
            </div>

            {/* DASHBOARD */}
            {evtTab==="dashboard"&&(
              <div>
                <div className="sg">
                  {[{n:evtData.divulgadoras.length,l:"Divulgadoras",c:"#a78bfa",ic:"👩‍💼"},{n:evtData.acoes.length,l:"Ações",c:"#34d399",ic:"⚡"},{n:stats?.topCount||0,l:"100% Presença",c:"#fbbf24",ic:"🏆"},{n:`${stats?.avg.toFixed(0)||0}%`,l:"Média Geral",c:"#f87171",ic:"📊"}].map((s,i)=>(
                    <div key={i} className="sc" style={{borderTop:`3px solid ${s.c}`}}><span className="sc-ic">{s.ic}</span><div className="sc-n" style={{color:s.c}}>{s.n}</div><div className="sc-l">{s.l}</div></div>
                  ))}
                </div>
                {stats&&stats.ranking.length>0&&(
                  <div className="g2">
                    <div className="card">
                      <div className="ct">🏆 Top 15</div>
                      {stats.ranking.slice(0,15).map((r,i)=>(
                        <div key={r.id} className="rr">
                          <span className="rpos" style={{color:i<3?["#fbbf24","#b0b0b0","#d4956a"][i]:"#555"}}>{i<3?["🥇","🥈","🥉"][i]:`${i+1}°`}</span>
                          <div style={{flex:1}}><div style={{fontSize:13,fontWeight:600}}>{r.nome}</div>{r.instagram&&<div style={{fontSize:11,color:"#a78bfa"}}>@{r.instagram}</div>}</div>
                          <span style={{fontSize:15,fontWeight:800,color:r.pct===100?"#34d399":r.pct>=75?"#fbbf24":"#f87171"}}>{r.pct.toFixed(0)}%</span>
                        </div>
                      ))}
                    </div>
                    <div className="card">
                      <div className="ct">📈 OKs por Ação</div>
                      {stats.acaoStats.map(a=>(
                        <div key={a.id} style={{marginBottom:11}}>
                          <div style={{display:"flex",justifyContent:"space-between",fontSize:13,marginBottom:4}}><span>Ação {a.numero}</span><span style={{color:"#64748b"}}>{a.ok}/{a.total}</span></div>
                          <div className="prog"><div className="pf" style={{width:`${a.total?(a.ok/a.total)*100:0}%`}}/></div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* IMPORTAR */}
            {evtTab==="importar"&&(
              <div style={{maxWidth:640}}>
                {!evtInfo.encerrado&&!editingAcaoId&&(
                  <div className="card" style={{marginBottom:14}}>
                    <div className="ct">📥 Importar Nova Ação</div>
                    <div style={{background:"rgba(139,92,246,.06)",border:"1px solid rgba(139,92,246,.15)",borderRadius:10,padding:"10px 14px",marginBottom:16,fontSize:13,color:"#64748b",lineHeight:1.7}}>
                      <strong style={{color:"#a78bfa"}}>Parser inteligente:</strong> todo <strong style={{color:"#34d399"}}>@</strong> = Instagram · antes da <strong style={{color:"#34d399"}}>/</strong> = nome
                    </div>
                    <div style={{display:"flex",gap:12}}>
                      <Field label="Nº Ação" style={{flex:"0 0 110px"}}><input style={inp} type="number" value={acaoNum} onChange={e=>setAcaoNum(e.target.value)} placeholder={`${evtData.acoes.length+1}`}/></Field>
                      <Field label="Nome (opcional)" style={{flex:1}}><input style={inp} value={acaoNome} onChange={e=>setAcaoNome(e.target.value)} placeholder={`Ação ${acaoNum||evtData.acoes.length+1}`}/></Field>
                    </div>
                    <Field label="Lista de participantes">
                      <textarea style={{...inp,minHeight:140,fontFamily:"monospace",fontSize:13}} value={acaoTexto} onChange={e=>setAcaoTexto(e.target.value)} placeholder={"Cole a lista:\n1- Nome / @instagram\n2- Nome / @instagram"}/>
                    </Field>
                    <div style={{display:"flex",justifyContent:"flex-end"}}><button className="btn bp" onClick={processarAcao}>Processar Ação</button></div>
                  </div>
                )}
                {editingAcaoId&&(()=>{
                  const ea=evtData.acoes.find(a=>a.id===editingAcaoId);
                  return(
                    <div className="card" style={{marginBottom:14,border:"1px solid rgba(251,191,36,.3)"}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                        <div className="ct" style={{color:"#fbbf24",margin:0}}>✏️ Editando Ação {ea?.numero}</div>
                        <button className="btn bg bsm" onClick={()=>{setEditingAcaoId(null);setEditAcaoTexto("");}}>Cancelar</button>
                      </div>
                      <textarea style={{...inp,minHeight:140,fontFamily:"monospace",fontSize:13}} value={editAcaoTexto} onChange={e=>setEditAcaoTexto(e.target.value)} placeholder={"Nova lista:\n1- Nome / @instagram"}/>
                      <div style={{display:"flex",justifyContent:"flex-end",marginTop:10}}><button className="btn bp" onClick={resubmitAcao}>Reprocessar</button></div>
                    </div>
                  );
                })()}
                {evtData.acoes.length>0&&(
                  <div className="card">
                    <div className="ct">Ações Registradas</div>
                    {[...evtData.acoes].reverse().map(a=>{
                      const s=stats?.acaoStats.find(x=>x.id===a.id);
                      return(
                        <div key={a.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"9px 0",borderBottom:"1px solid rgba(255,255,255,.04)"}}>
                          <div style={{display:"flex",alignItems:"center",gap:10}}>
                            <span style={{fontFamily:"monospace",fontWeight:700,color:"#a78bfa",width:40}}>#{a.numero}</span>
                            <span style={{fontSize:13}}>{a.nome}</span>
                          </div>
                          <div style={{display:"flex",alignItems:"center",gap:8}}>
                            <span style={{fontSize:12,color:"#64748b"}}>{s?.ok||0}/{s?.total||0}</span>
                            <button className="btn be bsm" onClick={()=>limparAcao(a.id)}>✏️</button>
                            {!evtInfo.encerrado&&<button className="btn bd bsm" onClick={()=>doRemoverAcao(a.id)}>✕</button>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* DIVULGADORAS */}
            {evtTab==="divulgadoras"&&(
              <div className="card">
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                  <div className="ct" style={{margin:0}}>👥 Divulgadoras ({evtData.divulgadoras.length})</div>
                  <input style={{...inp,width:210}} value={searchTerm} onChange={e=>setSearchTerm(e.target.value)} placeholder="🔍 Buscar..."/>
                </div>
                <div style={{overflowX:"auto"}}>
                  <table className="tbl">
                    <thead><tr><th>Nome</th><th>Instagram</th><th>Entrou</th><th>OKs</th><th>%</th><th>Ações</th></tr></thead>
                    <tbody>
                      {evtData.divulgadoras.filter(d=>{
                        if(!searchTerm)return true;
                        const s=searchTerm.toLowerCase();
                        return d.nome.toLowerCase().includes(s)||(d.instagram||"").toLowerCase().includes(s);
                      }).map(d=>{
                        const r=stats?.ranking.find(x=>x.id===d.id);
                        if(editingDiv===d.id) return(
                          <tr key={d.id} style={{background:"rgba(139,92,246,.06)"}}>
                            <td><input className="edit-input" value={editDivNome} onChange={e=>setEditDivNome(e.target.value)} style={{...inp,padding:"6px 10px",fontSize:13}}/></td>
                            <td><input className="edit-input" value={editDivIg} onChange={e=>setEditDivIg(e.target.value)} style={{...inp,padding:"6px 10px",fontSize:13}}/></td>
                            <td style={{color:"#64748b",fontSize:12}}>Ação {d.entrada_acao}</td>
                            <td>{r?.ok}/{evtData.acoes.length}</td>
                            <td><span style={{color:r?.pct===100?"#34d399":r?.pct>=75?"#fbbf24":"#f87171",fontWeight:700}}>{r?.pct.toFixed(0)}%</span></td>
                            <td><div style={{display:"flex",gap:5}}>
                              <button className="btn bs bsm" onClick={()=>salvarEditDiv(d.id)}>✓</button>
                              <button className="btn bg bsm" onClick={()=>setEditingDiv(null)}>✕</button>
                            </div></td>
                          </tr>
                        );
                        return(
                          <tr key={d.id}>
                            <td style={{fontWeight:600}}>{d.nome}</td>
                            <td style={{color:"#a78bfa"}}>{d.instagram?`@${d.instagram}`:"—"}</td>
                            <td style={{color:"#64748b",fontSize:12}}>Ação {d.entrada_acao||"?"}</td>
                            <td>{r?.ok}/{evtData.acoes.length}</td>
                            <td><span style={{color:r?.pct===100?"#34d399":r?.pct>=75?"#fbbf24":"#f87171",fontWeight:700}}>{r?.pct.toFixed(0)}%</span></td>
                            <td><div style={{display:"flex",gap:5}}>
                              <button className="btn be bsm" onClick={()=>{setEditingDiv(d.id);setEditDivNome(d.nome);setEditDivIg(d.instagram||"");}}>✏️</button>
                              <button className="btn bd bsm" onClick={()=>doRemoverDiv(d.id)}>✕</button>
                            </div></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* TABELA */}
            {evtTab==="tabela"&&(
              !stats||!evtData.acoes.length?<div className="empty"><div style={{fontSize:48}}>📋</div></div>:(
                <div className="tbl-wrap">
                  <table className="tbl" style={{minWidth:700}}>
                    <thead><tr>
                      <th style={{position:"sticky",left:0,background:"#12121f",minWidth:150}}>Nome</th>
                      <th>Instagram</th><th>Entrada</th>
                      {evtData.acoes.map(a=><th key={a.id} style={{textAlign:"center",minWidth:44}}>A{a.numero}</th>)}
                      <th style={{textAlign:"center"}}>OK</th><th style={{textAlign:"center"}}>%</th>
                    </tr></thead>
                    <tbody>
                      {stats.ranking.map(r=>(
                        <tr key={r.id}>
                          <td style={{fontWeight:600,position:"sticky",left:0,background:"#07070d"}}>{r.nome}</td>
                          <td style={{color:"#a78bfa",fontSize:12}}>{r.instagram?`@${r.instagram}`:""}</td>
                          <td style={{fontSize:11,color:"#64748b"}}>Ação {r.entrada_acao||"?"}</td>
                          {evtData.acoes.map(a=>{const v=evtData.marcacoes[`${r.id}_${a.id}`]; return<td key={a.id} className={v==="OK"?"cell-ok":"cell-x"}>{v||"—"}</td>;})}
                          <td style={{textAlign:"center",fontWeight:700,color:"#34d399"}}>{r.ok}</td>
                          <td style={{textAlign:"center",fontWeight:700,color:r.pct===100?"#34d399":r.pct>=75?"#fbbf24":"#f87171"}}>{r.pct.toFixed(0)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}

            {/* METAS */}
            {evtTab==="metas"&&(
              <div style={{maxWidth:500}}>
                <div className="card">
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
                    <div className="ct" style={{margin:0}}>🎯 Metas</div>
                    <button className="btn be bsm" onClick={()=>{setTempMetas([...(evtData.metas||[]).map(m=>({...m})),{label:"",percentual:""}]);setMetasModal(true);}}>✏️ Editar</button>
                  </div>
                  {!evtData.metas?.length?<div style={{color:"#64748b",fontSize:13}}>Nenhuma meta. Clique em Editar.</div>:
                    evtData.metas.map((m,i)=>{
                      const qualified=stats?.ranking.filter(r=>r.pct>=m.percentual)||[];
                      return(
                        <div key={m.id||i} style={{padding:"13px 0",borderBottom:"1px solid rgba(255,255,255,.06)"}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
                            <span style={{fontSize:15,fontWeight:700}}>{i===0?"🥇":i===1?"🥈":"🥉"} {m.label}</span>
                            <span className="badge bpu">≥ {m.percentual}%</span>
                          </div>
                          <div style={{fontSize:12,color:"#34d399",marginBottom:6}}>{qualified.length} classificada{qualified.length!==1?"s":""}</div>
                          <div className="prog"><div className="pf" style={{width:`${m.percentual}%`}}/></div>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            {/* PROMOTERS */}
            {evtTab==="promoters"&&(
              <div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
                  <div style={{fontSize:19,fontWeight:800}}>🔗 Promoters</div>
                  <div style={{display:"flex",gap:9}}>
                    <button className="btn bg bsm" onClick={()=>{setCondCat("Divulgadora");setCondTexto(evtInfo.condicoes?.["Divulgadora"]||"");setCondModal(true);}}>📋 Condições</button>
                    <button className="btn bp bsm" onClick={()=>{setEditingProm(null);setPNome("");setPEmail("");setPLink("");setPCat("Promoter");setPromModal(true);}}>+ Novo Promoter</button>
                  </div>
                </div>
                {!evtData.promoters?.length?<div className="empty"><div style={{fontSize:40,marginBottom:8}}>🔗</div><div>Nenhum promoter</div></div>:
                  evtData.promoters.map(p=>{
                    const totalQ=(p.vendas||[]).reduce((s,v)=>s+v.qtd,0);
                    const totalV=(p.vendas||[]).reduce((s,v)=>s+(v.qtd*v.valor),0);
                    const cond=evtInfo.condicoes?.[p.categoria]||"";
                    return(
                      <div key={p.id} className="pc">
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14}}>
                          <div>
                            <div style={{display:"flex",alignItems:"center",gap:9,marginBottom:4}}>
                              <span style={{fontSize:16,fontWeight:800}}>{p.nome}</span>
                              <span className={`badge ${p.categoria==="Bday"?"by":p.categoria==="Promoter"?"bbl":"bgr"}`}>{p.categoria}</span>
                            </div>
                            <div style={{fontSize:12,color:"#64748b"}}>{p.email}</div>
                            <div style={{fontSize:12,color:"#8b5cf6",marginTop:2}}>{p.link}</div>
                            {cond&&<div style={{marginTop:7,fontSize:12,color:"#fbbf24",background:"rgba(245,158,11,.08)",border:"1px solid rgba(245,158,11,.15)",borderRadius:7,padding:"4px 10px",display:"inline-block"}}>📋 {cond.substring(0,70)}{cond.length>70?"...":""}</div>}
                          </div>
                          <div style={{display:"flex",gap:7}}>
                            <button className="btn bg bsm" onClick={()=>{setEditingProm(p.id);setPNome(p.nome);setPEmail(p.email);setPLink(p.link);setPCat(p.categoria||"Promoter");setPromModal(true);}}>✏️</button>
                            <button className="btn bp bsm" onClick={()=>{setVendaPromId(p.id);setEditingVendaId(null);setVQtd(1);setVValor("");setVComp("");setVObs("");setVendaModal(true);}}>+ Venda</button>
                            <button className="btn bd bsm" onClick={()=>doRemoverPromoter(p.id)}>✕</button>
                          </div>
                        </div>
                        <div style={{display:"flex",gap:22,padding:"13px 0",borderTop:"1px solid rgba(255,255,255,.06)",borderBottom:(p.vendas||[]).length>0?"1px solid rgba(255,255,255,.06)":"none",marginBottom:(p.vendas||[]).length>0?14:0}}>
                          <div><div style={{fontSize:26,fontWeight:800,color:"#34d399",fontFamily:"monospace"}}>{totalQ}</div><div style={{fontSize:10,color:"#64748b",textTransform:"uppercase",letterSpacing:1,marginTop:2}}>Ingressos</div></div>
                          <div><div style={{fontSize:20,fontWeight:800,color:"#fbbf24",fontFamily:"monospace"}}>{fmtCur(totalV)}</div><div style={{fontSize:10,color:"#64748b",textTransform:"uppercase",letterSpacing:1,marginTop:2}}>Total Vendas</div></div>
                        </div>
                        {(p.vendas||[]).length>0&&(
                          <><div className="ct">Vendas</div>
                          <table className="tbl">
                            <thead><tr><th>Qtd</th><th>Valor/un</th><th>Total</th><th>Comprovante</th><th>Data</th><th></th></tr></thead>
                            <tbody>
                              {p.vendas.map(v=>(
                                <tr key={v.id}>
                                  <td><span style={{color:"#34d399",fontWeight:700,fontSize:14}}>{v.qtd}×</span></td>
                                  <td style={{color:"#fbbf24"}}>{fmtCur(v.valor)}</td>
                                  <td style={{fontWeight:700}}>{fmtCur(v.qtd*v.valor)}</td>
                                  <td><span style={{color:"#a78bfa",fontSize:12}}>{v.comprovante?`📎 ${v.comprovante}`:"—"}</span></td>
                                  <td style={{color:"#64748b",fontSize:12}}>{v.criado_em?new Date(v.criado_em).toLocaleDateString("pt-BR"):"—"}</td>
                                  <td><div style={{display:"flex",gap:5}}>
                                    <button className="btn be bsm" onClick={()=>{setVendaPromId(p.id);setEditingVendaId(v.id);setVQtd(v.qtd);setVValor(v.valor);setVComp(v.comprovante||"");setVObs(v.obs||"");setVendaModal(true);}}>✏️</button>
                                    <button className="btn bd bsm" onClick={()=>doRemoverVenda(v.id)}>✕</button>
                                  </div></td>
                                </tr>
                              ))}
                            </tbody>
                          </table></>
                        )}
                      </div>
                    );
                  })}
              </div>
            )}

            {/* LISTA FINAL */}
            {evtTab==="lista"&&(()=>{
              const report=generateReport(evtData.divulgadoras,evtData.acoes,evtData.marcacoes,evtData.metas);
              return(
                <div>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
                    <div style={{fontSize:19,fontWeight:800}}>🏆 Lista Final</div>
                    <button className="btn bp bsm" onClick={()=>exportCSV(evtInfo.encerrado?"final":"parcial")}>⬇ Exportar</button>
                  </div>
                  {!evtData.metas?.length?<div className="card" style={{textAlign:"center",padding:32,color:"#64748b"}}>Defina metas primeiro</div>:
                    report.map((r,i)=>(
                      <div key={i} className="card" style={{marginBottom:14}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,paddingBottom:12,borderBottom:"1px solid rgba(255,255,255,.06)"}}>
                          <span style={{fontSize:16,fontWeight:800}}>{r.meta.label}</span>
                          <span style={{color:"#a78bfa",fontFamily:"monospace",fontSize:13}}>≥ {r.meta.percentual}% — {r.qualified.length} classificadas</span>
                        </div>
                        {r.qualified.map(q=>(
                          <div key={q.id} style={{display:"flex",justifyContent:"space-between",padding:"6px 8px",fontSize:13,borderBottom:"1px solid rgba(255,255,255,.04)"}}>
                            <div><strong>{q.nome}</strong>{q.instagram&&<span style={{color:"#a78bfa",marginLeft:6}}>@{q.instagram}</span>}</div>
                            <div style={{display:"flex",gap:10}}><span style={{color:"#64748b"}}>{q.ok}/{evtData.acoes.length}</span><span style={{fontWeight:700,color:"#34d399"}}>{q.pct.toFixed(0)}%</span></div>
                          </div>
                        ))}
                        {r.notQualified.length>0&&(
                          <details style={{marginTop:8}}>
                            <summary style={{fontSize:11,color:"#f87171",textTransform:"uppercase",letterSpacing:1,cursor:"pointer",userSelect:"none"}}>❌ Não classificadas ({r.notQualified.length})</summary>
                            {r.notQualified.map(q=>(
                              <div key={q.id} style={{display:"flex",justifyContent:"space-between",padding:"4px 8px",fontSize:12}}>
                                <span style={{color:"#64748b"}}>{q.nome}</span>
                                <span style={{color:"#f87171"}}>{q.pct.toFixed(0)}%</span>
                              </div>
                            ))}
                          </details>
                        )}
                      </div>
                    ))}
                  {evtData.sorteios.length>0&&(
                    <div className="card">
                      <div className="ct">🎲 Sorteios</div>
                      {evtData.sorteios.map(s=>(
                        <div key={s.id} style={{padding:"11px 0",borderBottom:"1px solid rgba(255,255,255,.04)"}}>
                          <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}><span style={{fontWeight:700,color:"#fbbf24"}}>{s.titulo}</span><span style={{fontSize:11,color:"#64748b"}}>{new Date(s.realizado_em).toLocaleDateString("pt-BR")}</span></div>
                          {s.premio&&<div style={{fontSize:12,color:"#34d399",marginBottom:2}}>🎁 {s.premio}</div>}
                          {(s.vencedoras||[]).map((v,i)=><div key={i} style={{fontSize:13,paddingLeft:8,marginTop:2}}><span style={{color:"#fbbf24",fontWeight:700,marginRight:8}}>{i+1}°</span>{v.nome}</div>)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        {/* SORTEIO */}
        {view===VIEWS.SORTEIO&&(
          <div className="page-in">
            <div className="ph"><div><div className="ph-t">🎲 Sorteio</div><div className="ph-s">Selecione evento e ação</div></div></div>
            <div className="g2" style={{maxWidth:860}}>
              <div className="card">
                <div className="ct">⚙️ Configuração</div>
                <Field label="Evento *"><select style={inp} value={sortEventoId} onChange={e=>{setSortEventoId(e.target.value);setSortAcaoId("");setSortResult(null);}}>
                  <option value="">Selecione...</option>
                  {eventos.map(e=><option key={e.id} value={e.id}>{e.nome}</option>)}
                </select></Field>
                {sortEventoAcoes.length>0&&<Field label="Ação base *"><select style={inp} value={sortAcaoId} onChange={e=>{setSortAcaoId(e.target.value);setSortResult(null);}}>
                  <option value="">Selecione...</option>
                  {sortEventoAcoes.map(a=><option key={a.id} value={a.id}>Ação {a.numero} — {a.nome}</option>)}
                </select></Field>}
                {sortAcaoId&&<div style={{background:"rgba(139,92,246,.06)",border:"1px solid rgba(139,92,246,.15)",borderRadius:9,padding:"9px 13px",fontSize:13,color:"#64748b",marginBottom:13}}>🟢 {sortParticipantes.length} participante(s)</div>}
                <Field label="Título *"><input style={inp} value={sortTitulo} onChange={e=>setSortTitulo(e.target.value)} placeholder="Ex: Sorteio #1 — VIP"/></Field>
                <Field label="🎁 O que o ganhador irá ganhar *"><input style={inp} value={sortPremio} onChange={e=>setSortPremio(e.target.value)} placeholder="Ex: 2 ingressos VIP + open bar"/></Field>
                <Field label="Observação"><input style={inp} value={sortObs} onChange={e=>setSortObs(e.target.value)} placeholder="Ex: Retirar até 22h"/></Field>
                <Field label="Qtd vencedoras"><input style={{...inp,maxWidth:110,textAlign:"center"}} type="number" value={sortQtd} onChange={e=>setSortQtd(e.target.value)} min="1"/></Field>
                <button className="btn bp" style={{width:"100%",justifyContent:"center",padding:"13px",fontSize:15}} onClick={realizarSorteio} disabled={sortAnimating||!sortAcaoId||!sortTitulo.trim()}>
                  {sortAnimating?"🎲 Sorteando...":"🎲 Realizar Sorteio"}
                </button>
              </div>
              <div>
                <div className="card" style={{textAlign:"center",minHeight:200,display:"flex",flexDirection:"column",justifyContent:"center"}}>
                  {!sortAnimating&&!sortResult&&<div><div style={{fontSize:52,marginBottom:12}}>🎰</div><div style={{color:"#64748b"}}>Configure e clique em Realizar Sorteio</div></div>}
                  {sortAnimating&&(
                    <div style={{padding:"14px 0"}}>
                      <div style={{fontSize:76,display:"inline-block",animation:"spin .18s linear infinite"}}>{diceFace}</div>
                      <div style={{fontSize:11,color:"#64748b",textTransform:"uppercase",letterSpacing:3,margin:"12px 0 7px"}}>Sorteando...</div>
                      <div style={{fontSize:19,fontWeight:700,color:"#fbbf24",fontFamily:"monospace",animation:"pulse .3s infinite"}}>{sortAnimName}</div>
                    </div>
                  )}
                  {sortResult&&!sortAnimating&&(
                    <div style={{padding:"14px"}}>
                      <div style={{fontSize:12,color:"#34d399",textTransform:"uppercase",letterSpacing:2,marginBottom:16}}>🎉 Vencedora!</div>
                      {sortResult.map((w,i)=>(
                        <div key={w.id} style={{display:"inline-flex",alignItems:"center",gap:14,background:"rgba(139,92,246,.1)",border:"1px solid rgba(139,92,246,.2)",borderRadius:14,padding:"14px 22px",marginBottom:8}}>
                          <div style={{fontSize:26,fontWeight:800,color:"#fbbf24"}}>{i+1}°</div>
                          <div style={{textAlign:"left"}}><div style={{fontSize:19,fontWeight:800}}>{w.nome}</div>{w.instagram&&<div style={{color:"#a78bfa",fontSize:13}}>@{w.instagram}</div>}</div>
                        </div>
                      ))}
                      {sortPremio&&<div style={{marginTop:12,fontSize:13,color:"#34d399"}}>🎁 {sortPremio}</div>}
                    </div>
                  )}
                </div>
                {todosOsSorteios.length>0&&(
                  <div className="card">
                    <div className="ct">📜 Histórico</div>
                    {todosOsSorteios.slice(0,10).map(s=>(
                      <div key={s.id} style={{padding:"11px 0",borderBottom:"1px solid rgba(255,255,255,.04)"}}>
                        <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                          <span style={{fontWeight:700,color:"#fbbf24",fontSize:13}}>{s.titulo}</span>
                          <div style={{display:"flex",gap:8,alignItems:"center"}}>
                            <span style={{fontSize:11,color:"#64748b"}}>{new Date(s.realizado_em).toLocaleDateString("pt-BR")}</span>
                            <button className="btn bd bsm" style={{padding:"2px 7px"}} onClick={()=>doRemoverSorteio(s.id)}>✕</button>
                          </div>
                        </div>
                        {s.premio&&<div style={{fontSize:12,color:"#34d399",marginBottom:2}}>🎁 {s.premio}</div>}
                        <div style={{fontSize:11,color:"#64748b"}}>{s.eventos?.nome}</div>
                        {(s.vencedoras||[]).map((v,i)=><div key={i} style={{fontSize:12,paddingLeft:8,marginTop:2}}><span style={{color:"#fbbf24",fontWeight:700,marginRight:6}}>{i+1}°</span>{v.nome}</div>)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ESTATÍSTICAS */}
        {view===VIEWS.STATS&&(
          <div className="page-in">
            <div className="ph"><div><div className="ph-t">📈 Estatísticas</div><div className="ph-s">Dados do banco de dados</div></div></div>
            <div className="sg">
              {[{n:eventos.length,l:"Eventos",c:"#a78bfa",ic:"🎪"},{n:eventos.reduce((s,e)=>s+(e.total_divulgadoras||0),0),l:"Divulgadoras",c:"#34d399",ic:"👩‍💼"},{n:eventos.reduce((s,e)=>s+(e.total_acoes||0),0),l:"Ações",c:"#fbbf24",ic:"⚡"},{n:eventos.reduce((s,e)=>s+(e.total_ingressos||0),0),l:"Ingressos",c:"#f87171",ic:"🎟️"}].map((st,i)=>(
                <div key={i} className="sc" style={{borderTop:`3px solid ${st.c}`}}><span className="sc-ic">{st.ic}</span><div className="sc-n" style={{color:st.c}}>{st.n}</div><div className="sc-l">{st.l}</div></div>
              ))}
            </div>
            <div className="card">
              <div className="ct">Comparativo de Eventos</div>
              {eventos.map(evt=>(
                <div key={evt.id} style={{marginBottom:18}}>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:14,fontWeight:700,marginBottom:6}}>
                    <span>{evt.nome}</span>
                    <span style={{color:"#fbbf24",fontFamily:"monospace"}}>{evt.total_ingressos||0} ingressos</span>
                  </div>
                  <div style={{height:26,background:"#1a1a2e",borderRadius:7,overflow:"hidden"}}>
                    <div style={{height:"100%",width:`${Math.min((evt.total_ingressos||0)/10,100)}%`,background:"linear-gradient(90deg,#a78bfa,#34d399)",borderRadius:7,minWidth:evt.total_ingressos>0?20:0,display:"flex",alignItems:"center",paddingLeft:8}}>
                      {(evt.total_ingressos||0)>5&&<span style={{fontSize:11,fontWeight:700,color:"rgba(0,0,0,.7)"}}>{evt.total_ingressos}</span>}
                    </div>
                  </div>
                  <div style={{display:"flex",gap:14,fontSize:12,color:"#64748b",marginTop:6}}>
                    <span>👥 {evt.total_divulgadoras||0}</span><span>⚡ {evt.total_acoes||0}</span><span>🔗 {evt.total_promoters||0}</span><span>💰 {fmtCur(evt.total_vendas_valor||0)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* RELATÓRIOS */}
        {view===VIEWS.RELATORIOS&&(
          <div className="page-in">
            <div className="ph"><div><div className="ph-t">📑 Relatórios</div><div className="ph-s">Exportação CSV</div></div></div>
            {eventos.map(evt=>(
              <div key={evt.id} className="card" style={{maxWidth:660,marginBottom:10,padding:"16px 20px"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div><div style={{fontSize:15,fontWeight:700}}>{evt.nome}{evt.encerrado&&<span className="badge br" style={{fontSize:9,marginLeft:8}}>ENC.</span>}</div>
                  <div style={{fontSize:12,color:"#64748b",marginTop:3}}>{evt.total_divulgadoras||0} divulg. · {evt.total_acoes||0} ações</div></div>
                  <div style={{display:"flex",gap:8}}>
                    <button className="btn bg bsm" onClick={async()=>{await abrirEvento(evt.id);exportCSV("parcial");}}>📊 Parcial</button>
                    <button className={`btn bsm ${evt.encerrado?"bs":"bg"}`} style={!evt.encerrado?{color:"#333",cursor:"not-allowed"}:{}} onClick={async()=>{if(evt.encerrado){await abrirEvento(evt.id);exportCSV("final");}}}>🏆 Final</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* AUDITORIA */}
        {view===VIEWS.AUDITORIA&&(
          <div className="page-in">
            <div className="ph">
              <div><div className="ph-t">🔍 Auditoria</div><div className="ph-s">Histórico completo de alterações</div></div>
              <button className="btn bd bsm" onClick={doLimparAudit}>🗑 Limpar</button>
            </div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:16}}>
              {["all","create","edit","delete","export","system"].map(f=>(
                <button key={f} className={`af-btn ${auditFilter===f?"active":""}`} onClick={()=>setAuditFilter(f)}>
                  {{all:"Todos",create:"➕ Criações",edit:"✏️ Edições",delete:"🗑 Exclusões",export:"📤 Export",system:"⚙️ Sistema"}[f]}
                </button>
              ))}
            </div>
            <div className="card">
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                <div className="ct" style={{margin:0}}>Registros</div>
                <span style={{fontSize:12,color:"#64748b"}}>{filteredAudit.length} registro{filteredAudit.length!==1?"s":""}</span>
              </div>
              <div style={{maxHeight:500,overflowY:"auto"}}>
                {filteredAudit.length===0?<div className="empty" style={{padding:"30px 20px"}}>Nenhum registro</div>:
                  filteredAudit.map((l,idx)=>{
                    const usr=users[l.usuario||l.user]||{nome:l.usuario||l.user||"?",color:"#8b5cf6"};
                    const tipo=l.tipo||l.type;
                    const typeColor={create:"#34d399",edit:"#fbbf24",delete:"#f87171",export:"#60a5fa",system:"#a78bfa"}[tipo]||"#a78bfa";
                    const typeLabel={create:"➕ Criação",edit:"✏️ Edição",delete:"🗑 Exclusão",export:"📤 Export",system:"⚙️ Sistema"}[tipo]||tipo;
                    return(
                      <div key={l.id||idx} style={{display:"flex",gap:0,alignItems:"flex-start",padding:"12px 0",borderBottom:"1px solid rgba(255,255,255,.04)"}}>
                        <span style={{fontSize:11,color:"#64748b",fontFamily:"monospace",width:120,flexShrink:0,paddingTop:2}}>{fmtShort(l.criado_em||l.ts)}</span>
                        <div style={{width:90,flexShrink:0}}>
                          <div style={{display:"inline-flex",alignItems:"center",gap:6}}>
                            <div style={{width:26,height:26,borderRadius:"50%",background:`${usr.color}22`,color:usr.color,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,fontSize:11}}>{(usr.nome||"?")[0]}</div>
                            <span style={{fontSize:12,fontWeight:600,color:usr.color}}>{usr.nome}</span>
                          </div>
                        </div>
                        <div style={{flex:1,padding:"0 12px"}}>
                          <div style={{fontSize:13,display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                            {l.acao||l.action}
                            <span style={{background:`${typeColor}18`,color:typeColor,fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:6,letterSpacing:.5}}>{typeLabel}</span>
                          </div>
                          {(l.detalhe||l.detail)&&<div style={{fontSize:12,color:"#64748b",marginTop:3}}>{l.detalhe||l.detail}</div>}
                        </div>
                        <span style={{flexShrink:0,paddingTop:2}}><span style={{background:"rgba(139,92,246,.1)",color:"#a78bfa",fontSize:10,fontWeight:600,padding:"2px 8px",borderRadius:6}}>{l.pagina||l.page}</span></span>
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* MODALS */}
      <Modal open={editEvtModal} onClose={()=>setEditEvtModal(false)} title="✏️ Editar Evento">
        <Field label="Nome *"><input style={inp} value={editEvtNome} onChange={e=>setEditEvtNome(e.target.value)}/></Field>
        <Field label="Data"><input style={inp} value={editEvtData} onChange={e=>setEditEvtData(e.target.value)}/></Field>
        <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:8}}>
          <button className="btn bg" onClick={()=>setEditEvtModal(false)}>Cancelar</button>
          <button className="btn bp" onClick={salvarEditEvt}>Salvar</button>
        </div>
      </Modal>

      <Modal open={showEncerrar} onClose={()=>setShowEncerrar(false)} title="🔒 Encerrar Evento">
        <div style={{fontSize:13,color:"#64748b",marginBottom:16,lineHeight:1.7}}>O percentual será calculado sobre as <strong style={{color:"#fbbf24"}}>{evtData?.acoes.length} ações totais</strong>. Quem entrou tarde terá X retroativos.</div>
        <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
          <button className="btn bg" onClick={()=>setShowEncerrar(false)}>Cancelar</button>
          <button className="btn bd" onClick={doEncerrar}>Confirmar</button>
        </div>
      </Modal>

      <Modal open={showExport} onClose={()=>setShowExport(false)} title="📤 Exportar">
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          <button className="btn bp" style={{width:"100%",justifyContent:"center",padding:12}} onClick={()=>{exportCSV("parcial");setShowExport(false);}}>📊 Relatório Parcial</button>
          <button style={{width:"100%",padding:12,borderRadius:10,border:"none",fontFamily:"inherit",fontSize:14,fontWeight:600,cursor:evtInfo?.encerrado?"pointer":"not-allowed",background:evtInfo?.encerrado?"rgba(16,185,129,.1)":"#1a1a28",color:evtInfo?.encerrado?"#34d399":"#444"}} onClick={()=>{if(evtInfo?.encerrado){exportCSV("final");setShowExport(false);}}}>
            🏆 Relatório Final {!evtInfo?.encerrado&&"(encerre primeiro)"}
          </button>
          <button className="btn bg" style={{width:"100%",justifyContent:"center"}} onClick={()=>setShowExport(false)}>Cancelar</button>
        </div>
      </Modal>

      <Modal open={promModal} onClose={()=>{setPromModal(false);setEditingProm(null);}} title={editingProm?"✏️ Editar Promoter":"➕ Novo Promoter"}>
        <Field label="Nome *"><input style={inp} value={pNome} onChange={e=>setPNome(e.target.value)} placeholder="Nome completo"/></Field>
        <Field label="Email *"><input style={inp} type="email" value={pEmail} onChange={e=>setPEmail(e.target.value)} placeholder="email@exemplo.com"/></Field>
        <Field label="Link *"><input style={inp} value={pLink} onChange={e=>setPLink(e.target.value)} placeholder="https://vslt.com/r/link"/></Field>
        <Field label="Categoria"><select style={inp} value={pCat} onChange={e=>setPCat(e.target.value)}>{CATS.map(c=><option key={c} value={c}>{c}</option>)}</select></Field>
        <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:8}}>
          <button className="btn bg" onClick={()=>{setPromModal(false);setEditingProm(null);}}>Cancelar</button>
          <button className="btn bp" onClick={salvarPromoter}>{editingProm?"Salvar":"Cadastrar"}</button>
        </div>
      </Modal>

      <Modal open={vendaModal} onClose={()=>{setVendaModal(false);setEditingVendaId(null);}} title={editingVendaId?"✏️ Editar Venda":"💳 Registrar Venda"}>
        {vendaPromId&&(()=>{
          const p=evtData?.promoters?.find(x=>x.id===vendaPromId);
          return<div style={{background:"rgba(139,92,246,.08)",border:"1px solid rgba(139,92,246,.2)",borderRadius:9,padding:"9px 13px",fontSize:13,color:"#a78bfa",marginBottom:14}}>Promoter: <strong>{p?.nome}</strong> · {p?.categoria}</div>;
        })()}
        <div style={{display:"flex",gap:12}}>
          <Field label="Qtd *" style={{flex:1}}><input style={{...inp,textAlign:"center"}} type="number" min="1" value={vQtd} onChange={e=>setVQtd(e.target.value)}/></Field>
          <Field label="Valor R$ *" style={{flex:1}}><input style={inp} type="number" min="0" step="0.01" value={vValor} onChange={e=>setVValor(e.target.value)} placeholder="60"/></Field>
        </div>
        {vQtd&&vValor&&<div style={{background:"rgba(16,185,129,.08)",border:"1px solid rgba(16,185,129,.2)",borderRadius:9,padding:"10px 14px",fontSize:14,color:"#34d399",textAlign:"center",marginBottom:13}}>Total: <strong>{fmtCur(parseInt(vQtd||0)*parseFloat(vValor||0))}</strong></div>}
        <Field label="Comprovante Pix"><input style={inp} value={vComp} onChange={e=>setVComp(e.target.value)} placeholder="Link ou descrição"/></Field>
        <Field label="Observação"><input style={inp} value={vObs} onChange={e=>setVObs(e.target.value)} placeholder="Ex: lote 1"/></Field>
        <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:8}}>
          <button className="btn bg" onClick={()=>{setVendaModal(false);setEditingVendaId(null);}}>Cancelar</button>
          <button className="btn bp" onClick={salvarVenda}>{editingVendaId?"Salvar":"Registrar"}</button>
        </div>
      </Modal>

      <Modal open={condModal} onClose={()=>setCondModal(false)} title="📋 Condições de Venda">
        <Field label="Categoria"><select style={inp} value={condCat} onChange={e=>{setCondCat(e.target.value);setCondTexto(evtInfo?.condicoes?.[e.target.value]||"");}}>{CATS.map(c=><option key={c} value={c}>{c}</option>)}</select></Field>
        <Field label={`Condições para ${condCat}`}><textarea style={{...inp,minHeight:130,fontSize:13}} value={condTexto} onChange={e=>setCondTexto(e.target.value)} placeholder={`Ex: Mínimo R$60/venda\nComissão: 10%\nPrazo: 3 dias antes`}/></Field>
        <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:8}}>
          <button className="btn bg" onClick={()=>setCondModal(false)}>Cancelar</button>
          <button className="btn bp" onClick={doSalvarCondicoes}>Salvar</button>
        </div>
      </Modal>

      <Modal open={metasModal} onClose={()=>setMetasModal(false)} title="🎯 Editar Metas">
        {tempMetas.map((m,i)=>(
          <div key={i} style={{display:"flex",gap:8,marginBottom:10,alignItems:"center"}}>
            <input style={{...inp,flex:1}} value={m.label} onChange={e=>{const c=[...tempMetas];c[i].label=e.target.value;setTempMetas(c);}} placeholder="Nome da faixa"/>
            <input style={{...inp,width:80,textAlign:"center"}} type="number" value={m.percentual} onChange={e=>{const c=[...tempMetas];c[i].percentual=e.target.value;setTempMetas(c);}} placeholder="%"/>
            <span style={{color:"#64748b"}}>%</span>
            {tempMetas.length>1&&<button className="btn bd bsm" onClick={()=>setTempMetas(tempMetas.filter((_,j)=>j!==i))}>✕</button>}
          </div>
        ))}
        <button className="btn bg bsm" onClick={()=>setTempMetas([...tempMetas,{label:"",percentual:""}])} style={{marginBottom:16}}>+ Adicionar</button>
        <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
          <button className="btn bg" onClick={()=>setMetasModal(false)}>Cancelar</button>
          <button className="btn bp" onClick={doSalvarMetas}>Salvar</button>
        </div>
      </Modal>

      <Modal open={!!dupReview} onClose={()=>setDupReview(null)} title="⚠️ Nomes Similares" width={580}>
        {dupReview&&(
          <>
            <div style={{maxHeight:380,overflowY:"auto"}}>
              {dupReview.suspects.map((s,i)=>(
                <div key={i} style={{padding:"12px 0",borderBottom:"1px solid rgba(255,255,255,.06)"}}>
                  <div style={{marginBottom:6}}>
                    <div style={{fontSize:13}}><span style={{color:"#fbbf24"}}>NOVO:</span> {s.new.nome}{s.new.instagram&&<span style={{color:"#a78bfa",fontSize:11}}> @{s.new.instagram}</span>}</div>
                    <div style={{fontSize:13}}><span style={{color:"#34d399"}}>EXISTENTE:</span> {s.existing.nome}</div>
                  </div>
                  <span style={{background:"rgba(251,191,36,.12)",color:"#fbbf24",fontSize:11,padding:"2px 8px",borderRadius:6}}>{s.reason}</span>
                  <div style={{display:"flex",gap:6,marginTop:8}}>
                    {["merge","novo","ignorar"].map(opt=>(
                      <button key={opt} className={`btn bsm ${dupReview.decisions[i]===opt?"bp":"bg"}`}
                        onClick={()=>setDupReview({...dupReview,decisions:dupReview.decisions.map((d,j)=>j===i?opt:d)})}>
                        {opt==="merge"?"🔗 Unificar":opt==="novo"?"➕ Nova":"🚫 Ignorar"}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:16}}>
              <button className="btn bg" onClick={()=>setDupReview(null)}>Cancelar</button>
              <button className="btn bp" onClick={()=>{
                const md=dupReview.suspects.map((s,i)=>({action:dupReview.decisions[i],newEntry:s.new,existingId:s.existing.id}));
                const ignored=new Set(md.filter(d=>d.action==="ignorar").map(d=>normStr(d.newEntry.nome)));
                const finalParsed=dupReview.parsed.filter(p=>!ignored.has(normStr(p.nome)));
                confirmarAcao(finalParsed,dupReview.num,dupReview.nome,md.filter(d=>d.action==="merge"));
              }}>Confirmar</button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

const GLOBAL_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Space+Mono:wght@400;700&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
::-webkit-scrollbar{width:4px;height:4px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:#2a2a45;border-radius:4px}
@keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
@keyframes spin{0%{transform:rotate(0) scale(1)}25%{transform:rotate(90deg) scale(1.2)}50%{transform:rotate(180deg) scale(1)}75%{transform:rotate(270deg) scale(1.2)}100%{transform:rotate(360deg) scale(1)}}
.sidebar{width:240px;background:#0d0d18;border-right:1px solid #1c1c2e;position:fixed;top:0;left:0;bottom:0;z-index:100;display:flex;flex-direction:column}
.sb-head{padding:26px 20px 20px;border-bottom:1px solid #1c1c2e}
.sb-brand{font-size:21px;font-weight:800;letter-spacing:2px;background:linear-gradient(135deg,#a78bfa,#7c3aed);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.sb-sub{font-size:10px;color:#3d3d6b;text-transform:uppercase;letter-spacing:3px;margin-top:2px}
.sb-nav{flex:1;padding:14px 10px;overflow-y:auto}
.nb{display:flex;align-items:center;gap:12px;width:100%;padding:12px 14px;border:none;background:transparent;color:#64748b;font-size:14px;cursor:pointer;border-radius:12px;text-align:left;transition:all .2s;margin-bottom:3px;font-family:inherit;font-weight:500;position:relative}
.nb:hover{color:#ccc;background:rgba(255,255,255,.04)}
.nb.active{color:#fff;background:linear-gradient(135deg,rgba(139,92,246,.22),rgba(124,58,237,.12));border:1px solid rgba(139,92,246,.18)}
.nb.active::before{content:'';position:absolute;left:0;top:25%;bottom:25%;width:3px;background:#8b5cf6;border-radius:0 3px 3px 0}
.nb-ic{font-size:21px;width:28px;text-align:center;flex-shrink:0}
.nb-pill{font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px;background:rgba(139,92,246,.2);color:#a78bfa}
.sb-sec{font-size:10px;color:#2a2a4a;font-weight:700;text-transform:uppercase;letter-spacing:2px;padding:12px 14px 5px}
.eb{display:flex;align-items:center;gap:10px;width:100%;padding:9px 14px;border:none;background:transparent;color:#64748b;font-size:12px;cursor:pointer;border-radius:9px;text-align:left;transition:all .15s;font-family:inherit}
.eb:hover{color:#bbb;background:rgba(255,255,255,.03)}.eb.active{color:#a78bfa;background:rgba(139,92,246,.08)}
.edot{width:8px;height:8px;border-radius:50%;background:#10b981;flex-shrink:0}.edot.closed{background:#64748b}
.sb-foot{padding:13px 10px;border-top:1px solid #1c1c2e}
.urow{display:flex;align-items:center;gap:10px;padding:10px 12px;background:rgba(255,255,255,.03);border-radius:10px}
.uav{width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;color:#fff;flex-shrink:0}
.uname{font-size:13px;font-weight:600;flex:1}.urole{font-size:11px;color:#64748b}
.uout{background:transparent;border:none;color:#64748b;cursor:pointer;font-size:18px;padding:4px;border-radius:6px;transition:color .2s}.uout:hover{color:#ef4444}
.main{margin-left:240px;padding:30px 34px;min-height:100vh}
.page-in{animation:fadeUp .25s}
.ph{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:26px}
.ph-t{font-size:25px;font-weight:800;color:#fff;letter-spacing:-.5px}.ph-s{font-size:13px;color:#64748b;margin-top:4px}
.sg{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:22px}
.sc{background:#12121f;border:1px solid #1c1c2e;border-radius:16px;padding:20px;transition:all .2s}
.sc:hover{border-color:#252540;transform:translateY(-2px)}
.sc-ic{font-size:30px;margin-bottom:10px;display:block}
.sc-n{font-size:32px;font-weight:800;font-family:'Space Mono',monospace;letter-spacing:-1px}
.sc-l{font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:1.5px;margin-top:4px}
.card{background:#12121f;border:1px solid #1c1c2e;border-radius:16px;padding:20px;margin-bottom:14px}
.ct{font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-bottom:14px}
.tabs{display:flex;gap:2px;border-bottom:1px solid #1c1c2e;margin-bottom:22px;overflow-x:auto}
.tab{display:flex;align-items:center;gap:7px;padding:12px 16px;border:none;background:transparent;color:#64748b;font-size:13px;cursor:pointer;border-bottom:2px solid transparent;transition:all .15s;white-space:nowrap;font-family:inherit;font-weight:500}
.tab:hover{color:#bbb}.tab.active{color:#fff;border-bottom-color:#8b5cf6}
.btn{display:inline-flex;align-items:center;gap:7px;padding:10px 18px;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;transition:all .2s;border:none;font-family:inherit;white-space:nowrap}
.bp{background:linear-gradient(135deg,#8b5cf6,#7c3aed);color:#fff}.bp:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 6px 20px rgba(139,92,246,.35)}.bp:disabled{opacity:.5;cursor:not-allowed}
.bg{background:transparent;border:1px solid #1c1c2e;color:#64748b}.bg:hover{border-color:#252540;color:#e2e8f0}
.bd{background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2);color:#f87171}.bd:hover{background:rgba(239,68,68,.14)}
.bs{background:rgba(16,185,129,.08);border:1px solid rgba(16,185,129,.2);color:#34d399}
.be{background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.2);color:#fbbf24}.be:hover{background:rgba(245,158,11,.14)}
.bsm{padding:6px 13px;font-size:12px;border-radius:8px}
.badge{display:inline-flex;align-items:center;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600}
.bpu{background:rgba(139,92,246,.15);color:#a78bfa}.bgr{background:rgba(16,185,129,.15);color:#34d399}
.br{background:rgba(239,68,68,.15);color:#f87171}.by{background:rgba(245,158,11,.15);color:#fbbf24}.bbl{background:rgba(59,130,246,.15);color:#60a5fa}
.tbl{width:100%;border-collapse:collapse}
.tbl th{padding:10px 13px;text-align:left;color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:.8px;border-bottom:1px solid #1c1c2e;font-weight:600}
.tbl td{padding:10px 13px;border-bottom:1px solid rgba(255,255,255,.04)}
.tbl tr:hover td{background:rgba(255,255,255,.02)}
.cell-ok{color:#34d399;font-weight:700;text-align:center}.cell-x{color:#f87171;font-weight:700;text-align:center}
.tbl-wrap{overflow:auto;border:1px solid #1c1c2e;border-radius:14px;max-height:380px}
.rr{display:flex;align-items:center;gap:12px;padding:11px 13px;background:#0d0d18;border:1px solid #1c1c2e;border-radius:12px;margin-bottom:5px;transition:all .15s}
.rr:hover{border-color:#252540;transform:translateX(3px)}
.rpos{font-size:15px;font-weight:700;width:30px;text-align:center}
.prog{height:6px;background:#1a1a2e;border-radius:4px;overflow:hidden}
.pf{height:100%;border-radius:4px;background:linear-gradient(90deg,#8b5cf6,#34d399);transition:width .6s}
.pc{background:#12121f;border:1px solid #1c1c2e;border-radius:16px;padding:20px;margin-bottom:14px;transition:border-color .2s}
.pc:hover{border-color:#252540}
.evt-card{background:#12121f;border:1px solid #1c1c2e;border-radius:16px;padding:20px;cursor:pointer;transition:all .2s}
.evt-card:hover{border-color:rgba(139,92,246,.4);transform:translateY(-2px)}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.empty{text-align:center;padding:60px 20px;color:#64748b}
.edit-input{background:rgba(139,92,246,.08);border:1px solid rgba(139,92,246,.4);border-radius:7px;padding:6px 10px;color:#e2e8f0;font-size:13px;outline:none;font-family:inherit;width:100%}
.af-btn{padding:6px 14px;border-radius:20px;border:1px solid #1c1c2e;background:transparent;color:#64748b;font-size:12px;cursor:pointer;transition:all .15s;font-family:inherit}
.af-btn:hover{border-color:#252540;color:#e2e8f0}.af-btn.active{background:rgba(139,92,246,.15);border-color:rgba(139,92,246,.4);color:#a78bfa}
.toast{position:fixed;bottom:26px;right:26px;padding:13px 20px;border-radius:13px;font-size:14px;font-weight:600;z-index:9999;animation:fadeUp .3s;box-shadow:0 8px 24px rgba(0,0,0,.3);color:#fff}
.toast-ok{background:linear-gradient(135deg,#10b981,#059669)}
.toast-edit{background:linear-gradient(135deg,#f59e0b,#d97706)}
.toast-del{background:linear-gradient(135deg,#ef4444,#b91c1c)}
details summary::-webkit-details-marker{display:none}details>summary{list-style:none}
`;
