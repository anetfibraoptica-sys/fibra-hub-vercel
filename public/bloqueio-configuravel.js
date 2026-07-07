
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

  async function carregarDiasBloqueio(){
    let dias = DEFAULT_DIAS_BLOQUEIO;

    try{
      const local = JSON.parse(localStorage.getItem("fibra_configuracoes") || "{}");
      if(local && local.dias_para_bloqueio) dias = Number(local.dias_para_bloqueio) || dias;
    }catch(e){}

    if(window.FibraDB){
      try{
        const rows = await FibraDB.getAll("configuracoes", "&chave=eq.bloqueio_automatico");
        const valor = rows && rows[0] && rows[0].valor;
        if(valor && valor.dias_para_bloqueio !== undefined){
          dias = Number(valor.dias_para_bloqueio) || dias;
        }
      }catch(e){
        console.warn("Não foi possível ler configuração de bloqueio:", e.message);
      }
    }

    localStorage.setItem("fibra_configuracoes", JSON.stringify({dias_para_bloqueio:dias}));
    return dias;
  }

  async function salvarDiasBloqueio(dias){
    dias = Number(dias) || DEFAULT_DIAS_BLOQUEIO;
    localStorage.setItem("fibra_configuracoes", JSON.stringify({dias_para_bloqueio:dias}));

    if(window.FibraDB){
      try{
        await FibraDB.upsert("configuracoes", {
          chave:"bloqueio_automatico",
          valor:{dias_para_bloqueio:dias},
          atualizado_em:new Date().toISOString()
        }, "chave");
      }catch(e){
        console.warn("Erro ao salvar configuração no Supabase:", e.message);
      }
    }
    return dias;
  }

  function encontrarBoletoBloqueador(cliente, boletos, diasConfig){
    const doCliente = (boletos || []).filter(b => mesmoCliente(cliente,b) && !statusPagoCancelado(b));

    let pior = null;

    doCliente.forEach(b => {
      const venc = b.vencimento || b.dataVencimento || b.dtVencimento;
      const dias = diasAtraso(venc);

      if(dias >= diasConfig){
        if(!pior || dias > pior.diasAtraso){
          pior = {
            boleto:b,
            diasAtraso:dias,
            vencimento:dataISO(parseData(venc)),
            numero:String(b.numero || b.id || b.nossoNumero || b.titulo || "")
          };
        }
      }
    });

    return pior;
  }

  async function carregarClientesBoletos(){
    let clientes = [];
    let boletos = [];

    if(window.FibraDB){
      try{ clientes = await FibraDB.carregarClientes(); }catch(e){}
      try{ boletos = await FibraDB.carregarBoletos(); }catch(e){}
    }

    if(!clientes.length){
      try{ clientes = JSON.parse(localStorage.getItem("clientes") || "[]"); }catch(e){}
    }
    if(!boletos.length){
      try{ boletos = JSON.parse(localStorage.getItem("boletos") || "[]"); }catch(e){}
    }

    return {clientes:Array.isArray(clientes)?clientes:[], boletos:Array.isArray(boletos)?boletos:[]};
  }

  window.fibraAtualizarStatusPorBoletos = async function(){
    const diasConfig = await carregarDiasBloqueio();
    const {clientes, boletos} = await carregarClientesBoletos();

    let ativos = 0;
    let bloqueados = 0;
    let preservados = 0;

    const hoje = new Date().toISOString().slice(0,10);

    const atualizados = clientes.map(c => {
      if(clienteCancelado(c) || clienteIsento(c) || confiancaValida(c)){
        preservados++;
        return c;
      }

      const bloq = encontrarBoletoBloqueador(c, boletos, diasConfig);

      if(bloq){
        bloqueados++;
        return {
          ...c,
          status:"bloqueado",
          dataBloqueio:c.dataBloqueio || c.data_bloqueio || hoje,
          data_bloqueio:c.data_bloqueio || c.dataBloqueio || hoje,
          motivoBloqueio:"Boleto vencido",
          motivo_bloqueio:"Boleto vencido",
          boletoBloqueioNumero:bloq.numero,
          boleto_bloqueio_numero:bloq.numero,
          boletoBloqueioVencimento:bloq.vencimento,
          boleto_bloqueio_vencimento:bloq.vencimento,
          diasAtrasoBloqueio:bloq.diasAtraso,
          dias_atraso_bloqueio:bloq.diasAtraso,
          regraBloqueio:`bloqueio automático após ${diasConfig} dias`,
          atualizadoEm:new Date().toISOString()
        };
      }

      ativos++;
      return {
        ...c,
        status:"ativo",
        dataBloqueio:"",
        data_bloqueio:null,
        motivoBloqueio:"",
        motivo_bloqueio:null,
        boletoBloqueioNumero:"",
        boleto_bloqueio_numero:null,
        boletoBloqueioVencimento:"",
        boleto_bloqueio_vencimento:null,
        diasAtrasoBloqueio:0,
        dias_atraso_bloqueio:0,
        regraBloqueio:`sem boleto com ${diasConfig}+ dias`,
        atualizadoEm:new Date().toISOString()
      };
    });

    ["clientes","clientesReceitaNet","fibra_clientes","clientes_importados"].forEach(k => localStorage.setItem(k, JSON.stringify(atualizados)));

    if(window.FibraDB){
      try{ await FibraDB.salvarClientes(atualizados); }catch(e){ console.warn("Erro ao salvar status no Supabase:", e.message); }
    }

    const resumo = {ativos,bloqueados,preservados,total:atualizados.length,diasConfig};
    console.log("Status atualizado por boletos:", resumo);
    return resumo;
  };

  window.atualizarClientesPorBoletos = async function(listaBoletos){
    if(Array.isArray(listaBoletos) && listaBoletos.length){
      ["boletos","titulos","cobrancas"].forEach(k => localStorage.setItem(k, JSON.stringify(listaBoletos)));
    }
    return await window.fibraAtualizarStatusPorBoletos();
  };

  window.fibraAbrirConfigBloqueio = async function(){
    const atual = await carregarDiasBloqueio();
    const novo = prompt("Dias para bloqueio automático:", String(atual));
    if(novo === null) return;
    const dias = await salvarDiasBloqueio(Number(novo));
    alert("Configuração salva: bloquear a partir de " + dias + " dias de atraso.");
  };

  document.addEventListener("DOMContentLoaded", function(){
})();
