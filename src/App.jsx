import { useState, useEffect, useCallback, useMemo, useRef } from "react";

const APP_KEY = "vslt-divulgadoras-v5";
const defaultState = { eventos: [], nextEventoId: 1, activeEventoId: null, logs: [] };

/* ── SIMILARITY ─────────────────────────────────────────────── */
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m+1 }, () => Array(n+1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1]===b[j-1] ? dp[i-1][j-1] : 1+Math.min(dp[i-1][j],dp[i][j-1],dp[i-1][j-1]);
  return dp[m][n];
}
function normStr(s){ return (s||"").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g," "); }
function normInsta(s){ return (s||"").trim().toLowerCase().replace(/^@/,"").replace(/\s/g,""); }
function similarity(a,b){ const na=normStr(a),nb=normStr(b); if(!na||!nb)return 0; if(na===nb)return 1; return 1-levenshtein(na,nb)/Math.max(na.length,nb.length); }
function findDuplicates(newEntries, existing, threshold=0.78) {
  const suspects = [];
  for (const entry of newEntries) {
    const ni = normInsta(entry.instagram);
    for (const ex of existing) {
      const ei = normInsta(ex.instagram);
      if (ni&&ei&&ni===ei){ suspects.push({new:entry,existing:ex,reason:"Instagram idêntico",score:1}); break; }
      const sim = similarity(entry.nome, ex.nome);
      if (sim>=threshold&&sim<1){ suspects.push({new:entry,existing:ex,reason:`Nome similar (${(sim*100).toFixed(0)}%)`,score:sim}); }
      else if (sim===1){ suspects.push({new:entry,existing:ex,reason:"Nome idêntico",score:1}); break; }
    }
  }
  return suspects;
}

/* ── PARSER ─────────────────────────────────────────────────── */
function parseLista(text) {
  const lines = text.split("\n").filter(l=>l.trim());
  const results = [];
  for (const line of lines) {
    const cleaned = line.replace(/^\d+[\s\-.\)]*/,"").trim();
    if (!cleaned) continue;
    let nome="", insta="";
    const instaMatch = cleaned.match(/@([a-zA-Z0-9_.]+)/);
    if (instaMatch) {
      insta = instaMatch[1].toLowerCase();
      const beforeAt = cleaned.substring(0, cleaned.indexOf(instaMatch[0]));
      nome = beforeAt.replace(/[\/\\@\-\u2013\s]+$/,"").replace(/^\d+[\s\-.\)]*/,"").trim();
      if (!nome) nome = cleaned.substring(cleaned.indexOf(instaMatch[0])+instaMatch[0].length).replace(/^[\/\\\-\u2013\s]+/,"").trim();
    } else {
      const parts = cleaned.split(/\s*[\/\\]+\s*/);
      if (parts.length>=2){ nome=parts[0].trim(); insta=parts[parts.length-1].trim().toLowerCase().replace(/^@/,""); }
      else nome=cleaned;
    }
    nome = nome.replace(/\s+/g," ").trim();
    if (nome||insta) results.push({ nome: nome||insta, instagram: insta });
  }
  return results;
}

