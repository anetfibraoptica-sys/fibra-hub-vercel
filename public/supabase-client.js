
/* ============================================================
   Fibra+ Hub - Supabase como banco principal
============================================================ */
const FIBRA_SUPABASE_URL = "https://dfjquycuhaopizpzajyw.supabase.co";
const FIBRA_SUPABASE_KEY = "sb_publishable_NVNGjgu_g9PKRkBdEK7w2w_o-HeBVIv";

const FibraDB = {
  online: false,

  async request(path, options = {}){
    const headers = {
      "apikey": FIBRA_SUPABASE_KEY,
      "Authorization": "Bearer " + FIBRA_SUPABASE_KEY,
      "Content-Type": "application/json",
      "Prefer": options.prefer || "return=representation"
    };

    const res = await fetch(FIBRA_SUPABASE_URL + "/rest/v1/" + path, {
      method: options.method || "GET",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    });

    if(!res.ok){
      const txt = await res.text();
      throw new Error("Supabase " + res.status + ": " + txt);
    }

    this.online = true;
    const t = await res.text();
    return t ? JSON.parse(t) : null;
  },

  async getAll(table, query = ""){
    return await this.request(table + "?select=*" + query, {method:"GET"});
  },

  async upsert(table, rows, conflict){
    if(!Array.isArray(rows)) rows = [rows];
    const path = table + (conflict ? "?on_conflict=" + encodeURIComponent(conflict) : "");
    return await this.request(path, {
      method:"POST",
      prefer:"resolution=merge-duplicates,return=representation",
      body: rows
    });
  },

  async updateWhere(table, column, value, data){
    return await this.request(table + "?" + encodeURIComponent(column) + "=eq." + encodeURIComponent(value), {
      method:"PATCH",
      prefer:"return=representation",
      body:data
    });
  },

  async deleteWhere(table, column, value){
    return await this.request(table + "?" + encodeURIComponent(column) + "=eq." + encodeURIComponent(value), {
      method:"DELETE",
      prefer:"return=representation"
    });
  },

  normalize(v){
    return String(v || "").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g," ").trim().toLowerCase();
  },

  doc(v){ return String(v || "").replace(/\D/g,""); },

  moeda(v){ return Number(v || 0); },

  clienteKey(c){
    return this.normalize(c.loginPppoe || c.login || c.usuario || c.user) ||
           this.doc(c.cpfCnpj || c.cpf || c.cnpj) ||
           this.normalize(c.email) ||
           this.normalize(c.nome);
  },

  boletoKey(b){
    return String(b.numero || b.id || b.nossoNumero || b.titulo || Date.now()).trim();
  },

  clienteToRow(c){
    return {
      login: c.loginPppoe || c.login || c.usuario || null,
      login_pppoe: c.loginPppoe || c.login || c.usuario || null,
      senha_pppoe: c.senhaPppoe || c.senha || null,
      nome: c.nome || null,
      cpf_cnpj: c.cpfCnpj || c.cpf || c.cnpj || null,
      cpf: c.cpf || null,
      cnpj: c.cnpj || null,
      rg_ie: c.rgIe || c.rg || null,
      email: c.email || null,
      telefone1: c.telefone1 || c.telefone || null,
      telefone2: c.telefone2 || null,
      telefone3: c.telefone3 || null,
      endereco: c.endereco || null,
      numero: c.numero || null,
      bairro: c.bairro || null,
      cidade: c.cidade || null,
      uf: c.uf || null,
      cep: c.cep || null,
      complemento: c.complemento || null,
      referencia: c.referencia || null,
      coordenada_x: c.coordenadaX || c.x || null,
      coordenada_y: c.coordenadaY || c.y || null,
      plano: c.plano || c.profile || null,
      valor_mensal: this.moeda(c.valorMensal || c.valor || c.valor_mensal || 0),
      dia_vencimento: Number(c.diaVencimento || c.dia_vencimento || 0) || null,
      servidor: c.servidorReceita || c.servidor || null,
      servidor_ip: c.servidorIp || c.servidor_ip || null,
      profile: c.profile || null,
      interface: c.interface || null,
      tecnologia: c.tecnologia || null,
      elemento_rede: c.elementoRede || c.elemento_rede || null,
      mac: c.mac || null,
      mac_onu: c.macOnu || c.mac_onu || null,
      serial_onu: c.serialOnu || c.serial_onu || null,
      pop_servidor: c.popServidor || c.pop_servidor || null,
      status: c.status || c.situacao || "ativo",
      data_cadastro: c.dataCadastro || c.data_cadastro || null,
      data_ativacao: c.dataAtivacao || c.data_ativacao || null,
      data_bloqueio: c.dataBloqueio || c.data_bloqueio || null,
      data_cancelamento: c.dataCancelamento || c.data_cancelamento || null,
      liberacao_confianca_ate: c.liberacaoConfiancaAte || c.liberacao_confianca_ate || null,
      observacao: c.observacao || null,
      boletos: Array.isArray(c.boletos) ? c.boletos : [],
      dados: c,
      origem: c.origem || "Fibra+ Hub",
      atualizado_em: new Date().toISOString()
    };
  },

  rowToCliente(r){
    const d = r.dados || {};
    return {
      ...d,
      id: r.id,
      login: r.login,
      loginPppoe: r.login_pppoe || r.login,
      senhaPppoe: r.senha_pppoe,
      nome: r.nome,
      cpfCnpj: r.cpf_cnpj,
      cpf: r.cpf,
      cnpj: r.cnpj,
      rgIe: r.rg_ie,
      email: r.email,
      telefone1: r.telefone1,
      telefone2: r.telefone2,
      telefone3: r.telefone3,
      endereco: r.endereco,
      numero: r.numero,
      bairro: r.bairro,
      cidade: r.cidade,
      uf: r.uf,
      cep: r.cep,
      complemento: r.complemento,
      referencia: r.referencia,
      coordenadaX: r.coordenada_x,
      coordenadaY: r.coordenada_y,
      plano: r.plano,
      valorMensal: Number(r.valor_mensal || 0),
      diaVencimento: r.dia_vencimento,
      servidorReceita: r.servidor,
      servidorIp: r.servidor_ip,
      profile: r.profile,
      interface: r.interface,
      tecnologia: r.tecnologia,
      elementoRede: r.elemento_rede,
      mac: r.mac,
      macOnu: r.mac_onu,
      serialOnu: r.serial_onu,
      popServidor: r.pop_servidor,
      status: r.status,
      dataCadastro: r.data_cadastro,
      dataAtivacao: r.data_ativacao,
      dataBloqueio: r.data_bloqueio,
      dataCancelamento: r.data_cancelamento,
      liberacaoConfiancaAte: r.liberacao_confianca_ate,
      observacao: r.observacao,
      boletos: Array.isArray(r.boletos) ? r.boletos : []
    };
  },

  boletoToRow(b){
    return {
      numero: this.boletoKey(b),
      cliente_login: b.login || b.loginPppoe || b.clienteLogin || null,
      cliente_nome: b.nome || b.cliente || null,
      cpf_cnpj: b.cpfCnpj || b.cpf || b.cnpj || null,
      categoria: b.categoria || "Mensalidade",
      descricao: b.descricao || "Boleto",
      emissao: b.emissao || null,
      vencimento: b.vencimento || null,
      pagamento: b.pagamento || b.dataPagamento || null,
      desconto: this.moeda(b.desconto || 0),
      valor: this.moeda(b.valor || 0),
      total: this.moeda(b.total || b.valor || 0),
      valor_pago: this.moeda(b.valorPago || b.valor_pago || 0),
      status: b.status || "pendente",
      banco: b.banco || null,
      agencia_conta: b.agenciaConta || b.agencia_conta || null,
      identificacao_carne: b.identificacaoCarne || b.identificacao_carne || null,
      linha_digitavel: b.linhaDigitavel || b.linha_digitavel || null,
      codigo_barras: b.codigoBarras || b.codigo_barras || null,
      pix: b.pix || b.codigoPix || null,
      link_pdf: b.linkPdf || b.link_pdf || b.pdf || null,
      efi_charge_id: b.efiChargeId || b.efi_charge_id || null,
      efi_status: b.efiStatus || b.efi_status || null,
      observacao: b.observacao || null,
      dados: b,
      origem: b.origem || "Fibra+ Hub",
      atualizado_em: new Date().toISOString()
    };
  },

  rowToBoleto(r){
    const d = r.dados || {};
    return {
      ...d,
      id: r.id,
      numero: r.numero,
      login: r.cliente_login,
      nome: r.cliente_nome,
      cpfCnpj: r.cpf_cnpj,
      categoria: r.categoria,
      descricao: r.descricao,
      emissao: r.emissao,
      vencimento: r.vencimento,
      pagamento: r.pagamento,
      dataPagamento: r.pagamento,
      desconto: Number(r.desconto || 0),
      valor: Number(r.valor || 0),
      total: Number(r.total || 0),
      valorPago: Number(r.valor_pago || 0),
      status: r.status,
      banco: r.banco,
      agenciaConta: r.agencia_conta,
      identificacaoCarne: r.identificacao_carne,
      linhaDigitavel: r.linha_digitavel,
      codigoBarras: r.codigo_barras,
      pix: r.pix,
      linkPdf: r.link_pdf,
      efiChargeId: r.efi_charge_id,
      efiStatus: r.efi_status,
      observacao: r.observacao
    };
  },

  async salvarClientes(clientes){
    const rows = (clientes || []).map(c => this.clienteToRow(c)).filter(r => r.login || r.cpf_cnpj || r.nome);
    if(!rows.length) return [];
    return await this.upsert("clientes", rows, "login");
  },

  async salvarCliente(cliente){
    const row = this.clienteToRow(cliente);
    return await this.upsert("clientes", row, "login");
  },

  async carregarClientes(){
    const rows = await this.getAll("clientes", "&order=nome.asc");
    const clientes = (rows || []).map(r => this.rowToCliente(r));
    this.setCacheClientes(clientes);
    return clientes;
  },

  setCacheClientes(clientes){
    ["clientes","clientesReceitaNet","fibra_clientes","clientes_importados"].forEach(k => localStorage.setItem(k, JSON.stringify(clientes || [])));
  },

  getCacheClientes(){
    for(const k of ["clientes","clientesReceitaNet","fibra_clientes","clientes_importados"]){
      try{
        const v = JSON.parse(localStorage.getItem(k) || "[]");
        if(Array.isArray(v) && v.length) return v;
      }catch(e){}
    }
    return [];
  },


  deduplicarBoletos(boletos){
    const mapa = new Map();
    (boletos || []).forEach((b, idx) => {
      const numero = String(b.numero || b.id || b.nossoNumero || b.titulo || "").trim();
      const chave = numero || (String(b.login || "") + "|" + String(b.vencimento || "") + "|" + String(b.valor || "") + "|" + idx);
      mapa.set(chave, {...(mapa.get(chave) || {}), ...b, numero: numero || chave});
    });
    return Array.from(mapa.values());
  },

  async salvarBoletos(boletos){
    const limpos = this.deduplicarBoletos(boletos || []);
    const rows = limpos.map(b => this.boletoToRow(b)).filter(r => r.numero);
    if(!rows.length) return [];

    const retorno = [];
    const lote = 200;

    for(let i = 0; i < rows.length; i += lote){
      const parte = rows.slice(i, i + lote);
      const r = await this.upsert("boletos", parte, "numero");
      if(Array.isArray(r)) retorno.push(...r);
    }

    this.setCacheBoletos(limpos);
    return retorno;
  },

  async salvarBoleto(boleto){
    return await this.upsert("boletos", this.boletoToRow(boleto), "numero");
  },

  async carregarBoletos(){
    const rows = await this.getAll("boletos", "&order=vencimento.asc");
    const boletos = (rows || []).map(r => this.rowToBoleto(r));
    this.setCacheBoletos(boletos);
    return boletos;
  },

  setCacheBoletos(boletos){
    ["boletos","titulos","cobrancas"].forEach(k => localStorage.setItem(k, JSON.stringify(boletos || [])));
  },

  getCacheBoletos(){
    for(const k of ["boletos","titulos","cobrancas"]){
      try{
        const v = JSON.parse(localStorage.getItem(k) || "[]");
        if(Array.isArray(v) && v.length) return v;
      }catch(e){}
    }
    return [];
  },

  async excluirBoleto(numero){
    await this.deleteWhere("boletos", "numero", numero);
    const boletos = this.getCacheBoletos().filter(b => String(b.numero) !== String(numero));
    this.setCacheBoletos(boletos);
    return boletos;
  },

  async registrarPagamento(pag){
    try{ await this.upsert("pagamentos", pag); }catch(e){ console.warn("Pagamento não salvo:", e.message); }
  },

  async sincronizarTudo(){
    const clientes = await this.carregarClientes();
    const boletos = await this.carregarBoletos();
    return {clientes, boletos};
  }
};

window.FibraDB = FibraDB;

async function fibraSincronizarSupabaseAoAbrir(){
  try{
    await FibraDB.sincronizarTudo();
    console.log("Fibra+ Hub conectado ao Supabase.");
    document.dispatchEvent(new CustomEvent("fibra:supabase-sync"));
  }catch(e){
    console.warn("Usando cache local. Supabase:", e.message);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  setTimeout(fibraSincronizarSupabaseAoAbrir, 300);
});


document.addEventListener("fibra:supabase-sync", function(){
  setTimeout(function(){
    [
      "carregarClientes",
      "renderClientes",
      "renderizarClientes",
      "listarClientes",
      "atualizarListaClientes",
      "carregarDashboard",
      "atualizarDashboard",
      "renderizarBoletosCliente"
    ].forEach(function(fn){
      try{
        if(typeof window[fn] === "function") window[fn]();
      }catch(e){}
    });
  }, 200);
});
