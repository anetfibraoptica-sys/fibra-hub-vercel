(function centralApiFactory(){
  "use strict";

  const config = window.FIBRA_CENTRAL_SUPABASE || {};
  const SUPABASE_URL = String(config.url || "").replace(/\/$/, "");
  const SUPABASE_KEY = String(config.key || "");

  function onlyDigits(value){ return String(value || "").replace(/\D/g, ""); }

  function formatCpf(cpf){
    const value = onlyDigits(cpf).slice(0, 11);
    return value.replace(/^(\d{3})(\d)/, "$1.$2")
      .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/\.(\d{3})(\d)/, ".$1-$2");
  }

  function maskDocument(value){
    const cpf = onlyDigits(value);
    return cpf.length === 11 ? `***.${cpf.slice(3,6)}.${cpf.slice(6,9)}-**` : "Documento protegido";
  }

  function normalize(value){
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
  }

  function rowData(row){
    if(row && row.dados && typeof row.dados === "object") return row.dados;
    if(row && typeof row.dados === "string"){
      try { return JSON.parse(row.dados); } catch(_){ return {}; }
    }
    return {};
  }

  function pick(objects, keys, fallback=""){
    for(const object of objects){
      if(!object || typeof object !== "object") continue;
      for(const key of keys){
        const value = object[key];
        if(value !== undefined && value !== null && String(value).trim() !== "") return value;
      }
    }
    return fallback;
  }

  function numberValue(value){
    if(typeof value === "number") return Number.isFinite(value) ? value : 0;
    let text = String(value ?? "").trim();
    if(!text) return 0;
    if(text.includes(",")) text = text.replace(/\./g, "").replace(",", ".");
    const parsed = Number(text.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function documentFromClient(row){
    const data = rowData(row);
    return onlyDigits(pick([row, data], ["cpf_cnpj","cpfCnpj","cpf","cnpj","documento","cadCpf"]));
  }

  function planIdFromClient(row){
    const data = rowData(row);
    const value = pick([row, data], ["plano_cobranca_id","planoCobrancaId","plano_id","planoId"], "");
    return String(value ?? "").trim();
  }

  function clientPublic(row, plansById=new Map()){
    const data = rowData(row);
    const document = documentFromClient(row);
    const planId = planIdFromClient(row);
    const billingPlan = planId ? plansById.get(planId) : null;
    return {
      id:String(row.id ?? pick([data], ["id"], "")),
      nome:String(pick([row, data], ["nome","cliente","razaoSocial","razao_social"], "Assinante")),
      documento:maskDocument(document),
      loginPppoe:String(pick([row, data], ["login_pppoe","loginPppoe","login","usuario","pppoe"])),
      planoId:planId,
      plano:String(billingPlan?.descricao || "Plano de cobrança não vinculado"),
      profile:String(pick([row, data], ["profile","perfil"])),
      valorMensal:numberValue(billingPlan?.valor),
      diaVencimento:Number(pick([row, data], ["dia_vencimento","diaVencimento","vencimento"], 0)) || null,
      status:String(pick([row, data], ["status","situacao","statusCliente","status_cliente"], "ativo")),
      telefone1:String(pick([row, data], ["telefone1","telefone","celular","whatsapp","fone"])),
      telefone2:String(pick([row, data], ["telefone2","celular2","fone2"])),
      email:String(pick([row, data], ["email","e_mail","mail"])),
      dataNascimento:pick([row, data], ["cadNascimento","dataNascimento","data_nascimento","nascimento","dtNascimento","dt_nascimento"]),
      endereco:String(pick([row, data], ["endereco","logradouro","rua"])),
      bairro:String(pick([row, data], ["bairro"])),
      cidade:String(pick([row, data], ["cidade","municipio","localidade"])),
      uf:String(pick([row, data], ["uf","estado"])),
      cep:String(pick([row, data], ["cep"])),
      tecnologia:String(pick([row, data], ["tecnologia","tipoTecnologia","tipo_tecnologia"])),
      servidor:String(pick([row, data], ["servidor","popServidor","pop_servidor"]))
    };
  }

  function billPublic(row){
    const data = rowData(row);
    return {
      id:String(row.id ?? pick([data], ["id"], "")),
      numero:String(pick([row, data], ["numero","nossoNumero","titulo"], row.id ?? "")),
      descricao:String(pick([row, data], ["descricao","categoria"], "Mensalidade")),
      categoria:String(pick([row, data], ["categoria"], "Mensalidade")),
      emissao:pick([row, data], ["emissao"]),
      vencimento:pick([row, data], ["vencimento","dataVencimento","dueDate","expire_at"]),
      pagamento:pick([row, data], ["pagamento","dataPagamento"]),
      valor:numberValue(pick([row, data], ["total","valor"], 0)),
      valorPago:numberValue(pick([row, data], ["valor_pago","valorPago"], 0)),
      status:String(pick([row, data], ["status","efi_status","efiStatus"], "pendente")),
      linhaDigitavel:String(pick([row, data], ["linha_digitavel","linhaDigitavel"])),
      codigoBarras:String(pick([row, data], ["codigo_barras","codigoBarras"])),
      pix:String(pick([row, data], ["pix","codigoPix","pix_copia_cola"])),
      linkPdf:String(pick([row, data], ["link_pdf","linkPdf","pdf","segundaVia","link_boleto"])),
      clienteId:String(pick([row, data], ["cliente_id","clienteId"])),
      clienteLogin:String(pick([row, data], ["cliente_login","clienteLogin","login","loginPppoe"]))
    };
  }

  function billDateTimestamp(value){
    const text = String(value || "").trim();
    if(!text) return Number.POSITIVE_INFINITY;
    let match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if(match) return new Date(Number(match[1]), Number(match[2])-1, Number(match[3])).getTime();
    match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if(match) return new Date(Number(match[3]), Number(match[2])-1, Number(match[1])).getTime();
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? Number.POSITIVE_INFINITY : date.getTime();
  }

  function compareBillDueDate(a,b){
    const dateDiff = billDateTimestamp(a?.vencimento) - billDateTimestamp(b?.vencimento);
    if(Number.isFinite(dateDiff) && dateDiff !== 0) return dateDiff;
    if(!Number.isFinite(billDateTimestamp(a?.vencimento)) && Number.isFinite(billDateTimestamp(b?.vencimento))) return 1;
    if(Number.isFinite(billDateTimestamp(a?.vencimento)) && !Number.isFinite(billDateTimestamp(b?.vencimento))) return -1;
    return String(a?.numero || a?.id || "").localeCompare(String(b?.numero || b?.id || ""), "pt-BR", {numeric:true});
  }

  function storageGet(storage, key){
    try { return storage.getItem(key) || ""; } catch(_){ return ""; }
  }

  function storageSet(storage, key, value){
    try { storage.setItem(key, value); } catch(_){}
  }

  function storageRemove(storage, key){
    try { storage.removeItem(key); } catch(_){}
  }

  function hashDocument(){
    try{
      const params = new URLSearchParams(String(location.hash || "").replace(/^#/, ""));
      return onlyDigits(params.get("cpf"));
    }catch(_){ return ""; }
  }

  function directDocument(){
    return "";
  }

  function saveDirectSession(){
    // Sessão controlada pelo cookie HttpOnly do servidor.
    return;
  }

  function clearDirectSession(){
    return;
  }

  async function backendRequest(path, options={}){
    const response = await fetch(path, {
      credentials:"same-origin",
      cache:"no-store",
      ...options,
      headers:{"Content-Type":"application/json", ...(options.headers || {})}
    });
    const payload = await response.json().catch(()=>({}));
    if(!response.ok || payload.ok === false){
      const error = new Error(payload.erro || `Falha HTTP ${response.status}`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  function ensureDirectConfig(){
    if(!SUPABASE_URL || !SUPABASE_KEY) throw new Error("Configuração do Supabase não encontrada.");
  }

  async function supabaseRequest(table, params={}, options={}){
    ensureDirectConfig();
    const query = new URLSearchParams(params);
    const url = `${SUPABASE_URL}/rest/v1/${table}${query.toString() ? `?${query}` : ""}`;
    const response = await fetch(url, {
      method:options.method || "GET",
      cache:"no-store",
      headers:{
        apikey:SUPABASE_KEY,
        Authorization:`Bearer ${SUPABASE_KEY}`,
        "Content-Type":"application/json",
        Prefer:options.prefer || "return=representation"
      },
      body:options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch(_){ payload = text; }
    if(!response.ok){
      const message = payload?.message || payload?.hint || payload?.details || `Supabase HTTP ${response.status}`;
      const error = new Error(message);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  function documentVariants(cpf){
    const digits = onlyDigits(cpf);
    return [...new Set([digits, formatCpf(digits)])].filter(Boolean);
  }

  async function directPlansForClients(clients){
    const ids = [...new Set((clients || []).map(planIdFromClient).filter(Boolean))];
    const plansById = new Map();
    if(!ids.length) return plansById;

    try{
      const rows = await supabaseRequest("planos_cobranca", {
        select:"id,descricao,valor,ativo",
        id:`in.(${ids.join(",")})`,
        limit:String(Math.max(ids.length, 100))
      });
      for(const row of Array.isArray(rows) ? rows : []){
        plansById.set(String(row.id), {
          id:String(row.id),
          descricao:String(row.descricao || "Plano de cobrança"),
          valor:numberValue(row.valor),
          ativo:row.ativo !== false
        });
      }
    }catch(error){
      const wrapped = new Error(`Não foi possível consultar planos_cobranca: ${error.message}`);
      wrapped.status = error.status;
      wrapped.payload = error.payload;
      throw wrapped;
    }

    return plansById;
  }

  async function directClients(document){
    const variants = documentVariants(document);
    const terms = [];
    for(const value of variants){
      terms.push(`cpf_cnpj.eq.${value}`, `cpf.eq.${value}`, `cnpj.eq.${value}`);
      terms.push(`dados->>cpfCnpj.eq.${value}`, `dados->>cpf.eq.${value}`, `dados->>cnpj.eq.${value}`, `dados->>documento.eq.${value}`, `dados->>cadCpf.eq.${value}`);
    }

    let rows = [];
    try{
      rows = await supabaseRequest("clientes", {select:"*", or:`(${terms.join(",")})`, limit:"100"});
    }catch(error){
      // Compatibilidade com bases antigas que não possuem todos os campos JSON usados acima.
      const simpleTerms = [];
      for(const value of variants) simpleTerms.push(`cpf_cnpj.eq.${value}`, `cpf.eq.${value}`, `cnpj.eq.${value}`);
      rows = await supabaseRequest("clientes", {select:"*", or:`(${simpleTerms.join(",")})`, limit:"100"});
    }

    return (Array.isArray(rows) ? rows : []).filter(row=>documentFromClient(row) === onlyDigits(document));
  }

  function nestedBills(clients){
    const result = [];
    for(const client of clients){
      const data = rowData(client);
      const lists = [client.boletos, data.boletos, client.faturas, data.faturas];
      for(const list of lists){
        if(Array.isArray(list)) result.push(...list.map(item=>({...item, cliente_id:item.cliente_id || client.id, cliente_login:item.cliente_login || client.login_pppoe || client.login})));
      }
    }
    return result;
  }

  async function directBills(document, clients){
    const terms = [];
    for(const value of documentVariants(document)) terms.push(`cpf_cnpj.eq.${value}`);
    for(const client of clients){
      if(client.id !== undefined && client.id !== null && String(client.id) !== "") terms.push(`cliente_id.eq.${client.id}`);
      const data = rowData(client);
      const login = String(pick([client, data], ["login_pppoe","loginPppoe","login","usuario","pppoe"], "")).trim();
      if(login) terms.push(`cliente_login.eq.${login}`);
    }

    let rows = [];
    if(terms.length){
      try{
        rows = await supabaseRequest("boletos", {select:"*", or:`(${[...new Set(terms)].join(",")})`, limit:"1000"});
      }catch(_){
        rows = [];
      }
    }

    const combined = [...(Array.isArray(rows) ? rows : []), ...nestedBills(clients)];
    const unique = new Map();
    for(const item of combined){
      const bill = billPublic(item);
      const key = bill.id || bill.numero || `${bill.vencimento}|${bill.valor}|${bill.descricao}`;
      unique.set(key, bill);
    }
    return [...unique.values()].sort(compareBillDueDate);
  }

  async function directStatus(){
    await supabaseRequest("clientes", {select:"id", limit:"1"});
    let boletos = true;
    let planosCobranca = true;
    try { await supabaseRequest("boletos", {select:"id", limit:"1"}); } catch(_){ boletos = false; }
    try { await supabaseRequest("planos_cobranca", {select:"id", limit:"1"}); } catch(_){ planosCobranca = false; }
    return {ok:true, conectado:true, modo:"supabase-direto", tabelas:{clientes:true, boletos, planos_cobranca:planosCobranca}};
  }

  async function directLogin(cpf, remember){
    const response = await fetch("/api/central/login", {
      method:"POST",
      credentials:"same-origin",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({cpf:String(cpf || "").replace(/\D/g,"")})
    });
    const payload = await response.json().catch(()=>({}));
    if(!response.ok || !payload.ok){
      const error = new Error(payload.erro || "CPF não encontrado.");
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  async function directMe(){
    const document = directDocument();
    if(!document){
      const error = new Error("Acesso não iniciado.");
      error.status = 401;
      throw error;
    }
    const clients = await directClients(document);
    if(!clients.length){
      clearDirectSession();
      const error = new Error("Cadastro não encontrado.");
      error.status = 401;
      throw error;
    }
    const plansById = await directPlansForClients(clients);
    const points = clients.map(client=>clientPublic(client, plansById));
    return {
      ok:true,
      modo:"supabase-direto",
      assinante:{
        nome:points[0]?.nome || "Assinante",
        documento:maskDocument(document),
        pontos:points
      }
    };
  }

  async function directBoletos(){
    const document = directDocument();
    if(!document){
      const error = new Error("Acesso não iniciado.");
      error.status = 401;
      throw error;
    }
    const clients = await directClients(document);
    const bills = await directBills(document, clients);
    return {ok:true, modo:"supabase-direto", total:bills.length, boletos:bills};
  }

  async function preferBackend(backendFn, directFn){
    try{
      return await backendFn();
    }catch(backendError){
      try{
        return await directFn();
      }catch(directError){
        // Mantém a mensagem mais útil do Supabase direto quando o backend não está disponível.
        if([0,404,500,502,503].includes(Number(backendError.status || 0))) throw directError;
        if(backendError.name === "TypeError") throw directError;
        throw backendError;
      }
    }
  }

  async function solicitarConfianca(clienteId){
    const me = await directMe();
    const cliente = me?.assinante || {};
    const ponto = Array.isArray(cliente.pontos) ? (cliente.pontos[0] || {}) : {};
    const body = {
      servidor: String(ponto.servidor || cliente.servidor || cliente.servidorId || cliente.mikrotik || cliente.mikrotikServidor || cliente.router || ""),
      login: String(ponto.loginPppoe || cliente.loginPppoe || cliente.login_pppoe || cliente.login || ""),
      acao: "confianca",
      dias: 1,
      profile: String(ponto.profile || cliente.profile || ""),
      clienteId: String(clienteId || ponto.id || cliente.id || "")
    };

    const resp = await fetch("/api/mikrotik/cliente-acao", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify(body)
    });

    const json = await resp.json().catch(()=>({}));
    if(!resp.ok || !json.ok){
      throw new Error(json.erro || json.mensagem || "Não foi possível solicitar a liberação em confiança.");
    }
    return json;
  }

  window.CentralAPI = {
    status:directStatus,
    login(cpf, lembrar){ return directLogin(cpf, lembrar); },
    async logout(){ clearDirectSession(); return {ok:true}; },
    me:directMe,
    boletos:directBoletos,
    solicitarConfianca,
    documentoAtual:directDocument,
    somenteDigitos:onlyDigits
  };
})();
