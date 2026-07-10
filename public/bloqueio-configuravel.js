
/* ============================================================
   Fibra+ Hub - Bloqueio financeiro configurável
   Regra: cliente bloqueia quando boleto pendente/vencido tem
   dias_atraso >= dias_para_bloqueio. Padrão: 4.
============================================================ */
(function(){
  const DEFAULT_DIAS_BLOQUEIO = 4;

  function norm(v){
    return String(v || "")
      .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
      .replace(/\s+/g," ")
      .trim()
      .toLowerCase();
  }

  function doc(v){ return String(v || "").replace(/\D/g,""); }

  function parseData(v){
    if(!v) return null;
    v = String(v).trim();
    let m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if(m) return new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00`);
    m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if(m) return new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00`);
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }

  function dataISO(d){
    if(!d || isNaN(d.getTime())) return null;
    return d.toISOString().slice(0,10);
  }

  function diasAtraso(vencimento){
    const d = parseData(vencimento);
    if(!d) return 0;
    const hoje = new Date();
    hoje.setHours(0,0,0,0);
    d.setHours(0,0,0,0);
    const diff = Math.floor((hoje - d) / 86400000);
    return diff > 0 ? diff : 0;
  }

  function statusPagoCancelado(b){
    const s = norm(b.statusOriginal || b.statusReceitaNet || b.status || b.situacao || b.estado || "");
    return s.includes("pago") ||
           s.includes("baixado") ||
           s.includes("receb") ||
           s.includes("cancel") ||
           s.includes("estornado");
  }

  function clienteCancelado(c){
    const s = norm(c.status || c.situacao || c.statusCobranca || "");
    return s.includes("cancel") || !!String(c.dataCancelamento || c.data_cancelamento || c.cancelamento || "").trim();
  }

  function clienteIsento(c){
    const s = norm(c.status || c.situacao || c.statusCobranca || c.cobranca || "");
    return s.includes("isento") || s.includes("nao cobrar");
  }

  function confiancaValida(c){
    const raw = c.liberacaoConfiancaAte || c.liberacao_confianca_ate || c.liberacaoConfianca || c.dataLiberacaoConfianca || "";
    const d = parseData(raw);
    if(!d) return false;
    const hoje = new Date();
    hoje.setHours(0,0,0,0);
    d.setHours(23,59,59,999);
    return d >= hoje;
  }

  function mesmoCliente(c,b){
    const clogin = norm(c.loginPppoe || c.login || c.usuario);
    const blogin = norm(b.login || b.loginPppoe || b.clienteLogin || b.cliente_login);
    if(clogin && blogin && clogin === blogin) return true;

    const cdoc = doc(c.cpfCnpj || c.cpf_cnpj || c.cpf || c.cnpj);
    const bdoc = doc(b.cpfCnpj || b.cpf_cnpj || b.cpf || b.cnpj);
    if(cdoc && bdoc && cdoc === bdoc) return true;

    const cnome = norm(c.nome);
    const bnome = norm(b.nome || b.cliente || b.cliente_nome);
    if(cnome && bnome && (cnome === bnome || cnome.includes(bnome) || bnome.includes(cnome))) return true;

    return false;
  }

  )();