/* ── UTILS ──────────────────────────────────────────────────── */
const uid = () => Math.random().toString(36).slice(2,10);
const fmtDate = (iso) => iso ? new Date(iso).toLocaleString("pt-BR") : "";
const fmtCur = (v) => Number(v||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const CATS = ["Divulgadora","Promoter","Bday"];
const VIEWS = { HOME:"home", EVENTO:"evento", CRIAR_EVENTO:"criar_evento", SORTEIO:"sorteio", ESTATISTICAS:"estatisticas", LOGS:"logs", RELATORIOS:"relatorios" };

/* ── MODAL COMPONENT ────────────────────────────────────────── */
function Modal({ open, onClose, title, children, width=520 }) {
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth:width }} onClick={e=>e.stopPropagation()}>
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18 }}>
          <span style={{ fontSize:15,fontWeight:700,color:"#e0e0e0" }}>{title}</span>
          <button onClick={onClose} style={{ background:"none",border:"none",color:"#555",cursor:"pointer",fontSize:20,lineHeight:1 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ── MAIN APP ───────────────────────────────────────────────── */
export default function App() {
  const [data, setData] = useState(defaultState);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState(VIEWS.HOME);
  const [toast, setToast] = useState(null);

  // Evento forms
  const [novoEvtNome, setNovoEvtNome] = useState("");
  const [novoEvtData, setNovoEvtData] = useState("");
  const [novoEvtMetas, setNovoEvtMetas] = useState([{label:"",percentual:""}]);

  // Ação forms
  const [acaoTexto, setAcaoTexto] = useState("");
  const [acaoNumero, setAcaoNumero] = useState("");
  const [acaoNome, setAcaoNome] = useState("");
  const [dupReview, setDupReview] = useState(null);
  const [editingAcaoId, setEditingAcaoId] = useState(null);
  const [editAcaoTexto, setEditAcaoTexto] = useState("");

  // Tabs
  const [evtTab, setEvtTab] = useState("dashboard");
  const [editingMetas, setEditingMetas] = useState(false);
  const [tempMetas, setTempMetas] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");

  // Sorteio
  const [sorteioEventoId, setSorteioEventoId] = useState("");
  const [sorteioAcao, setSorteioAcao] = useState("");
  const [sorteioQtd, setSorteioQtd] = useState(1);
  const [sorteioResult, setSorteioResult] = useState(null);
  const [sorteioAnimating, setSorteioAnimating] = useState(false);
  const [sorteioAnimName, setSorteioAnimName] = useState("");
  const [sorteioTitulo, setSorteioTitulo] = useState("");
  const [sorteioObs, setSorteioObs] = useState("");
  const [sортeioPremio, setSorteioPremio] = useState("");
  const [diceFace, setDiceFace] = useState("⚄");

  // Modals
  const [showEncerrar, setShowEncerrar] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showEditEvt, setShowEditEvt] = useState(false);
  const [editEvtNome, setEditEvtNome] = useState("");
  const [editEvtData, setEditEvtData] = useState("");

  // Promoters
  const [promoterModal, setPromoterModal] = useState(false);
  const [editingPromoter, setEditingPromoter] = useState(null);
  const [pNome, setPNome] = useState("");
  const [pEmail, setPEmail] = useState("");
  const [pLink, setPLink] = useState("");
  const [pCategoria, setPCategoria] = useState("Promoter");
  const [vendaModal, setVendaModal] = useState(null); // promoterId
  const [vQtd, setVQtd] = useState(1);
  const [vValor, setVValor] = useState("");
  const [vComprovante, setVComprovante] = useState("");
  const [vObs, setVObs] = useState("");
  const [editingVenda, setEditingVenda] = useState(null);
  const [condicoesModal, setCondicoesModal] = useState(false);
  const [condicoesCat, setCondicoesCat] = useState("Divulgadora");
  const [condicoesTexto, setCondicoesTexto] = useState("");
  const [verPromoterModal, setVerPromoterModal] = useState(null);
  const [editPromoterVendaModal, setEditPromoterVendaModal] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get(APP_KEY);
        if (r?.value) setData({ ...defaultState, ...JSON.parse(r.value) });
      } catch(e) {}
      setLoading(false);
    })();
  }, []);

  const save = useCallback(async (d) => {
    setData(d); try { await window.storage.set(APP_KEY,JSON.stringify(d)); } catch(e) {}
  }, []);

  const addLog = useCallback((d, msg, tipo="info") => {
    const logs = [{ id:uid(), msg, tipo, ts:new Date().toISOString() }, ...(d.logs||[])].slice(0,200);
    return { ...d, logs };
  }, []);

  const show = useCallback((msg,type="success") => {
    setToast({msg,type}); setTimeout(()=>setToast(null),3200);
  },[]);

  const activeEvento = useMemo(() => {
    if (!data.activeEventoId) return null;
    return data.eventos.find(e=>e.id===data.activeEventoId)||null;
  }, [data]);

  const updateEvento = useCallback((updatedEvt, logMsg) => {
    let nd = { ...data, eventos: data.eventos.map(e=>e.id===updatedEvt.id?updatedEvt:e) };
    if (logMsg) nd = addLog(nd, logMsg);
    save(nd);
  }, [data, save, addLog]);

  /* ── CALC STATS ──────────────────────────────────────────── */
  const calcStats = useCallback((evt) => {
    if (!evt) return null;
    const { divulgadoras:divs, acoes, marcacoes } = evt;
    if (!divs.length||!acoes.length) return { ranking:[], avg:0, topCount:0, acaoStats:[] };
    const totalAcoes = acoes.length;
    const ranking = divs.map(d => {
      let ok=0;
      for (const a of acoes) { if (marcacoes[`${d.id}_${a.id}`]==="OK") ok++; }
      return { ...d, ok, total:totalAcoes, pct:(ok/totalAcoes)*100 };
    }).sort((a,b)=>b.pct-a.pct||b.ok-a.ok);
    const avg = ranking.length ? ranking.reduce((s,r)=>s+r.pct,0)/ranking.length : 0;
    const topCount = ranking.filter(r=>r.pct===100).length;
    const acaoStats = acoes.map(a => {
      let ok=0,t=0;
      for (const d of divs) { const k=`${d.id}_${a.id}`; if(marcacoes[k]){t++; if(marcacoes[k]==="OK")ok++;} }
      return { ...a, ok, total:t };
    });
    return { ranking, avg, topCount, acaoStats };
  }, []);

  const stats = useMemo(()=>calcStats(activeEvento),[activeEvento,calcStats]);

  /* ── EVENTO CRUD ─────────────────────────────────────────── */
  const criarEvento = useCallback(() => {
    if (!novoEvtNome.trim()){ show("Informe o nome do evento","error"); return; }
    const metas = novoEvtMetas.filter(m=>m.label.trim()&&m.percentual).map(m=>({label:m.label.trim(),percentual:parseFloat(m.percentual)}));
    const evt = {
      id:`evt_${data.nextEventoId}`, nome:novoEvtNome.trim(), dataEvento:novoEvtData, metas,
      divulgadoras:[], acoes:[], marcacoes:{}, sorteios:[], promoters:[], condicoes:{},
      nextDivId:1, nextAcaoId:1, nextSorteioId:1, nextPromoterId:1,
      criadoEm:new Date().toISOString(), encerrado:false,
    };
    let nd = { ...data, eventos:[...data.eventos,evt], nextEventoId:data.nextEventoId+1, activeEventoId:evt.id };
    nd = addLog(nd, `Evento "${evt.nome}" criado`);
    save(nd);
    setNovoEvtNome(""); setNovoEvtData(""); setNovoEvtMetas([{label:"",percentual:""}]);
    setView(VIEWS.EVENTO); setEvtTab("dashboard");
    show(`Evento "${evt.nome}" criado!`);
  }, [novoEvtNome, novoEvtData, novoEvtMetas, data, save, addLog, show]);

  const abrirEvento = useCallback((id) => {
    save({...data,activeEventoId:id});
    setView(VIEWS.EVENTO); setEvtTab("dashboard");
  }, [data, save]);

  const deletarEvento = useCallback((id) => {
    const evt = data.eventos.find(e=>e.id===id);
    let nd = {...data, eventos:data.eventos.filter(e=>e.id!==id), activeEventoId:data.activeEventoId===id?null:data.activeEventoId};
    nd = addLog(nd, `Evento "${evt?.nome}" removido`, "danger");
    save(nd);
    if (data.activeEventoId===id) setView(VIEWS.HOME);
    show("Evento removido");
  }, [data, save, addLog, show]);

  /* ── AÇÃO CRUD ───────────────────────────────────────────── */
  const processarAcao = useCallback(() => {
    if (!activeEvento) return;
    if (!acaoTexto.trim()){ show("Cole a lista de participantes","error"); return; }
    const num = parseInt(acaoNumero)||(activeEvento.acoes.length+1);
    if (activeEvento.acoes.find(a=>a.numero===num)){ show(`Ação ${num} já existe!`,"error"); return; }
    const parsed = parseLista(acaoTexto);
    if (!parsed.length){ show("Nenhum nome encontrado","error"); return; }
    const suspects = findDuplicates(parsed, activeEvento.divulgadoras).filter(s=>s.score<1);
    if (suspects.length>0) {
      setDupReview({parsed,num,nome:acaoNome||`Ação ${num}`,suspects,decisions:suspects.map(()=>"merge")});
    } else {
      confirmarAcaoFinal(parsed,num,acaoNome||`Ação ${num}`,[]);
    }
  }, [activeEvento, acaoTexto, acaoNumero, acaoNome, show]);

  const confirmarAcaoFinal = useCallback((parsed,num,nome,mergeDecisions) => {
    if (!activeEvento) return;
    const evt = JSON.parse(JSON.stringify(activeEvento));
    const acaoId = `acao_${evt.nextAcaoId}`; evt.nextAcaoId++;
    evt.acoes.push({id:acaoId,nome,numero:num,totalParticipantes:parsed.length});
    evt.acoes.sort((a,b)=>a.numero-b.numero);
    const mergeMap = {};
    for (const md of (mergeDecisions||[])) if(md.action==="merge") mergeMap[normStr(md.newEntry.nome)]=md.existingId;
    const participantIds = new Set();
    for (const p of parsed) {
      const pNorm = normStr(p.nome); let div=null;
      if (mergeMap[pNorm]) div=evt.divulgadoras.find(d=>d.id===mergeMap[pNorm]);
      if (!div){ const ni=normInsta(p.instagram); if(ni) div=evt.divulgadoras.find(d=>normInsta(d.instagram)===ni); }
      if (!div) div=evt.divulgadoras.find(d=>normStr(d.nome)===pNorm);
      if (!div) {
        const newId=`div_${evt.nextDivId}`; evt.nextDivId++;
        div={id:newId,nome:p.nome,instagram:p.instagram||"",entradaAcao:num};
        evt.divulgadoras.push(div);
        for (const a of evt.acoes) if(a.id!==acaoId) evt.marcacoes[`${div.id}_${a.id}`]="X";
      }
      participantIds.add(div.id);
      evt.marcacoes[`${div.id}_${acaoId}`]="OK";
    }
    for (const d of evt.divulgadoras) if(!participantIds.has(d.id)) evt.marcacoes[`${d.id}_${acaoId}`]="X";
    const novas = parsed.filter(p=>{ const ni=normInsta(p.instagram),nn=normStr(p.nome); return !activeEvento.divulgadoras.some(d=>(ni&&normInsta(d.instagram)===ni)||normStr(d.nome)===nn); });
    updateEvento(evt, `Ação ${num} importada (${parsed.length} participantes, ${novas.length} novas)`);
    setAcaoTexto(""); setAcaoNumero(""); setAcaoNome(""); setDupReview(null);
    show(`Ação ${num} registrada! ${parsed.length} participantes, ${novas.length} novas`);
  }, [activeEvento, updateEvento, show]);

  const removerAcao = useCallback((acaoId) => {
    if (!activeEvento) return;
    const evt = JSON.parse(JSON.stringify(activeEvento));
    const acao = evt.acoes.find(a=>a.id===acaoId);
    evt.acoes = evt.acoes.filter(a=>a.id!==acaoId);
    Object.keys(evt.marcacoes).filter(k=>k.endsWith("_"+acaoId)).forEach(k=>delete evt.marcacoes[k]);
    updateEvento(evt, `Ação ${acao?.numero} removida`); show("Ação removida");
  }, [activeEvento, updateEvento, show]);

  const removerDiv = useCallback((divId) => {
    if (!activeEvento) return;
    const evt = JSON.parse(JSON.stringify(activeEvento));
    const div = evt.divulgadoras.find(d=>d.id===divId);
    evt.divulgadoras = evt.divulgadoras.filter(d=>d.id!==divId);
    Object.keys(evt.marcacoes).filter(k=>k.startsWith(divId+"_")).forEach(k=>delete evt.marcacoes[k]);
    updateEvento(evt, `Divulgadora "${div?.nome}" removida`); show("Divulgadora removida");
  }, [activeEvento, updateEvento, show]);

  const limparAcao = useCallback((acaoId) => {
    if (!activeEvento) return;
    const evt = JSON.parse(JSON.stringify(activeEvento));
    Object.keys(evt.marcacoes).filter(k=>k.endsWith("_"+acaoId)).forEach(k=>delete evt.marcacoes[k]);
    updateEvento(evt);
    setEditingAcaoId(acaoId); setEditAcaoTexto("");
    show("Marcações limpas. Submeta a nova lista.");
  }, [activeEvento, updateEvento, show]);

  const resubmitAcao = useCallback(() => {
    if (!activeEvento||!editingAcaoId) return;
    if (!editAcaoTexto.trim()){ show("Cole a nova lista","error"); return; }
    const acao = activeEvento.acoes.find(a=>a.id===editingAcaoId); if(!acao) return;
    const parsed = parseLista(editAcaoTexto);
    if (!parsed.length){ show("Nenhum nome encontrado","error"); return; }
    const evt = JSON.parse(JSON.stringify(activeEvento));
    const acaoId = editingAcaoId;
    Object.keys(evt.marcacoes).filter(k=>k.endsWith("_"+acaoId)).forEach(k=>delete evt.marcacoes[k]);
    const participantIds = new Set();
    for (const p of parsed) {
      const pNorm=normStr(p.nome), ni=normInsta(p.instagram); let div=null;
      if(ni) div=evt.divulgadoras.find(d=>normInsta(d.instagram)===ni);
      if(!div) div=evt.divulgadoras.find(d=>normStr(d.nome)===pNorm);
      if(!div){
        const newId=`div_${evt.nextDivId}`; evt.nextDivId++;
        div={id:newId,nome:p.nome,instagram:p.instagram||"",entradaAcao:acao.numero};
        evt.divulgadoras.push(div);
        for(const a of evt.acoes) if(a.id!==acaoId&&!evt.marcacoes[`${div.id}_${a.id}`]) evt.marcacoes[`${div.id}_${a.id}`]="X";
      }
      participantIds.add(div.id);
      evt.marcacoes[`${div.id}_${acaoId}`]="OK";
    }
    for(const d of evt.divulgadoras) if(!participantIds.has(d.id)) evt.marcacoes[`${d.id}_${acaoId}`]="X";
    const idx = evt.acoes.findIndex(a=>a.id===acaoId);
    if(idx>=0) evt.acoes[idx].totalParticipantes=parsed.length;
    updateEvento(evt, `Ação ${acao.numero} reprocessada`);
    setEditingAcaoId(null); setEditAcaoTexto("");
    show(`Ação ${acao.numero} reprocessada!`);
  }, [activeEvento, editingAcaoId, editAcaoTexto, updateEvento, show]);

  const encerrarEvento = useCallback(() => {
    if(!activeEvento) return;
    updateEvento({...activeEvento,encerrado:true,encerradoEm:new Date().toISOString()}, `Evento "${activeEvento.nome}" encerrado`);
    setShowEncerrar(false); show("Evento encerrado!");
  }, [activeEvento, updateEvento, show]);

  const reabrirEvento = useCallback(() => {
    if(!activeEvento) return;
    updateEvento({...activeEvento,encerrado:false,encerradoEm:null}, `Evento "${activeEvento.nome}" reaberto`);
    show("Evento reaberto!");
  }, [activeEvento, updateEvento, show]);

  /* ── PROMOTERS CRUD ─────────────────────────────────────── */
  const salvarPromoter = useCallback(() => {
    if (!activeEvento) return;
    if (!pNome.trim()||!pEmail.trim()||!pLink.trim()){ show("Nome, email e link são obrigatórios","error"); return; }
    const evt = JSON.parse(JSON.stringify(activeEvento));
    if (!evt.promoters) evt.promoters = [];
    if (!evt.nextPromoterId) evt.nextPromoterId = 1;
    if (editingPromoter) {
      const idx = evt.promoters.findIndex(p=>p.id===editingPromoter);
      if (idx>=0) evt.promoters[idx] = {...evt.promoters[idx], nome:pNome.trim(), email:pEmail.trim(), link:pLink.trim(), categoria:pCategoria};
      updateEvento(evt, `Promoter "${pNome}" editado`);
    } else {
      const np = {id:`prom_${evt.nextPromoterId}`,nome:pNome.trim(),email:pEmail.trim(),link:pLink.trim(),categoria:pCategoria,vendas:[],criadoEm:new Date().toISOString()};
      evt.nextPromoterId++;
      evt.promoters.push(np);
      updateEvento(evt, `Promoter "${pNome}" cadastrado`);
    }
    setPromoterModal(false); setEditingPromoter(null); setPNome(""); setPEmail(""); setPLink(""); setPCategoria("Promoter");
    show(editingPromoter ? "Promoter atualizado!" : "Promoter cadastrado!");
  }, [activeEvento, pNome, pEmail, pLink, pCategoria, editingPromoter, updateEvento, show]);

  const editarPromoter = useCallback((p) => {
    setEditingPromoter(p.id); setPNome(p.nome); setPEmail(p.email); setPLink(p.link); setPCategoria(p.categoria||"Promoter");
    setPromoterModal(true);
  }, []);

  const removerPromoter = useCallback((promId) => {
    if (!activeEvento) return;
    const evt = JSON.parse(JSON.stringify(activeEvento));
    const p = evt.promoters.find(x=>x.id===promId);
    evt.promoters = evt.promoters.filter(x=>x.id!==promId);
    updateEvento(evt, `Promoter "${p?.nome}" removido`); show("Promoter removido");
  }, [activeEvento, updateEvento, show]);

  const salvarVenda = useCallback(() => {
    if (!activeEvento||!vendaModal) return;
    if (!vQtd||!vValor){ show("Qtd e valor são obrigatórios","error"); return; }
    const evt = JSON.parse(JSON.stringify(activeEvento));
    const idx = evt.promoters.findIndex(p=>p.id===vendaModal);
    if (idx<0) return;
    if (!evt.promoters[idx].vendas) evt.promoters[idx].vendas=[];
    if (editingVenda) {
      const vi = evt.promoters[idx].vendas.findIndex(v=>v.id===editingVenda);
      if(vi>=0) evt.promoters[idx].vendas[vi]={...evt.promoters[idx].vendas[vi],qtd:parseInt(vQtd),valor:parseFloat(vValor),comprovante:vComprovante,obs:vObs,editadoEm:new Date().toISOString()};
      updateEvento(evt, `Venda editada — ${evt.promoters[idx].nome}`);
    } else {
      evt.promoters[idx].vendas.push({id:uid(),qtd:parseInt(vQtd),valor:parseFloat(vValor),comprovante:vComprovante,obs:vObs,data:new Date().toISOString()});
      updateEvento(evt, `Venda registrada — ${evt.promoters[idx].nome} (${vQtd} ingresso(s) — ${fmtCur(vValor)})`);
    }
    setVendaModal(null); setVQtd(1); setVValor(""); setVComprovante(""); setVObs(""); setEditingVenda(null);
    show("Venda salva!");
  }, [activeEvento, vendaModal, vQtd, vValor, vComprovante, vObs, editingVenda, updateEvento, show]);

  const editarVenda = useCallback((promId, venda) => {
    setVendaModal(promId); setEditingVenda(venda.id);
    setVQtd(venda.qtd); setVValor(venda.valor); setVComprovante(venda.comprovante||""); setVObs(venda.obs||"");
  }, []);

  const removerVenda = useCallback((promId, vendaId) => {
    if(!activeEvento) return;
    const evt = JSON.parse(JSON.stringify(activeEvento));
    const idx = evt.promoters.findIndex(p=>p.id===promId);
    if(idx<0) return;
    evt.promoters[idx].vendas = evt.promoters[idx].vendas.filter(v=>v.id!==vendaId);
    updateEvento(evt, `Venda removida — ${evt.promoters[idx].nome}`); show("Venda removida");
  }, [activeEvento, updateEvento, show]);

  const salvarCondicoes = useCallback(() => {
    if(!activeEvento) return;
    const evt = JSON.parse(JSON.stringify(activeEvento));
    if(!evt.condicoes) evt.condicoes={};
    evt.condicoes[condicoesCat] = condicoesTexto;
    updateEvento(evt, `Condições de venda da categoria "${condicoesCat}" atualizadas`);
    setCondicoesModal(false); show("Condições salvas!");
  }, [activeEvento, condicoesCat, condicoesTexto, updateEvento, show]);

  /* ── SORTEIO ─────────────────────────────────────────────── */
  const sorteioEvento = useMemo(()=>data.eventos.find(e=>e.id===sorteioEventoId)||null,[data,sorteioEventoId]);
  const participantesDaAcaoSorteio = useMemo(()=>{
    if(!sorteioEvento||!sorteioAcao) return [];
    const acao = sorteioEvento.acoes.find(a=>a.id===sorteioAcao);
    if(!acao) return [];
    return sorteioEvento.divulgadoras.filter(d=>sorteioEvento.marcacoes[`${d.id}_${acao.id}`]==="OK");
  },[sorteioEvento,sorteioAcao]);

  const realizarSorteio = useCallback(()=>{
    if(!participantesDaAcaoSorteio.length){show("Nenhuma participante","error");return;}
    if(!sorteioTitulo.trim()){show("Informe o título","error");return;}
    const qtd = Math.min(parseInt(sorteioQtd)||1,participantesDaAcaoSorteio.length);
    setSorteioResult(null); setSorteioAnimating(true);
    const pool=[...participantesDaAcaoSorteio];
    const faces=["⚀","⚁","⚂","⚃","⚄","⚅"];
    let count=0, total=30;
    const iv=setInterval(()=>{
      setSorteioAnimName(pool[Math.floor(Math.random()*pool.length)].nome);
      setDiceFace(faces[Math.floor(Math.random()*6)]);
      count++;
      if(count>=total){
        clearInterval(iv);
        const winners=[...pool].sort(()=>Math.random()-.5).slice(0,qtd);
        setSorteioResult(winners); setSorteioAnimating(false); setSorteioAnimName("");
        if(sorteioEvento){
          const evt=JSON.parse(JSON.stringify(sorteioEvento));
          if(!evt.sorteios) evt.sorteios=[];
          if(!evt.nextSorteioId) evt.nextSorteioId=1;
          const acao=evt.acoes.find(a=>a.id===sorteioAcao);
          evt.sorteios.push({
            id:`sort_${evt.nextSorteioId}`, titulo:sorteioTitulo, observacao:sorteioObs, premio:sортeioPremio,
            acaoId:sorteioAcao, acaoNome:acao?`Ação ${acao.numero}${acao.nome!==`Ação ${acao.numero}`?` — ${acao.nome}`:""}` : "?",
            vencedoras:winners.map(w=>({id:w.id,nome:w.nome,instagram:w.instagram})),
            data:new Date().toISOString(),
          });
          evt.nextSorteioId++;
          let nd={...data,eventos:data.eventos.map(e=>e.id===evt.id?evt:e)};
          nd=addLog(nd,`Sorteio "${sorteioTitulo}" realizado — ${evt.nome}`);
          save(nd);
        }
      }
    },80);
  },[participantesDaAcaoSorteio,sorteioQtd,sorteioEvento,sorteioAcao,sorteioTitulo,sorteioObs,sортeioPremio,data,save,addLog,show]);

  const removerSorteio = useCallback((evtId,sortId)=>{
    const evt=data.eventos.find(e=>e.id===evtId); if(!evt) return;
    const s=evt.sorteios?.find(x=>x.id===sortId);
    const updatedEvt={...evt,sorteios:(evt.sorteios||[]).filter(x=>x.id!==sortId)};
    let nd={...data,eventos:data.eventos.map(e=>e.id===evtId?updatedEvt:e)};
    nd=addLog(nd,`Sorteio "${s?.titulo}" removido`,"danger");
    save(nd); show("Sorteio removido");
  },[data,save,addLog,show]);

  /* ── REPORTS ─────────────────────────────────────────────── */
  const generateReport = useCallback((evt)=>{
    if(!evt) return [];
    const s=calcStats(evt); if(!s) return [];
    return (evt.metas||[]).sort((a,b)=>b.percentual-a.percentual).map(meta=>({
      meta,
      qualified:s.ranking.filter(r=>r.pct>=meta.percentual),
      notQualified:s.ranking.filter(r=>r.pct<meta.percentual),
    }));
  },[calcStats]);

  const exportCSV = useCallback((evt, tipo="parcial")=>{
    if(!evt) return;
    const s=calcStats(evt); const report=generateReport(evt);
    let csv="\uFEFF";
    csv+=`RELATÓRIO ${tipo.toUpperCase()} — ${evt.nome}\n`;
    csv+=`Gerado em: ${new Date().toLocaleDateString("pt-BR")}\nTotal de Ações: ${evt.acoes.length}\nTotal de Divulgadoras: ${evt.divulgadoras.length}\n\n`;
    for(const r of report){
      csv+=`META: ${r.meta.label} (>= ${r.meta.percentual}%)\nClassificadas: ${r.qualified.length}\n`;
      csv+=`Nome;Instagram;OKs;Total Ações;Percentual;Entrou na Ação\n`;
      for(const q of r.qualified) csv+=`${q.nome};${q.instagram?"@"+q.instagram:""};${q.ok};${evt.acoes.length};${q.pct.toFixed(1)}%;Ação ${q.entradaAcao||"?"}\n`;
      csv+=`\nNão classificadas:\n`;
      for(const q of r.notQualified) csv+=`${q.nome};${q.instagram?"@"+q.instagram:""};${q.ok};${evt.acoes.length};${q.pct.toFixed(1)}%;Ação ${q.entradaAcao||"?"}\n`;
      csv+="\n";
    }
    if(evt.sorteios?.length){
      csv+=`SORTEIOS\nTítulo;Prêmio;Ação;Data;Vencedoras;Observação\n`;
      for(const sr of evt.sorteios){
        const venc=sr.vencedoras.map(v=>`${v.nome}${v.instagram?" @"+v.instagram:""}`).join(" | ");
        csv+=`${sr.titulo};${sr.premio||""};${sr.acaoNome};${new Date(sr.data).toLocaleString("pt-BR")};${venc};${sr.observacao||""}\n`;
      }
      csv+="\n";
    }
    if(evt.promoters?.length){
      csv+=`PROMOTERS\nNome;Email;Link;Categoria;Total Ingressos;Total Vendas (R$)\n`;
      for(const p of evt.promoters){
        const totalQtd=(p.vendas||[]).reduce((s,v)=>s+v.qtd,0);
        const totalVal=(p.vendas||[]).reduce((s,v)=>s+v.valor,0);
        csv+=`${p.nome};${p.email};${p.link};${p.categoria||""};${totalQtd};${totalVal.toFixed(2)}\n`;
      }
      csv+=`\nVENDAS DETALHADAS\nPromoter;Qtd Ingressos;Valor Unit.;Total;Observação;Data\n`;
      for(const p of evt.promoters){
        for(const v of (p.vendas||[])){
          csv+=`${p.nome};${v.qtd};${v.valor.toFixed(2)};${(v.qtd*v.valor).toFixed(2)};${v.obs||""};${new Date(v.data).toLocaleString("pt-BR")}\n`;
        }
      }
    }
    dl(csv, `relatorio_${tipo}_${evt.nome.replace(/\s/g,"_")}.csv`,"text/csv;charset=utf-8");
    show(`Relatório ${tipo} exportado!`);
  },[calcStats,generateReport,show]);

  const exportGeralCSV = useCallback(()=>{
    let csv="\uFEFF";
    csv+=`RELATÓRIO GERAL VSLT — ${new Date().toLocaleDateString("pt-BR")}\n\n`;
    for(const evt of data.eventos){
      const s=calcStats(evt);
      csv+=`══════════════════════════════════\n`;
      csv+=`EVENTO: ${evt.nome}${evt.dataEvento?" — "+evt.dataEvento:""}${evt.encerrado?" [ENCERRADO]":""}\n`;
      csv+=`Divulgadoras: ${evt.divulgadoras.length} | Ações: ${evt.acoes.length} | Média: ${s?s.avg.toFixed(1)+"%" : "—"}\n\n`;
      if(s&&evt.acoes.length){
        csv+=`RANKING DIVULGADORAS\nNome;Instagram;OKs;Total Ações;%;Entrou na Ação\n`;
        for(const r of s.ranking) csv+=`${r.nome};${r.instagram?"@"+r.instagram:""};${r.ok};${evt.acoes.length};${r.pct.toFixed(1)}%;Ação ${r.entradaAcao||"?"}\n`;
        csv+="\n";
      }
      if(evt.sorteios?.length){
        csv+=`SORTEIOS\nTítulo;Prêmio;Data;Vencedoras\n`;
        for(const sr of evt.sorteios){
          csv+=`${sr.titulo};${sr.premio||""};${new Date(sr.data).toLocaleString("pt-BR")};${sr.vencedoras.map(v=>v.nome).join(" | ")}\n`;
        }
        csv+="\n";
      }
      if(evt.promoters?.length){
        csv+=`PROMOTERS\nNome;Categoria;Total Ingressos;Total R$\n`;
        for(const p of evt.promoters){
          const tQ=(p.vendas||[]).reduce((s,v)=>s+v.qtd,0);
          const tV=(p.vendas||[]).reduce((s,v)=>s+v.valor,0);
          csv+=`${p.nome};${p.categoria||""};${tQ};${tV.toFixed(2)}\n`;
        }
        csv+="\n";
      }
      csv+="\n";
    }
    dl(csv,`relatorio_geral_vslt.csv`,"text/csv;charset=utf-8");
    show("Relatório geral exportado!");
  },[data,calcStats,show]);

  const exportJSON = useCallback(()=>{
    dl(JSON.stringify(data,null,2),`vslt_backup.json`,"application/json");
    show("Backup exportado!");
  },[data,show]);

  const importJSON = useCallback((e)=>{
    const file=e.target.files[0]; if(!file) return;
    const reader=new FileReader();
    reader.onload=(ev)=>{ try{ save({...defaultState,...JSON.parse(ev.target.result)}); setView(VIEWS.HOME); show("Dados restaurados!"); }catch{ show("Erro no arquivo","error"); } };
    reader.readAsText(file);
  },[save,show]);

  function dl(content, filename, type){
    const blob=new Blob([content],{type}); const url=URL.createObjectURL(blob);
    const a=document.createElement("a"); a.href=url; a.download=filename; a.click(); URL.revokeObjectURL(url);
  }

  if(loading) return(
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100vh",background:"#0a0a0f"}}>
      <div style={{fontSize:40,animation:"pulse 1.5s infinite"}}>🎯</div>
      <div style={{fontSize:11,letterSpacing:3,color:"#555",marginTop:12,textTransform:"uppercase"}}>Carregando...</div>
    </div>
  );

  const evtTabs=[
    {id:"dashboard",icon:"📊",label:"Dashboard"},
    {id:"importar",icon:"📥",label:"Importar Ação"},
    {id:"divulgadoras",icon:"👥",label:"Divulgadoras"},
    {id:"tabela",icon:"📋",label:"Tabela"},
    {id:"metas",icon:"🎯",label:"Metas"},
    {id:"promoters",icon:"🔗",label:"Promoters"},
    {id:"lista",icon:"🏆",label:"Lista Final"},
  ];

  const navItems=[
    {key:VIEWS.HOME,icon:"🏠",label:"Eventos"},
    {key:VIEWS.SORTEIO,icon:"🎲",label:"Sorteio"},
    {key:VIEWS.ESTATISTICAS,icon:"📈",label:"Estatísticas"},
    {key:VIEWS.RELATORIOS,icon:"📑",label:"Relatórios"},
    {key:VIEWS.LOGS,icon:"🕐",label:"Logs"},
  ];

  return(
    <div style={{minHeight:"100vh",background:"#0a0a0f",color:"#e0e0e0",fontFamily:"'DM Sans',sans-serif",display:"flex"}}>
      <style>{CSS}</style>
      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}

      {/* ══ SIDEBAR ══ */}
      <div style={{width:200,minHeight:"100vh",background:"#0d0d17",borderRight:"1px solid #1a1a28",display:"flex",flexDirection:"column",position:"fixed",top:0,left:0,bottom:0,zIndex:50}}>
        <div style={{padding:"20px 16px 16px",borderBottom:"1px solid #1a1a28"}}>
          <div style={{fontSize:9,letterSpacing:4,color:"#555",textTransform:"uppercase",marginBottom:3}}>VSLT Produções</div>
          <div style={{fontSize:14,fontWeight:800,background:"linear-gradient(135deg,#c8a2ff,#7a5af5)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>Divulgadoras v5</div>
        </div>
        <nav style={{flex:1,padding:"12px 8px",overflowY:"auto"}}>
          {navItems.map(item=>(
            <button key={item.key} className={`nav-item ${(view===item.key||(view===VIEWS.EVENTO&&item.key===VIEWS.HOME))?"nav-active":""}`}
              onClick={()=>{ if(item.key===VIEWS.HOME){save({...data,activeEventoId:null});setView(VIEWS.HOME);}else setView(item.key); }}>
              <span>{item.icon}</span><span>{item.label}</span>
            </button>
          ))}
          {data.eventos.length>0&&(
            <div style={{marginTop:12,paddingTop:12,borderTop:"1px solid #1a1a28"}}>
              <div style={{fontSize:9,color:"#444",letterSpacing:2,textTransform:"uppercase",padding:"0 8px",marginBottom:6}}>Eventos</div>
              {data.eventos.map(evt=>(
                <button key={evt.id} className={`nav-item ${data.activeEventoId===evt.id&&view===VIEWS.EVENTO?"nav-active":""}`}
                  onClick={()=>abrirEvento(evt.id)} style={{fontSize:11}}>
                  <span>{evt.encerrado?"🔒":"🟢"}</span>
                  <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:120}}>{evt.nome}</span>
                </button>
              ))}
            </div>
          )}
        </nav>
        <div style={{padding:"12px 8px",borderTop:"1px solid #1a1a28",display:"flex",gap:6}}>
          <button className="btn btn-ghost" onClick={exportJSON} style={{flex:1,padding:"6px",fontSize:10}}>💾</button>
          <label className="btn btn-ghost" style={{flex:1,padding:"6px",fontSize:10,cursor:"pointer",textAlign:"center"}}>
            📂<input type="file" accept=".json" onChange={importJSON} style={{display:"none"}}/>
          </label>
        </div>
      </div>

      {/* ══ MAIN ══ */}
      <div style={{marginLeft:200,flex:1,padding:"28px 32px"}}>

        {/* HOME */}
        {view===VIEWS.HOME&&(
          <div style={{animation:"fadeIn .3s"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24}}>
              <div>
                <div style={{fontSize:22,fontWeight:800}}>Eventos</div>
                <div style={{fontSize:12,color:"#555",marginTop:2}}>{data.eventos.length} evento{data.eventos.length!==1?"s":""}</div>
              </div>
              <button className="btn btn-accent" onClick={()=>setView(VIEWS.CRIAR_EVENTO)}>+ Novo Evento</button>
            </div>
            {data.eventos.length===0?(
              <div className="empty-state"><div style={{fontSize:48,marginBottom:12}}>🎪</div><div style={{fontSize:15,fontWeight:600}}>Nenhum evento cadastrado</div></div>
            ):(
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:16}}>
                {data.eventos.map(evt=>{
                  const s=calcStats(evt);
                  const totalIngressos=(evt.promoters||[]).reduce((sum,p)=>(p.vendas||[]).reduce((s2,v)=>s2+v.qtd,0)+sum,0);
                  return(
                    <div key={evt.id} className="card evt-card" onClick={()=>abrirEvento(evt.id)}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                        <div style={{fontSize:15,fontWeight:700,flex:1,marginRight:8}}>{evt.nome}</div>
                        <div style={{display:"flex",gap:6,alignItems:"center",flexShrink:0}}>
                          {evt.encerrado&&<span className="badge" style={{background:"#ff6b6b22",color:"#ff6b6b",fontSize:9}}>ENC.</span>}
                          <button className="btn btn-danger" style={{padding:"3px 8px",fontSize:10}} onClick={e=>{e.stopPropagation();deletarEvento(evt.id);}}>✕</button>
                        </div>
                      </div>
                      {evt.dataEvento&&<div style={{fontSize:11,color:"#555",marginBottom:8}}>📅 {evt.dataEvento}</div>}
                      <div style={{display:"flex",gap:12,flexWrap:"wrap",marginTop:8}}>
                        {[{n:evt.divulgadoras.length,l:"DIVULG.",c:"#c8a2ff"},{n:evt.acoes.length,l:"AÇÕES",c:"#7affc1"},{n:(evt.promoters||[]).length,l:"PROMO.",c:"#ffd97a"},{n:totalIngressos,l:"INGRESSOS",c:"#ff8a7a"}].map((st,i)=>(
                          <div key={i} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                            <span style={{fontFamily:"'Space Mono',monospace",fontSize:16,fontWeight:700,color:st.c}}>{st.n}</span>
                            <span style={{fontSize:9,color:"#555"}}>{st.l}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* CRIAR EVENTO */}
        {view===VIEWS.CRIAR_EVENTO&&(
          <div style={{animation:"fadeIn .3s",maxWidth:560}}>
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:24}}>
              <button className="btn btn-ghost" onClick={()=>setView(VIEWS.HOME)}>← Voltar</button>
              <span style={{fontSize:18,fontWeight:800}}>Novo Evento</span>
            </div>
            <div className="card" style={{marginBottom:14}}>
              <label className="field-label">Nome do Evento</label>
              <input value={novoEvtNome} onChange={e=>setNovoEvtNome(e.target.value)} placeholder="Ex: Never Ends 5 Anos"/>
            </div>
            <div className="card" style={{marginBottom:14}}>
              <label className="field-label">Data do Evento</label>
              <input value={novoEvtData} onChange={e=>setNovoEvtData(e.target.value)} placeholder="Ex: 15/03/2026"/>
            </div>
            <div className="card" style={{marginBottom:14}}>
              <label className="field-label">Metas de Divulgação</label>
              {novoEvtMetas.map((m,i)=>(
                <div key={i} style={{display:"flex",gap:8,marginBottom:8,alignItems:"center"}}>
                  <input value={m.label} onChange={e=>{const c=[...novoEvtMetas];c[i].label=e.target.value;setNovoEvtMetas(c);}} placeholder="Ex: Ouro" style={{flex:1}}/>
                  <input value={m.percentual} onChange={e=>{const c=[...novoEvtMetas];c[i].percentual=e.target.value;setNovoEvtMetas(c);}} placeholder="%" style={{width:70,textAlign:"center"}} type="number" min="0" max="100"/>
                  <span style={{color:"#666",fontSize:12}}>%</span>
                  {novoEvtMetas.length>1&&<button className="btn btn-danger" style={{padding:"4px 8px",fontSize:10}} onClick={()=>setNovoEvtMetas(novoEvtMetas.filter((_,j)=>j!==i))}>✕</button>}
                </div>
              ))}
              <button className="btn btn-ghost" style={{fontSize:11,marginTop:4}} onClick={()=>setNovoEvtMetas([...novoEvtMetas,{label:"",percentual:""}])}>+ Adicionar faixa</button>
            </div>
            <button className="btn btn-accent" style={{width:"100%",padding:14,fontSize:14}} onClick={criarEvento}>Criar Evento</button>
          </div>
        )}

        {/* EVENTO */}
        {view===VIEWS.EVENTO&&activeEvento&&(
          <div style={{animation:"fadeIn .3s"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
              <div>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <span style={{fontSize:20,fontWeight:800}}>{activeEvento.nome}</span>
                  {activeEvento.encerrado&&<span className="badge" style={{background:"#ff6b6b22",color:"#ff6b6b",fontSize:9}}>ENCERRADO</span>}
                  <button className="btn btn-ghost" style={{padding:"3px 10px",fontSize:10}} onClick={()=>{setEditEvtNome(activeEvento.nome);setEditEvtData(activeEvento.dataEvento||"");setShowEditEvt(true);}}>✏️ Editar</button>
                </div>
                <div style={{fontSize:11,color:"#666",marginTop:2}}>
                  {activeEvento.dataEvento&&`📅 ${activeEvento.dataEvento} • `}
                  {activeEvento.divulgadoras.length} divulg. • {activeEvento.acoes.length} ações • {(activeEvento.promoters||[]).length} promoters
                </div>
              </div>
              <div style={{display:"flex",gap:8}}>
                {activeEvento.encerrado
                  ?<button className="btn btn-ghost" style={{fontSize:11}} onClick={reabrirEvento}>🔓 Reabrir</button>
                  :<button className="btn btn-danger" style={{fontSize:11}} onClick={()=>setShowEncerrar(true)}>🔒 Encerrar</button>}
                <button className="btn btn-accent" style={{fontSize:11}} onClick={()=>setShowExport(true)}>📤 Exportar</button>
              </div>
            </div>
            <div style={{display:"flex",borderBottom:"1px solid #1a1a28",marginBottom:24,overflowX:"auto"}}>
              {evtTabs.map(t=>(
                <button key={t.id} className={`tab ${evtTab===t.id?"active":""}`} onClick={()=>setEvtTab(t.id)}>{t.icon} {t.label}</button>
              ))}
            </div>
            <div style={{maxWidth:1100}}>

              {/* ── DASHBOARD ── */}
              {evtTab==="dashboard"&&(
                <>
                  {activeEvento.encerrado&&(
                    <div style={{background:"#ff6b6b11",border:"1px solid #ff6b6b33",borderRadius:10,padding:"10px 16px",marginBottom:16,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                      <span style={{fontSize:12,color:"#ff8a7a"}}>🔒 Encerrado — % sobre {activeEvento.acoes.length} ações totais</span>
                      <button className="btn btn-ghost" style={{fontSize:10}} onClick={reabrirEvento}>Reabrir</button>
                    </div>
                  )}
                  {!stats||!activeEvento.acoes.length?(
                    <div className="empty-state"><div style={{fontSize:48}}>📊</div><div style={{fontSize:15,fontWeight:600,marginTop:8}}>Nenhuma ação registrada</div></div>
                  ):(
                    <>
                      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:20}}>
                        {[{n:activeEvento.divulgadoras.length,l:"Divulgadoras",c:"#c8a2ff"},{n:activeEvento.acoes.length,l:"Ações",c:"#7affc1"},{n:stats.topCount,l:"100% Presença",c:"#ffd97a"},{n:`${stats.avg.toFixed(0)}%`,l:"Média Geral",c:"#ff8a7a"}].map((s,i)=>(
                          <div key={i} className="stat-card"><div className="stat-num" style={{color:s.c}}>{s.n}</div><div className="stat-label">{s.l}</div></div>
                        ))}
                      </div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
                        <div className="card">
                          <div className="section-title" style={{marginBottom:12}}>🏆 Top 15</div>
                          {stats.ranking.slice(0,15).map((r,i)=>(
                            <div className="rank-row" key={r.id}>
                              <div className="rank-pos" style={{color:i<3?["#ffd97a","#b0b0b0","#d4956a"][i]:"#444"}}>{i<3?["🥇","🥈","🥉"][i]:`${i+1}°`}</div>
                              <div style={{flex:1}}><div style={{fontSize:12,fontWeight:500}}>{r.nome}</div>{r.instagram&&<div style={{color:"#c8a2ff",fontSize:10}}>@{r.instagram}</div>}</div>
                              <div><span style={{fontFamily:"'Space Mono',monospace",fontSize:12,fontWeight:700,color:r.pct===100?"#7affc1":r.pct>=75?"#ffd97a":"#ff8a7a"}}>{r.pct.toFixed(0)}%</span><span style={{fontSize:9,color:"#555",marginLeft:4}}>{r.ok}/{activeEvento.acoes.length}</span></div>
                            </div>
                          ))}
                        </div>
                        <div className="card">
                          <div className="section-title" style={{marginBottom:12}}>📈 Participação por Ação</div>
                          {stats.acaoStats.map(a=>(
                            <div key={a.id} style={{marginBottom:10}}>
                              <div style={{display:"flex",justifyContent:"space-between",fontSize:11,marginBottom:3}}>
                                <span style={{fontWeight:500}}>Ação {a.numero}</span>
                                <span style={{color:"#888",fontFamily:"'Space Mono',monospace"}}>{a.ok}/{a.total}</span>
                              </div>
                              <div className="prog-bar"><div className="prog-fill" style={{width:`${a.total?((a.ok/a.total)*100):0}%`}}/></div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </>
              )}

              {/* ── IMPORTAR ── */}
              {evtTab==="importar"&&(
                <div style={{maxWidth:650}}>
                  {!activeEvento.encerrado&&!editingAcaoId&&(
                    <div className="card" style={{marginBottom:16}}>
                      <div className="section-title" style={{marginBottom:12}}>📥 Importar Nova Ação</div>
                      <div style={{background:"#0a0a16",border:"1px solid #1a1a2e",borderRadius:8,padding:"9px 12px",marginBottom:14,fontSize:11,color:"#666",lineHeight:1.7}}>
                        <strong style={{color:"#c8a2ff"}}>Parser inteligente:</strong> todo <strong style={{color:"#7affc1"}}>@</strong> é Instagram • antes da <strong style={{color:"#7affc1"}}>/</strong> é o nome
                      </div>
                      <div style={{display:"flex",gap:8,marginBottom:12}}>
                        <div style={{flex:"0 0 100px"}}>
                          <label style={{fontSize:10,color:"#666",marginBottom:4,display:"block"}}>Nº da Ação</label>
                          <input value={acaoNumero} onChange={e=>setAcaoNumero(e.target.value)} placeholder={`${activeEvento.acoes.length+1}`} type="number" min="1"/>
                        </div>
                        <div style={{flex:1}}>
                          <label style={{fontSize:10,color:"#666",marginBottom:4,display:"block"}}>Nome (opcional)</label>
                          <input value={acaoNome} onChange={e=>setAcaoNome(e.target.value)} placeholder={`Ação ${acaoNumero||activeEvento.acoes.length+1}`}/>
                        </div>
                      </div>
                      <label style={{fontSize:10,color:"#666",marginBottom:4,display:"block"}}>Lista de participantes</label>
                      <textarea value={acaoTexto} onChange={e=>setAcaoTexto(e.target.value)} placeholder={"Cole a lista:\n1- Nome / @instagram\n2- Nome / @instagram"} style={{minHeight:160,fontFamily:"'Space Mono',monospace",fontSize:11}}/>
                      <div style={{display:"flex",justifyContent:"flex-end",marginTop:12}}>
                        <button className="btn btn-accent" onClick={processarAcao}>Processar Ação</button>
                      </div>
                    </div>
                  )}
                  {activeEvento.encerrado&&!editingAcaoId&&(
                    <div className="card" style={{marginBottom:16,textAlign:"center",padding:30}}>
                      <div style={{fontSize:13,color:"#ff6b6b",marginBottom:4}}>🔒 Evento encerrado</div>
                      <div style={{fontSize:11,color:"#666"}}>Você ainda pode editar ações existentes abaixo.</div>
                    </div>
                  )}
                  {editingAcaoId&&(()=>{
                    const ea=activeEvento.acoes.find(a=>a.id===editingAcaoId);
                    return(
                      <div className="card" style={{marginBottom:16,border:"1px solid #ffd97a44"}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                          <div className="section-title" style={{color:"#ffd97a"}}>✏️ Editando Ação {ea?.numero}</div>
                          <button className="btn btn-ghost" style={{fontSize:11}} onClick={()=>{setEditingAcaoId(null);setEditAcaoTexto("");}}>Cancelar</button>
                        </div>
                        <textarea value={editAcaoTexto} onChange={e=>setEditAcaoTexto(e.target.value)} placeholder={"Nova lista:\n1- Nome / @instagram"} style={{minHeight:160,fontFamily:"'Space Mono',monospace",fontSize:11}}/>
                        <div style={{display:"flex",justifyContent:"flex-end",marginTop:12}}>
                          <button className="btn btn-accent" onClick={resubmitAcao}>Reprocessar</button>
                        </div>
                      </div>
                    );
                  })()}
                  {activeEvento.acoes.length>0&&(
                    <div className="card">
                      <div style={{fontSize:12,fontWeight:600,color:"#888",marginBottom:12}}>Ações Registradas</div>
                      {[...activeEvento.acoes].reverse().map(a=>{
                        const s=stats?.acaoStats.find(x=>x.id===a.id);
                        return(
                          <div key={a.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 0",borderBottom:"1px solid #111"}}>
                            <div style={{display:"flex",alignItems:"center",gap:10}}>
                              <span style={{fontFamily:"'Space Mono',monospace",fontWeight:700,color:"#c8a2ff",width:40}}>#{a.numero}</span>
                              <span style={{fontSize:12}}>{a.nome}</span>
                            </div>
                            <div style={{display:"flex",alignItems:"center",gap:6}}>
                              <span style={{fontSize:11,color:"#888"}}>{s?.ok||0}/{s?.total||0}</span>
                              <button className="btn btn-ghost" style={{padding:"3px 8px",fontSize:10,color:"#ffd97a",borderColor:"#ffd97a44"}} onClick={()=>limparAcao(a.id)}>✏️</button>
                              {!activeEvento.encerrado&&<button className="btn btn-danger" style={{padding:"3px 8px",fontSize:10}} onClick={()=>removerAcao(a.id)}>✕</button>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* ── DIVULGADORAS ── */}
              {evtTab==="divulgadoras"&&(
                <div className="card">
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:16}}>
                    <div className="section-title">👥 Divulgadoras ({activeEvento.divulgadoras.length})</div>
                    <input value={searchTerm} onChange={e=>setSearchTerm(e.target.value)} placeholder="Buscar..." style={{width:200,padding:"6px 12px",fontSize:12}}/>
                  </div>
                  {activeEvento.divulgadoras.length===0?(
                    <div style={{textAlign:"center",padding:40,color:"#444"}}>Importe uma ação para cadastrar</div>
                  ):(
                    <div style={{maxHeight:500,overflowY:"auto"}}>
                      {activeEvento.divulgadoras.filter(d=>{
                        if(!searchTerm)return true;
                        const s=searchTerm.toLowerCase();
                        return d.nome.toLowerCase().includes(s)||(d.instagram||"").toLowerCase().includes(s);
                      }).map(d=>{
                        const r=stats?.ranking.find(x=>x.id===d.id);
                        return(
                          <div key={d.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 0",borderBottom:"1px solid #1a1a28"}}>
                            <div style={{flex:1}}>
                              <span style={{fontWeight:500,fontSize:12}}>{d.nome}</span>
                              {d.instagram&&<span style={{color:"#c8a2ff",fontSize:10,marginLeft:8}}>@{d.instagram}</span>}
                              {d.entradaAcao&&<span style={{color:"#555",fontSize:9,marginLeft:8}}>entrou ação {d.entradaAcao}</span>}
                            </div>
                            <div style={{display:"flex",alignItems:"center",gap:8}}>
                              {r&&<span style={{fontFamily:"'Space Mono',monospace",fontSize:11,color:r.pct===100?"#7affc1":r.pct>=75?"#ffd97a":"#ff8a7a"}}>{r.ok}/{activeEvento.acoes.length} ({r.pct.toFixed(0)}%)</span>}
                              <button className="btn btn-danger" style={{padding:"3px 8px",fontSize:10}} onClick={()=>removerDiv(d.id)}>✕</button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* ── TABELA ── */}
              {evtTab==="tabela"&&(
                !stats||!activeEvento.acoes.length?(
                  <div className="empty-state"><div style={{fontSize:48}}>📋</div><div style={{fontSize:15,fontWeight:600,marginTop:8}}>Tabela vazia</div></div>
                ):(
                  <div className="table-wrap">
                    <table>
                      <thead><tr>
                        <th style={{position:"sticky",left:0,zIndex:3,background:"#12121a",minWidth:150}}>Nome</th>
                        <th style={{minWidth:90}}>Instagram</th>
                        <th style={{minWidth:60}}>Entrada</th>
                        {activeEvento.acoes.map(a=><th key={a.id} style={{textAlign:"center",minWidth:44}}>A{a.numero}</th>)}
                        <th style={{textAlign:"center",minWidth:44}}>OK</th>
                        <th style={{textAlign:"center",minWidth:44}}>%</th>
                      </tr></thead>
                      <tbody>
                        {stats.ranking.map(r=>(
                          <tr key={r.id}>
                            <td style={{fontWeight:500,fontSize:11,position:"sticky",left:0,background:"#0a0a0f"}}>{r.nome}</td>
                            <td style={{color:"#c8a2ff",fontSize:10}}>{r.instagram?`@${r.instagram}`:""}</td>
                            <td style={{fontSize:9,color:"#666"}}>Ação {r.entradaAcao||"?"}</td>
                            {activeEvento.acoes.map(a=>{const v=activeEvento.marcacoes[`${r.id}_${a.id}`]; return<td key={a.id} className={v==="OK"?"cell-ok":"cell-x"}>{v||"-"}</td>;})}
                            <td style={{textAlign:"center",fontFamily:"'Space Mono',monospace",fontWeight:700,color:"#7affc1"}}>{r.ok}</td>
                            <td style={{textAlign:"center",fontFamily:"'Space Mono',monospace",fontWeight:700,color:r.pct===100?"#7affc1":r.pct>=75?"#ffd97a":"#ff8a7a"}}>{r.pct.toFixed(0)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              )}

              {/* ── METAS ── */}
              {evtTab==="metas"&&(
                <div style={{maxWidth:550}}>
                  <div className="card">
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
                      <div className="section-title">🎯 Metas de Divulgação</div>
                      {!editingMetas&&<button className="btn btn-ghost" style={{fontSize:11}} onClick={()=>{setTempMetas([...(activeEvento.metas||[]),{label:"",percentual:""}]);setEditingMetas(true);}}>✏️ Editar</button>}
                    </div>
                    {editingMetas?(
                      <>
                        {tempMetas.map((m,i)=>(
                          <div key={i} style={{display:"flex",gap:8,marginBottom:8,alignItems:"center"}}>
                            <input value={m.label} onChange={e=>{const c=[...tempMetas];c[i].label=e.target.value;setTempMetas(c);}} placeholder="Nome da faixa" style={{flex:1}}/>
                            <input value={m.percentual} onChange={e=>{const c=[...tempMetas];c[i].percentual=e.target.value;setTempMetas(c);}} placeholder="%" style={{width:70,textAlign:"center"}} type="number"/>
                            {tempMetas.length>1&&<button className="btn btn-danger" style={{padding:"3px 6px",fontSize:10}} onClick={()=>setTempMetas(tempMetas.filter((_,j)=>j!==i))}>✕</button>}
                          </div>
                        ))}
                        <button className="btn btn-ghost" style={{fontSize:11,marginBottom:12}} onClick={()=>setTempMetas([...tempMetas,{label:"",percentual:""}])}>+ Adicionar</button>
                        <div style={{display:"flex",gap:8}}>
                          <button className="btn btn-accent" onClick={()=>{
                            const metas=tempMetas.filter(m=>m.label.trim()&&m.percentual).map(m=>({label:m.label.trim(),percentual:parseFloat(m.percentual)}));
                            updateEvento({...activeEvento,metas},"Metas atualizadas"); setEditingMetas(false); show("Metas atualizadas!");
                          }}>Salvar</button>
                          <button className="btn btn-ghost" onClick={()=>setEditingMetas(false)}>Cancelar</button>
                        </div>
                      </>
                    ):(
                      !activeEvento.metas?.length?(
                        <div style={{color:"#555",fontSize:12}}>Nenhuma meta definida. Clique em Editar.</div>
                      ):(
                        activeEvento.metas.sort((a,b)=>b.percentual-a.percentual).map((m,i)=>{
                          const qualified=stats?.ranking.filter(r=>r.pct>=m.percentual)||[];
                          return(
                            <div key={i} style={{padding:"12px 0",borderBottom:"1px solid #1a1a28"}}>
                              <div style={{display:"flex",justifyContent:"space-between"}}>
                                <span style={{fontSize:13,fontWeight:600}}>{m.label}</span>
                                <span style={{fontFamily:"'Space Mono',monospace",fontSize:12,color:"#c8a2ff"}}>≥ {m.percentual}%</span>
                              </div>
                              <div style={{fontSize:11,color:"#7affc1",marginTop:4}}>{qualified.length} classificada{qualified.length!==1?"s":""}</div>
                            </div>
                          );
                        })
                      )
                    )}
                  </div>
                </div>
              )}

              {/* ── PROMOTERS ── */}
              {evtTab==="promoters"&&(()=>{
                const promoters = activeEvento.promoters||[];
                const condicoes = activeEvento.condicoes||{};
                return(
                  <div>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
                      <div style={{fontSize:16,fontWeight:800}}>🔗 Promoters</div>
                      <div style={{display:"flex",gap:8}}>
                        <button className="btn btn-ghost" style={{fontSize:11}} onClick={()=>{setCondicoesCat(CATS[0]);setCondicoesTexto(condicoes[CATS[0]]||"");setCondicoesModal(true);}}>📋 Condições de Venda</button>
                        <button className="btn btn-accent" onClick={()=>{setEditingPromoter(null);setPNome("");setPEmail("");setPLink("");setPCategoria("Promoter");setPromoterModal(true);}}>+ Novo Promoter</button>
                      </div>
                    </div>
                    {promoters.length===0?(
                      <div className="empty-state"><div style={{fontSize:40,marginBottom:8}}>🔗</div><div>Nenhum promoter cadastrado</div></div>
                    ):(
                      <div style={{display:"grid",gap:14}}>
                        {promoters.map(p=>{
                          const totalQtd=(p.vendas||[]).reduce((s,v)=>s+v.qtd,0);
                          const totalVal=(p.vendas||[]).reduce((s,v)=>s+(v.qtd*v.valor),0);
                          const cond=condicoes[p.categoria]||"";
                          return(
                            <div key={p.id} className="card" style={{padding:"16px 18px"}}>
                              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
                                <div>
                                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:3}}>
                                    <span style={{fontWeight:700,fontSize:14}}>{p.nome}</span>
                                    <span className="badge" style={{background:"#c8a2ff22",color:"#c8a2ff"}}>{p.categoria}</span>
                                  </div>
                                  <div style={{fontSize:11,color:"#666"}}>{p.email}</div>
                                  <div style={{fontSize:11,color:"#7a5af5",marginTop:2,wordBreak:"break-all"}}>{p.link}</div>
                                  {cond&&<div style={{fontSize:10,color:"#ffd97a",marginTop:4,background:"#ffd97a11",borderRadius:4,padding:"3px 8px",display:"inline-block"}}>📋 {cond.substring(0,60)}{cond.length>60?"...":""}</div>}
                                </div>
                                <div style={{display:"flex",gap:6,flexShrink:0}}>
                                  <button className="btn btn-ghost" style={{padding:"4px 10px",fontSize:10}} onClick={()=>editarPromoter(p)}>✏️</button>
                                  <button className="btn btn-accent" style={{padding:"4px 10px",fontSize:10}} onClick={()=>{setVendaModal(p.id);setEditingVenda(null);setVQtd(1);setVValor("");setVComprovante("");setVObs("");}}>+ Venda</button>
                                  <button className="btn btn-danger" style={{padding:"4px 8px",fontSize:10}} onClick={()=>removerPromoter(p.id)}>✕</button>
                                </div>
                              </div>
                              <div style={{display:"flex",gap:16,marginBottom:(p.vendas||[]).length>0?12:0}}>
                                <div style={{textAlign:"center"}}>
                                  <div style={{fontFamily:"'Space Mono',monospace",fontSize:20,fontWeight:700,color:"#7affc1"}}>{totalQtd}</div>
                                  <div style={{fontSize:9,color:"#555",textTransform:"uppercase",letterSpacing:1}}>Ingressos</div>
                                </div>
                                <div style={{textAlign:"center"}}>
                                  <div style={{fontFamily:"'Space Mono',monospace",fontSize:16,fontWeight:700,color:"#ffd97a"}}>{fmtCur(totalVal)}</div>
                                  <div style={{fontSize:9,color:"#555",textTransform:"uppercase",letterSpacing:1}}>Total Vendas</div>
                                </div>
                              </div>
                              {(p.vendas||[]).length>0&&(
                                <div style={{borderTop:"1px solid #1a1a28",paddingTop:10}}>
                                  <div style={{fontSize:10,color:"#888",textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>Vendas registradas</div>
                                  {p.vendas.map((v,vi)=>(
                                    <div key={v.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 0",borderBottom:"1px solid #111",fontSize:11}}>
                                      <div>
                                        <span style={{fontWeight:600,color:"#7affc1"}}>{v.qtd}x</span>
                                        <span style={{color:"#ffd97a",marginLeft:8}}>{fmtCur(v.valor)}/un</span>
                                        <span style={{color:"#888",marginLeft:8}}>= {fmtCur(v.qtd*v.valor)}</span>
                                        {v.obs&&<span style={{color:"#666",marginLeft:8,fontStyle:"italic"}}>{v.obs}</span>}
                                        {v.comprovante&&<span style={{color:"#c8a2ff",marginLeft:8,fontSize:10}}>📎 comprov.</span>}
                                      </div>
                                      <div style={{display:"flex",gap:4,alignItems:"center"}}>
                                        <span style={{fontSize:9,color:"#444"}}>{new Date(v.data).toLocaleDateString("pt-BR")}</span>
                                        <button className="btn btn-ghost" style={{padding:"2px 7px",fontSize:10,color:"#ffd97a",borderColor:"#ffd97a33"}} onClick={()=>editarVenda(p.id,v)}>✏️</button>
                                        <button className="btn btn-danger" style={{padding:"2px 6px",fontSize:10}} onClick={()=>removerVenda(p.id,v.id)}>✕</button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* ── LISTA FINAL ── */}
              {evtTab==="lista"&&(()=>{
                const report=generateReport(activeEvento);
                const sorteios=activeEvento.sorteios||[];
                const promoters=activeEvento.promoters||[];
                return(
                  <div>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
                      <div style={{fontSize:16,fontWeight:800}}>🏆 Lista Final — {activeEvento.nome}</div>
                      <button className="btn btn-accent" style={{fontSize:11}} onClick={()=>exportCSV(activeEvento,activeEvento.encerrado?"final":"parcial")}>
                        ⬇ Exportar {activeEvento.encerrado?"Final":"Parcial"}
                      </button>
                    </div>
                    {!activeEvento.metas?.length?(
                      <div className="card" style={{textAlign:"center",padding:32,color:"#555"}}>Defina metas na aba "Metas" primeiro</div>
                    ):(
                      report.map((r,i)=>(
                        <div key={i} className="card" style={{marginBottom:14}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,paddingBottom:10,borderBottom:"1px solid #1a1a28"}}>
                            <span style={{fontWeight:700,fontSize:14}}>{r.meta.label}</span>
                            <span style={{fontFamily:"'Space Mono',monospace",color:"#c8a2ff",fontSize:12}}>≥ {r.meta.percentual}% — {r.qualified.length} classificadas</span>
                          </div>
                          {r.qualified.length===0?(
                            <div style={{color:"#555",fontSize:11,marginBottom:10}}>Nenhuma atingiu esta meta</div>
                          ):(
                            <div style={{marginBottom:12}}>
                              <div style={{fontSize:10,color:"#7affc1",textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>✅ Classificadas ({r.qualified.length})</div>
                              {r.qualified.map(q=>(
                                <div key={q.id} style={{display:"flex",justifyContent:"space-between",padding:"5px 8px",fontSize:11,borderBottom:"1px solid #111"}}>
                                  <div>
                                    <span style={{fontWeight:600}}>{q.nome}</span>
                                    {q.instagram&&<span style={{color:"#c8a2ff",marginLeft:6}}>@{q.instagram}</span>}
                                    <span style={{color:"#555",marginLeft:8,fontSize:9}}>entrou ação {q.entradaAcao||"?"}</span>
                                  </div>
                                  <div style={{display:"flex",gap:10,color:"#888"}}>
                                    <span>{q.ok}/{activeEvento.acoes.length}</span>
                                    <span style={{fontWeight:700,color:"#7affc1",fontFamily:"'Space Mono',monospace"}}>{q.pct.toFixed(0)}%</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                          {r.notQualified.length>0&&(
                            <details>
                              <summary style={{fontSize:10,color:"#ff8a7a",textTransform:"uppercase",letterSpacing:1,cursor:"pointer",userSelect:"none",marginBottom:6}}>❌ Não classificadas ({r.notQualified.length})</summary>
                              {r.notQualified.map(q=>(
                                <div key={q.id} style={{display:"flex",justifyContent:"space-between",padding:"4px 8px",fontSize:11,borderBottom:"1px solid #0d0d15"}}>
                                  <span style={{color:"#888"}}>{q.nome}{q.instagram&&<span style={{color:"#c8a2ff55",marginLeft:6,fontSize:10}}>@{q.instagram}</span>}</span>
                                  <span style={{fontFamily:"'Space Mono',monospace",fontSize:11,color:"#ff8a7a"}}>{q.pct.toFixed(0)}%</span>
                                </div>
                              ))}
                            </details>
                          )}
                        </div>
                      ))
                    )}
                    {sorteios.length>0&&(
                      <div className="card" style={{marginBottom:14}}>
                        <div style={{fontSize:13,fontWeight:700,marginBottom:14,paddingBottom:10,borderBottom:"1px solid #1a1a28"}}>🎲 Sorteios</div>
                        {sorteios.map(s=>(
                          <div key={s.id} style={{padding:"10px 0",borderBottom:"1px solid #111"}}>
                            <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                              <div><span style={{fontWeight:700,color:"#ffd97a"}}>{s.titulo}</span><span style={{fontSize:10,color:"#666",marginLeft:10}}>{s.acaoNome}</span></div>
                              <span style={{fontSize:9,color:"#555"}}>{new Date(s.data).toLocaleString("pt-BR")}</span>
                            </div>
                            {s.premio&&<div style={{fontSize:11,color:"#7affc1",marginBottom:4}}>🎁 {s.premio}</div>}
                            {s.observacao&&<div style={{fontSize:11,color:"#888",marginBottom:4,fontStyle:"italic"}}>{s.observacao}</div>}
                            {s.vencedoras.map((v,i)=>(
                              <div key={i} style={{fontSize:12,paddingLeft:8,marginTop:3}}>
                                <span style={{color:"#ffd97a",fontWeight:700,marginRight:8}}>{i+1}°</span>
                                {v.nome} {v.instagram&&<span style={{color:"#c8a2ff",fontSize:10}}>@{v.instagram}</span>}
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                    {promoters.length>0&&(
                      <div className="card">
                        <div style={{fontSize:13,fontWeight:700,marginBottom:14,paddingBottom:10,borderBottom:"1px solid #1a1a28"}}>🔗 Promoters — Resumo de Vendas</div>
                        <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                          <thead><tr>
                            {["Nome","Categoria","Ingressos","Total R$","Link"].map((h,i)=>(
                              <th key={i} style={{padding:"6px 10px",textAlign:"left",color:"#666",fontSize:9,textTransform:"uppercase",borderBottom:"1px solid #1a1a28"}}>{h}</th>
                            ))}
                          </tr></thead>
                          <tbody>
                            {promoters.map(p=>{
                              const tQ=(p.vendas||[]).reduce((s,v)=>s+v.qtd,0);
                              const tV=(p.vendas||[]).reduce((s,v)=>s+(v.qtd*v.valor),0);
                              return(
                                <tr key={p.id}>
                                  <td style={{padding:"6px 10px",fontWeight:600}}>{p.nome}</td>
                                  <td style={{padding:"6px 10px"}}><span className="badge" style={{background:"#c8a2ff22",color:"#c8a2ff"}}>{p.categoria}</span></td>
                                  <td style={{padding:"6px 10px",color:"#7affc1",fontFamily:"'Space Mono',monospace",fontWeight:700}}>{tQ}</td>
                                  <td style={{padding:"6px 10px",color:"#ffd97a",fontFamily:"'Space Mono',monospace"}}>{fmtCur(tV)}</td>
                                  <td style={{padding:"6px 10px",color:"#7a5af5",fontSize:10,maxWidth:120,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.link}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* ══ SORTEIO GLOBAL ══ */}
        {view===VIEWS.SORTEIO&&(
          <div style={{animation:"fadeIn .3s"}}>
            <div style={{fontSize:22,fontWeight:800,marginBottom:4}}>🎲 Sorteio</div>
            <div style={{fontSize:12,color:"#555",marginBottom:24}}>Selecione o evento e a ação base</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:24,maxWidth:900}}>
              <div>
                <div className="card">
                  <div className="section-title" style={{marginBottom:14}}>⚙️ Configuração</div>
                  <div style={{marginBottom:10}}>
                    <label style={{fontSize:10,color:"#666",marginBottom:4,display:"block"}}>Evento *</label>
                    <select value={sorteioEventoId} onChange={e=>{setSorteioEventoId(e.target.value);setSorteioAcao("");setSorteioResult(null);}} style={{background:"#0a0a12",border:"1px solid #1e1e2e",borderRadius:8,padding:"10px 14px",color:"#e0e0e0",fontSize:13,width:"100%"}}>
                      <option value="">Selecione o evento...</option>
                      {data.eventos.map(e=><option key={e.id} value={e.id}>{e.nome}{e.encerrado?" (encerrado)":""}</option>)}
                    </select>
                  </div>
                  {sorteioEvento&&sorteioEvento.acoes.length>0&&(
                    <div style={{marginBottom:10}}>
                      <label style={{fontSize:10,color:"#666",marginBottom:4,display:"block"}}>Ação base *</label>
                      <select value={sorteioAcao} onChange={e=>{setSorteioAcao(e.target.value);setSorteioResult(null);}} style={{background:"#0a0a12",border:"1px solid #1e1e2e",borderRadius:8,padding:"10px 14px",color:"#e0e0e0",fontSize:13,width:"100%"}}>
                        <option value="">Selecione a ação...</option>
                        {sorteioEvento.acoes.map(a=><option key={a.id} value={a.id}>Ação {a.numero}{a.nome!==`Ação ${a.numero}`?` — ${a.nome}`:""}</option>)}
                      </select>
                    </div>
                  )}
                  {sorteioAcao&&<div style={{fontSize:11,color:"#888",marginBottom:10,padding:"6px 10px",background:"#0a0a16",borderRadius:6}}>{participantesDaAcaoSorteio.length} participante(s) disponíveis</div>}
                  <div style={{marginBottom:10}}>
                    <label style={{fontSize:10,color:"#666",marginBottom:4,display:"block"}}>Título do Sorteio *</label>
                    <input value={sorteioTitulo} onChange={e=>setSorteioTitulo(e.target.value)} placeholder="Ex: Sorteio #1 — Ingresso VIP"/>
                  </div>
                  <div style={{marginBottom:10}}>
                    <label style={{fontSize:10,color:"#666",marginBottom:4,display:"block"}}>🎁 O que o ganhador irá ganhar *</label>
                    <input value={sортeioPremio} onChange={e=>setSorteioPremio(e.target.value)} placeholder="Ex: 2 ingressos VIP + open bar"/>
                  </div>
                  <div style={{marginBottom:10}}>
                    <label style={{fontSize:10,color:"#666",marginBottom:4,display:"block"}}>Observação (opcional)</label>
                    <input value={sorteioObs} onChange={e=>setSorteioObs(e.target.value)} placeholder="Ex: Retirar na entrada até 22h"/>
                  </div>
                  <div style={{marginBottom:14}}>
                    <label style={{fontSize:10,color:"#666",marginBottom:4,display:"block"}}>Quantidade de vencedoras</label>
                    <input type="number" min="1" value={sorteioQtd} onChange={e=>setSorteioQtd(e.target.value)} style={{textAlign:"center"}}/>
                  </div>
                  <button className="btn btn-accent" style={{width:"100%",padding:14,fontSize:14}} onClick={realizarSorteio} disabled={sorteioAnimating||!sorteioAcao||!sorteioTitulo.trim()}>
                    {sorteioAnimating?"🎲 Sorteando...":"🎲 Realizar Sorteio"}
                  </button>
                </div>
              </div>
              <div>
                <div className="card" style={{minHeight:220}}>
                  {sorteioAnimating&&(
                    <div style={{textAlign:"center",padding:"16px 0"}}>
                      <div style={{fontSize:76,lineHeight:1,display:"inline-block",animation:"diceSpin .18s linear infinite"}}>{diceFace}</div>
                      <div style={{fontSize:10,color:"#888",textTransform:"uppercase",letterSpacing:2,marginTop:10,marginBottom:6}}>Sorteando...</div>
                      <div style={{fontSize:17,fontWeight:700,color:"#ffd97a",fontFamily:"'Space Mono',monospace",animation:"pulse .3s infinite"}}>{sorteioAnimName}</div>
                    </div>
                  )}
                  {!sorteioAnimating&&!sorteioResult&&(
                    <div className="empty-state" style={{padding:"36px 20px"}}><div style={{fontSize:48,marginBottom:8}}>🎰</div><div style={{fontSize:12,color:"#444"}}>Configure e clique em Realizar Sorteio</div></div>
                  )}
                  {sorteioResult&&!sorteioAnimating&&(
                    <div>
                      <div style={{fontSize:11,color:"#7affc1",textTransform:"uppercase",letterSpacing:2,marginBottom:14,textAlign:"center"}}>🎉 {sorteioResult.length>1?"Vencedoras":"Vencedora"}</div>
                      {sorteioResult.map((w,i)=>(
                        <div key={w.id} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 0",borderBottom:i<sorteioResult.length-1?"1px solid #1a1a28":"none"}}>
                          <div style={{fontFamily:"'Space Mono',monospace",fontSize:18,fontWeight:700,color:"#ffd97a",width:34,textAlign:"center"}}>{i+1}°</div>
                          <div><div style={{fontSize:15,fontWeight:700}}>{w.nome}</div>{w.instagram&&<div style={{color:"#c8a2ff",fontSize:12}}>@{w.instagram}</div>}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
            {data.eventos.some(e=>e.sorteios?.length>0)&&(
              <div className="card" style={{maxWidth:900,marginTop:16}}>
                <div className="section-title" style={{marginBottom:14}}>📜 Histórico de Sorteios</div>
                {data.eventos.flatMap(e=>(e.sorteios||[]).map(s=>({...s,evtNome:e.nome,evtId:e.id}))).sort((a,b)=>new Date(b.data)-new Date(a.data)).map(s=>(
                  <div key={s.id} style={{padding:"12px 0",borderBottom:"1px solid #1a1a28"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:4}}>
                      <div><span style={{fontWeight:700,color:"#ffd97a"}}>{s.titulo}</span><span style={{fontSize:10,color:"#888",marginLeft:10}}>{s.evtNome} · {s.acaoNome}</span></div>
                      <div style={{display:"flex",gap:8,alignItems:"center"}}>
                        <span style={{fontSize:9,color:"#555"}}>{new Date(s.data).toLocaleString("pt-BR")}</span>
                        <button className="btn btn-danger" style={{padding:"2px 7px",fontSize:10}} onClick={()=>removerSorteio(s.evtId,s.id)}>✕</button>
                      </div>
                    </div>
                    {s.premio&&<div style={{fontSize:11,color:"#7affc1",marginBottom:3}}>🎁 {s.premio}</div>}
                    {s.observacao&&<div style={{fontSize:11,color:"#888",marginBottom:3,fontStyle:"italic"}}>{s.observacao}</div>}
                    {s.vencedoras.map((v,i)=>(
                      <div key={i} style={{fontSize:11,paddingLeft:8,marginTop:3}}>
                        <span style={{color:"#ffd97a",fontWeight:700,marginRight:6}}>{i+1}°</span>
                        {v.nome} {v.instagram&&<span style={{color:"#c8a2ff"}}>@{v.instagram}</span>}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ══ ESTATÍSTICAS ══ */}
        {view===VIEWS.ESTATISTICAS&&(
          <div style={{animation:"fadeIn .3s"}}>
            <div style={{fontSize:22,fontWeight:800,marginBottom:4}}>📈 Estatísticas</div>
            <div style={{fontSize:12,color:"#555",marginBottom:24}}>Análise comparativa entre eventos</div>
            {data.eventos.length===0?(
              <div className="empty-state"><div style={{fontSize:48}}>📈</div><div style={{fontSize:15,fontWeight:600,marginTop:8}}>Nenhum evento</div></div>
            ):(
              <>
                <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:24}}>
                  {[
                    {n:data.eventos.length,l:"Eventos",c:"#c8a2ff"},
                    {n:data.eventos.reduce((s,e)=>s+e.divulgadoras.length,0),l:"Divulgadoras",c:"#7affc1"},
                    {n:data.eventos.reduce((s,e)=>s+e.acoes.length,0),l:"Ações",c:"#ffd97a"},
                    {n:data.eventos.reduce((s,e)=>s+(e.promoters||[]).reduce((s2,p)=>(p.vendas||[]).reduce((s3,v)=>s3+v.qtd,0)+s2,0),0),l:"Ingressos Vendidos",c:"#ff8a7a"},
                  ].map((st,i)=>(
                    <div key={i} className="stat-card"><div className="stat-num" style={{color:st.c}}>{st.n}</div><div className="stat-label">{st.l}</div></div>
                  ))}
                </div>
                <div className="card" style={{marginBottom:16}}>
                  <div className="section-title" style={{marginBottom:4}}>📊 Ativas por Ação — por Evento</div>
                  <div style={{fontSize:11,color:"#555",marginBottom:16}}>OKs por ação dentro de cada evento</div>
                  {data.eventos.filter(e=>e.acoes.length>0).map(evt=>{
                    const s=calcStats(evt); if(!s) return null;
                    const mediaAtivas=s.acaoStats.length?s.acaoStats.reduce((sum,a)=>sum+a.ok,0)/s.acaoStats.length:0;
                    return(
                      <div key={evt.id} style={{marginBottom:20}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                          <span style={{fontWeight:700,fontSize:13}}>{evt.nome}{evt.encerrado&&<span className="badge" style={{background:"#ff6b6b22",color:"#ff6b6b",fontSize:9,marginLeft:8}}>ENC.</span>}</span>
                          <span style={{fontFamily:"'Space Mono',monospace",color:"#7affc1",fontSize:12}}>Média: {mediaAtivas.toFixed(1)} ativas/ação</span>
                        </div>
                        {s.acaoStats.map(a=>(
                          <div key={a.id} style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                            <span style={{fontSize:10,color:"#666",width:52,textAlign:"right",flexShrink:0}}>Ação {a.numero}</span>
                            <div style={{flex:1,height:18,background:"#0d0d18",borderRadius:4,overflow:"hidden"}}>
                              <div style={{height:"100%",width:`${(a.ok/Math.max(evt.divulgadoras.length,1))*100}%`,background:"linear-gradient(90deg,#c8a2ff,#7a5af5)",borderRadius:4,transition:"width .4s"}}/>
                            </div>
                            <span style={{fontSize:10,fontFamily:"'Space Mono',monospace",color:"#888",width:28,flexShrink:0}}>{a.ok}</span>
                          </div>
                        ))}
                        <div style={{fontSize:10,color:"#444",marginTop:4}}>{evt.divulgadoras.length} divulg. · {evt.acoes.length} ações · média: {s.avg.toFixed(1)}% · 100%: {s.topCount}</div>
                      </div>
                    );
                  })}
                </div>
                <div className="card">
                  <div className="section-title" style={{marginBottom:4}}>🔀 Comparativo entre Eventos</div>
                  <div style={{fontSize:11,color:"#555",marginBottom:16}}>Médias gerais lado a lado</div>
                  {data.eventos.filter(e=>e.acoes.length>0).map(evt=>{
                    const s=calcStats(evt); if(!s) return null;
                    const mediaAtivas=s.acaoStats.length?s.acaoStats.reduce((sum,a)=>sum+a.ok,0)/s.acaoStats.length:0;
                    const totalIngressos=(evt.promoters||[]).reduce((sum,p)=>(p.vendas||[]).reduce((s2,v)=>s2+v.qtd,0)+sum,0);
                    return(
                      <div key={evt.id} style={{marginBottom:18}}>
                        <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:5}}>
                          <span style={{fontWeight:700}}>{evt.nome}</span>
                          <span style={{fontFamily:"'Space Mono',monospace",color:"#ffd97a"}}>{s.avg.toFixed(1)}% média</span>
                        </div>
                        <div className="prog-bar" style={{height:24,borderRadius:6}}>
                          <div className="prog-fill" style={{width:`${s.avg}%`,height:"100%",borderRadius:6,display:"flex",alignItems:"center",paddingLeft:8}}>
                            {s.avg>8&&<span style={{fontSize:10,color:"rgba(0,0,0,.7)",fontWeight:700,fontFamily:"'Space Mono',monospace"}}>{s.avg.toFixed(0)}%</span>}
                          </div>
                        </div>
                        <div style={{display:"flex",gap:14,marginTop:5,fontSize:10,color:"#555"}}>
                          <span>👥 {evt.divulgadoras.length}</span>
                          <span>⚡ {evt.acoes.length}</span>
                          <span>✅ {mediaAtivas.toFixed(1)}/ação</span>
                          <span>🏆 {s.topCount} 100%</span>
                          <span>🎟️ {totalIngressos} ingr.</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {/* ══ RELATÓRIOS GERAIS ══ */}
        {view===VIEWS.RELATORIOS&&(
          <div style={{animation:"fadeIn .3s"}}>
            <div style={{fontSize:22,fontWeight:800,marginBottom:4}}>📑 Relatórios Gerais</div>
            <div style={{fontSize:12,color:"#555",marginBottom:24}}>Exportação em CSV de todas as informações por evento</div>
            <div className="card" style={{maxWidth:700,marginBottom:16}}>
              <div className="section-title" style={{marginBottom:14}}>⬇ Exportação Geral</div>
              <div style={{marginBottom:14,padding:"12px 14px",background:"#0a0a16",borderRadius:8,fontSize:12,color:"#888",lineHeight:1.7}}>
                O relatório geral inclui: <strong style={{color:"#c8a2ff"}}>ranking de divulgadoras</strong> · <strong style={{color:"#7affc1"}}>sorteios com prêmios</strong> · <strong style={{color:"#ffd97a"}}>promoters e vendas detalhadas</strong> · de todos os eventos em um único arquivo CSV.
              </div>
              <button className="btn btn-accent" style={{width:"100%",padding:14,fontSize:14}} onClick={exportGeralCSV}>
                📑 Exportar Relatório Geral (todos os eventos)
              </button>
            </div>
            <div className="section-title" style={{marginBottom:14}}>📋 Por Evento</div>
            {data.eventos.length===0?(
              <div className="empty-state"><div style={{fontSize:40}}>📑</div><div style={{marginTop:8}}>Nenhum evento cadastrado</div></div>
            ):(
              <div style={{display:"grid",gap:12,maxWidth:700}}>
                {data.eventos.map(evt=>{
                  const s=calcStats(evt);
                  return(
                    <div key={evt.id} className="card" style={{padding:"16px 20px"}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                        <div>
                          <span style={{fontWeight:700,fontSize:14}}>{evt.nome}</span>
                          {evt.encerrado&&<span className="badge" style={{background:"#ff6b6b22",color:"#ff6b6b",fontSize:9,marginLeft:8}}>ENCERRADO</span>}
                          {evt.dataEvento&&<div style={{fontSize:11,color:"#555",marginTop:2}}>📅 {evt.dataEvento}</div>}
                        </div>
                        <div style={{display:"flex",gap:8}}>
                          <button className="btn btn-ghost" style={{fontSize:11}} onClick={()=>exportCSV(evt,"parcial")}>📊 Parcial</button>
                          <button className="btn" style={{fontSize:11,background:evt.encerrado?"#7affc122":"#1a1a28",color:evt.encerrado?"#7affc1":"#444",border:"none",borderRadius:8,padding:"8px 14px",fontFamily:"inherit",fontWeight:600,cursor:evt.encerrado?"pointer":"not-allowed"}}
                            onClick={()=>{if(evt.encerrado) exportCSV(evt,"final");}}>
                            🏆 Final
                          </button>
                        </div>
                      </div>
                      <div style={{display:"flex",gap:14,fontSize:11,color:"#666"}}>
                        <span>{evt.divulgadoras.length} divulg.</span>
                        <span>{evt.acoes.length} ações</span>
                        <span>{(evt.promoters||[]).length} promoters</span>
                        <span>{evt.sorteios?.length||0} sorteios</span>
                        {s&&<span>Média: {s.avg.toFixed(0)}%</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ══ LOGS ══ */}
        {view===VIEWS.LOGS&&(
          <div style={{animation:"fadeIn .3s"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24}}>
              <div>
                <div style={{fontSize:22,fontWeight:800}}>🕐 Logs do Sistema</div>
                <div style={{fontSize:12,color:"#555",marginTop:2}}>{(data.logs||[]).length} registro{(data.logs||[]).length!==1?"s":""}</div>
              </div>
              {(data.logs||[]).length>0&&(
                <button className="btn btn-danger" style={{fontSize:11}} onClick={()=>{let nd={...data,logs:[]};nd=addLog(nd,"Logs limpos");save(nd);show("Logs limpos");}}>🗑 Limpar Logs</button>
              )}
            </div>
            {(data.logs||[]).length===0?(
              <div className="empty-state"><div style={{fontSize:48}}>🕐</div><div style={{fontSize:14,marginTop:8}}>Nenhum log registrado ainda</div></div>
            ):(
              <div className="card" style={{maxWidth:800}}>
                {(data.logs||[]).map(log=>(
                  <div key={log.id} style={{display:"flex",gap:12,alignItems:"flex-start",padding:"8px 0",borderBottom:"1px solid #111"}}>
                    <span style={{fontSize:11,color:log.tipo==="danger"?"#ff8a7a":log.tipo==="warn"?"#ffd97a":"#888",fontFamily:"'Space Mono',monospace",flexShrink:0,width:130}}>
                      {new Date(log.ts).toLocaleString("pt-BR")}
                    </span>
                    <span style={{fontSize:11,color:log.tipo==="danger"?"#ff8a7a":log.tipo==="warn"?"#ffd97a":"#e0e0e0"}}>{log.msg}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ══════════ MODALS ══════════ */}

      {/* MODAL: Editar Evento */}
      <Modal open={showEditEvt} onClose={()=>setShowEditEvt(false)} title="✏️ Editar Evento">
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <div>
            <label className="field-label">Nome</label>
            <input value={editEvtNome} onChange={e=>setEditEvtNome(e.target.value)} placeholder="Nome do evento"/>
          </div>
          <div>
            <label className="field-label">Data</label>
            <input value={editEvtData} onChange={e=>setEditEvtData(e.target.value)} placeholder="Ex: 15/03/2026"/>
          </div>
          <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:4}}>
            <button className="btn btn-ghost" onClick={()=>setShowEditEvt(false)}>Cancelar</button>
            <button className="btn btn-accent" onClick={()=>{
              if(!editEvtNome.trim()){show("Nome obrigatório","error");return;}
              updateEvento({...activeEvento,nome:editEvtNome.trim(),dataEvento:editEvtData},`Evento renomeado para "${editEvtNome}"`);
              setShowEditEvt(false); show("Evento atualizado!");
            }}>Salvar</button>
          </div>
        </div>
      </Modal>

      {/* MODAL: Encerrar */}
      <Modal open={showEncerrar} onClose={()=>setShowEncerrar(false)} title="🔒 Encerrar Evento">
        <div style={{fontSize:12,color:"#888",marginBottom:16,lineHeight:1.7}}>
          O percentual será calculado sobre as <strong style={{color:"#ffd97a"}}>{activeEvento?.acoes.length} ações totais</strong>.<br/>
          Quem entrou tarde terá X retroativos — isso é intencional.
        </div>
        <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
          <button className="btn btn-ghost" onClick={()=>setShowEncerrar(false)}>Cancelar</button>
          <button className="btn btn-danger" onClick={encerrarEvento}>Confirmar</button>
        </div>
      </Modal>

      {/* MODAL: Exportar */}
      <Modal open={showExport} onClose={()=>setShowExport(false)} title="📤 Exportar Relatório">
        <div style={{fontSize:12,color:"#888",marginBottom:20,lineHeight:1.7}}>
          <strong style={{color:"#e0e0e0"}}>Parcial:</strong> snapshot atual com sorteios e promoters.<br/>
          <strong style={{color:"#e0e0e0"}}>Final:</strong> apenas quando o evento está encerrado.
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          <button className="btn btn-accent" style={{width:"100%",padding:12}} onClick={()=>{exportCSV(activeEvento,"parcial");setShowExport(false);}}>📊 Relatório Parcial</button>
          <button style={{width:"100%",padding:12,borderRadius:8,border:"none",fontFamily:"inherit",fontSize:12,fontWeight:600,cursor:activeEvento?.encerrado?"pointer":"not-allowed",background:activeEvento?.encerrado?"#7affc122":"#1a1a28",color:activeEvento?.encerrado?"#7affc1":"#444"}}
            onClick={()=>{if(activeEvento?.encerrado){exportCSV(activeEvento,"final");setShowExport(false);}}}>
            🏆 Relatório Final {!activeEvento?.encerrado&&"(encerre primeiro)"}
          </button>
          <button className="btn btn-ghost" onClick={()=>setShowExport(false)}>Cancelar</button>
        </div>
      </Modal>

      {/* MODAL: Novo/Editar Promoter */}
      <Modal open={promoterModal} onClose={()=>{setPromoterModal(false);setEditingPromoter(null);}} title={editingPromoter?"✏️ Editar Promoter":"➕ Novo Promoter"}>
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <div>
            <label className="field-label">Nome *</label>
            <input value={pNome} onChange={e=>setPNome(e.target.value)} placeholder="Nome completo"/>
          </div>
          <div>
            <label className="field-label">Email *</label>
            <input value={pEmail} onChange={e=>setPEmail(e.target.value)} placeholder="email@exemplo.com" type="email"/>
          </div>
          <div>
            <label className="field-label">Link *</label>
            <input value={pLink} onChange={e=>setPLink(e.target.value)} placeholder="https://link.com/promoter"/>
          </div>
          <div>
            <label className="field-label">Categoria</label>
            <select value={pCategoria} onChange={e=>setPCategoria(e.target.value)} style={{background:"#0a0a12",border:"1px solid #1e1e2e",borderRadius:8,padding:"10px 14px",color:"#e0e0e0",fontSize:13,width:"100%"}}>
              {CATS.map(c=><option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          {activeEvento?.condicoes?.[pCategoria]&&(
            <div style={{background:"#ffd97a11",border:"1px solid #ffd97a33",borderRadius:8,padding:"8px 12px",fontSize:11,color:"#ffd97a"}}>
              📋 Condições para {pCategoria}: {activeEvento.condicoes[pCategoria]}
            </div>
          )}
          <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:4}}>
            <button className="btn btn-ghost" onClick={()=>{setPromoterModal(false);setEditingPromoter(null);}}>Cancelar</button>
            <button className="btn btn-accent" onClick={salvarPromoter}>{editingPromoter?"Salvar Alterações":"Cadastrar"}</button>
          </div>
        </div>
      </Modal>

      {/* MODAL: Registrar Venda */}
      <Modal open={!!vendaModal} onClose={()=>{setVendaModal(null);setEditingVenda(null);}} title={editingVenda?"✏️ Editar Venda":"💳 Registrar Venda"} width={480}>
        {vendaModal&&(()=>{
          const p=activeEvento?.promoters?.find(x=>x.id===vendaModal);
          return(
            <div style={{display:"flex",flexDirection:"column",gap:12}}>
              {p&&<div style={{fontSize:12,color:"#c8a2ff",marginBottom:4}}>Promoter: <strong>{p.nome}</strong> · {p.categoria}</div>}
              <div style={{display:"flex",gap:8}}>
                <div style={{flex:1}}>
                  <label className="field-label">Qtd Ingressos *</label>
                  <input value={vQtd} onChange={e=>setVQtd(e.target.value)} type="number" min="1" style={{textAlign:"center"}}/>
                </div>
                <div style={{flex:1}}>
                  <label className="field-label">Valor Unit. (R$) *</label>
                  <input value={vValor} onChange={e=>setVValor(e.target.value)} type="number" min="0" step="0.01" placeholder="0,00"/>
                </div>
              </div>
              {vQtd&&vValor&&(
                <div style={{background:"#7affc111",border:"1px solid #7affc133",borderRadius:8,padding:"8px 12px",fontSize:12,color:"#7affc1",textAlign:"center"}}>
                  Total: <strong>{fmtCur(parseInt(vQtd||0)*parseFloat(vValor||0))}</strong>
                </div>
              )}
              <div>
                <label className="field-label">Comprovante Pix (link ou descrição)</label>
                <input value={vComprovante} onChange={e=>setVComprovante(e.target.value)} placeholder="Ex: https://... ou 'comprovante enviado no WhatsApp'"/>
              </div>
              <div>
                <label className="field-label">Observação</label>
                <input value={vObs} onChange={e=>setVObs(e.target.value)} placeholder="Ex: pagamento referente ao lote 1"/>
              </div>
              <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:4}}>
                <button className="btn btn-ghost" onClick={()=>{setVendaModal(null);setEditingVenda(null);}}>Cancelar</button>
                <button className="btn btn-accent" onClick={salvarVenda}>{editingVenda?"Salvar":"Registrar Venda"}</button>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* MODAL: Condições de Venda */}
      <Modal open={condicoesModal} onClose={()=>setCondicoesModal(false)} title="📋 Condições de Venda por Categoria">
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <div>
            <label className="field-label">Categoria</label>
            <select value={condicoesCat} onChange={e=>{setCondicoesCat(e.target.value);setCondicoesTexto(activeEvento?.condicoes?.[e.target.value]||"");}} style={{background:"#0a0a12",border:"1px solid #1e1e2e",borderRadius:8,padding:"10px 14px",color:"#e0e0e0",fontSize:13,width:"100%"}}>
              {CATS.map(c=><option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label">Condições de venda para {condicoesCat}</label>
            <textarea value={condicoesTexto} onChange={e=>setCondicoesTexto(e.target.value)}
              placeholder={`Descreva as condições para ${condicoesCat}:\nEx: 1 ingresso por venda mínima de R$ 60\nComissão: 10% sobre total vendido\nPrazo de entrega: até 3 dias antes do evento`}
              style={{minHeight:130,fontSize:12}}/>
          </div>
          <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
            <button className="btn btn-ghost" onClick={()=>setCondicoesModal(false)}>Cancelar</button>
            <button className="btn btn-accent" onClick={salvarCondicoes}>Salvar Condições</button>
          </div>
        </div>
      </Modal>

      {/* MODAL: DUP REVIEW */}
      <Modal open={!!dupReview} onClose={()=>setDupReview(null)} title="⚠️ Nomes Similares Detectados" width={600}>
        {dupReview&&(
          <>
            <div style={{fontSize:11,color:"#888",marginBottom:16}}>Revise antes de submeter</div>
            <div style={{maxHeight:380,overflowY:"auto"}}>
              {dupReview.suspects.map((s,i)=>(
                <div key={i} style={{padding:"12px 0",borderBottom:"1px solid #1a1a28"}}>
                  <div style={{marginBottom:6}}>
                    <div style={{fontSize:12}}><span style={{color:"#ffd97a"}}>NOVO:</span> {s.new.nome} {s.new.instagram&&<span style={{color:"#c8a2ff",fontSize:10}}>@{s.new.instagram}</span>}</div>
                    <div style={{fontSize:12}}><span style={{color:"#7affc1"}}>EXISTENTE:</span> {s.existing.nome} {s.existing.instagram&&<span style={{color:"#c8a2ff",fontSize:10}}>@{s.existing.instagram}</span>}</div>
                  </div>
                  <span className="badge" style={{background:"#ffd97a22",color:"#ffd97a",marginBottom:8,display:"inline-block"}}>{s.reason}</span>
                  <div style={{display:"flex",gap:6,marginTop:6}}>
                    {["merge","novo","ignorar"].map(opt=>(
                      <button key={opt} className={`btn ${dupReview.decisions[i]===opt?"btn-accent":"btn-ghost"}`} style={{fontSize:10,padding:"4px 12px"}}
                        onClick={()=>setDupReview({...dupReview,decisions:dupReview.decisions.map((d,j)=>j===i?opt:d)})}>
                        {opt==="merge"?"🔗 Unificar":opt==="novo"?"➕ Nova":"🚫 Ignorar"}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:16}}>
              <button className="btn btn-ghost" onClick={()=>setDupReview(null)}>Cancelar</button>
              <button className="btn btn-accent" onClick={()=>{
                const md=dupReview.suspects.map((s,i)=>({action:dupReview.decisions[i],newEntry:s.new,existingId:s.existing.id}));
                const ignored=new Set(md.filter(d=>d.action==="ignorar").map(d=>normStr(d.newEntry.nome)));
                const finalParsed=dupReview.parsed.filter(p=>!ignored.has(normStr(p.nome)));
                confirmarAcaoFinal(finalParsed,dupReview.num,dupReview.nome,md.filter(d=>d.action==="merge"));
              }}>Confirmar e Processar</button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700;800&family=Space+Mono:wght@400;700&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
@keyframes slideUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
@keyframes diceSpin{0%{transform:rotate(0deg) scale(1)}25%{transform:rotate(90deg) scale(1.15)}50%{transform:rotate(180deg) scale(1)}75%{transform:rotate(270deg) scale(1.15)}100%{transform:rotate(360deg) scale(1)}}
.card{background:#12121a;border:1px solid #1e1e2e;border-radius:12px;padding:20px;animation:slideUp .25s ease}
.evt-card{cursor:pointer;transition:all .2s}
.evt-card:hover{border-color:#c8a2ff44;transform:translateY(-2px)}
.nav-item{display:flex;align-items:center;gap:8px;width:100%;padding:8px 10px;border:none;background:transparent;color:#555;font-family:inherit;font-size:12px;cursor:pointer;transition:all .15s;border-radius:6px;text-align:left}
.nav-item:hover{color:#aaa;background:#1a1a28}
.nav-active{color:#c8a2ff !important;background:#c8a2ff18 !important}
.btn{padding:8px 16px;border:none;border-radius:8px;font-family:inherit;font-size:12px;font-weight:600;cursor:pointer;transition:all .15s;letter-spacing:.3px}
.btn:disabled{opacity:.5;cursor:not-allowed}
.btn-accent{background:linear-gradient(135deg,#c8a2ff,#7a5af5);color:white}
.btn-accent:hover:not(:disabled){opacity:.9;transform:translateY(-1px)}
.btn-danger{background:#ff4a4a18;color:#ff6b6b;border:1px solid #ff4a4a33}
.btn-danger:hover{background:#ff4a4a28}
.btn-ghost{background:transparent;color:#888;border:1px solid #1e1e2e}
.btn-ghost:hover{color:#e0e0e0;border-color:#333}
input,textarea,select{background:#0a0a12;border:1px solid #1e1e2e;border-radius:8px;padding:10px 14px;color:#e0e0e0;font-family:inherit;font-size:13px;width:100%;outline:none;transition:border-color .2s}
input:focus,textarea:focus,select:focus{border-color:#c8a2ff}
textarea{resize:vertical;min-height:100px}
select option{background:#0a0a12;color:#e0e0e0}
.tab{padding:10px 14px;border:none;background:transparent;color:#555;font-family:inherit;font-size:12px;cursor:pointer;transition:all .2s;border-bottom:2px solid transparent;display:flex;align-items:center;gap:5px;white-space:nowrap}
.tab:hover{color:#999}
.tab.active{color:#e0e0e0;border-bottom-color:#c8a2ff}
.stat-card{background:#12121a;border:1px solid #1e1e2e;border-radius:12px;padding:16px;text-align:center}
.stat-num{font-family:'Space Mono',monospace;font-size:28px;font-weight:700}
.stat-label{font-size:9px;color:#666;text-transform:uppercase;letter-spacing:1.5px;margin-top:2px}
.section-title{font-size:12px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:1px}
.field-label{font-size:11px;color:#888;font-weight:600;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px;display:block}
.rank-row{display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:8px;margin-bottom:4px;background:#0d0d15;border:1px solid #181828;transition:all .15s}
.rank-row:hover{border-color:#282840}
.rank-pos{font-family:'Space Mono',monospace;font-size:13px;font-weight:700;width:28px}
.prog-bar{height:5px;background:#1a1a28;border-radius:3px;overflow:hidden}
.prog-fill{height:100%;border-radius:3px;background:linear-gradient(90deg,#c8a2ff,#7affc1);transition:width .5s}
.badge{display:inline-block;padding:2px 8px;border-radius:12px;font-size:10px;font-weight:600}
.table-wrap{overflow:auto;border-radius:12px;border:1px solid #1e1e2e;max-height:70vh}
table{width:100%;border-collapse:collapse;font-size:11px}
th{background:#12121a;padding:8px 10px;text-align:left;font-weight:600;color:#666;text-transform:uppercase;letter-spacing:.8px;font-size:9px;position:sticky;top:0;z-index:2}
td{padding:6px 10px;border-top:1px solid #14141f}
tr:hover td{background:#14141f55}
.cell-ok{color:#7affc1;font-weight:700;text-align:center}
.cell-x{color:#ff6b6b;font-weight:700;text-align:center}
.toast{position:fixed;bottom:20px;right:20px;padding:10px 18px;border-radius:10px;font-size:12px;font-weight:500;z-index:9999;animation:slideUp .3s}
.toast-success{background:#7affc1;color:#0a0a0f}
.toast-error{background:#ff6b6b;color:white}
.empty-state{text-align:center;padding:60px 20px;color:#444}
.modal-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.8);z-index:1000;display:flex;align-items:center;justify-content:center;animation:fadeIn .15s}
.modal{background:#12121a;border:1px solid #2a2a3e;border-radius:16px;padding:24px;max-height:88vh;overflow-y:auto;width:92%;animation:slideUp .2s}
details summary::-webkit-details-marker{display:none}
details>summary{list-style:none}
`;
