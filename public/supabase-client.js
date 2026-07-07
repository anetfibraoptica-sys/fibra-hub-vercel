
const FIBRA_SUPABASE_URL = "https://dfjquycuhaopizpzajyw.supabase.co";
const FIBRA_SUPABASE_KEY = "sb_publishable_NVNGjgu_g9PKRkBdEK7w2w_o-HeBVIv";

const FibraDB = {
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
    if(!res.ok) throw new Error(await res.text());
    const t = await res.text();
    return t ? JSON.parse(t) : null;
  },
  async upsert(table, rows, conflict){
    if(!Array.isArray(rows)) rows=[rows];
    return await this.request(table + (conflict ? "?on_conflict=" + encodeURIComponent(conflict) : ""), {
      method:"POST", prefer:"resolution=merge-duplicates,return=representation", body: rows
    });
  },
  async getAll(table, q=""){
    return await this.request(table + "?select=*" + q, {method:"GET"});
  },
  clienteToRow(c){
    return {
      login: c.loginPppoe || c.login || null,
      login_pppoe: c.loginPppoe || c.login || null,
      nome: c.nome || null,
      cpf_cnpj: c.cpfCnpj || c.cpf || c.cnpj || null,
      cpf: c.cpf || null,
      cnpj: c.cnpj || null,
      email: c.email || null,
      telefone1: c.telefone1 || c.telefone || null,
      telefone2: c.telefone2 || null,
      telefone3: c.telefone3 || null,
      endereco: c.endereco || null,
      bairro: c.bairro || null,
      cidade: c.cidade || null,
      uf: c.uf || null,
      cep: c.cep || null,
      complemento: c.complemento || null,
      referencia: c.referencia || null,
      plano: c.plano || c.profile || null,
      valor_mensal: Number(c.valorMensal || c.valor || 0),
      dia_vencimento: Number(c.diaVencimento || 0) || null,
      servidor: c.servidorReceita || c.servidor || null,
      profile: c.profile || null,
      interface: c.interface || null,
      elemento_rede: c.elementoRede || null,
      pop_servidor: c.popServidor || null,
      status: c.status || c.situacao || "ativo",
      dados: c,
      boletos: Array.isArray(c.boletos) ? c.boletos : [],
      origem: c.origem || "Fibra+ Hub",
      atualizado_em: new Date().toISOString()
    };
  },
  rowToCliente(r){
    const d=r.dados||{};
    return {...d,id:r.id,login:r.login,loginPppoe:r.login_pppoe||r.login,nome:r.nome,cpfCnpj:r.cpf_cnpj,email:r.email,telefone1:r.telefone1,telefone2:r.telefone2,telefone3:r.telefone3,endereco:r.endereco,bairro:r.bairro,cidade:r.cidade,uf:r.uf,cep:r.cep,plano:r.plano,valorMensal:Number(r.valor_mensal||0),diaVencimento:r.dia_vencimento,status:r.status,boletos:Array.isArray(r.boletos)?r.boletos:[]};
  },
  boletoToRow(b){
    return {
      numero: String(b.numero || b.id || b.nossoNumero || b.titulo || Date.now()),
      cliente_login: b.login || b.loginPppoe || b.clienteLogin || null,
      cliente_nome: b.nome || b.cliente || null,
      cpf_cnpj: b.cpfCnpj || b.cpf || b.cnpj || null,
      categoria: b.categoria || "Mensalidade",
      descricao: b.descricao || "Boleto",
      emissao: b.emissao || null,
      vencimento: b.vencimento || null,
      pagamento: b.pagamento || b.dataPagamento || null,
      desconto: Number(b.desconto || 0),
      valor: Number(b.valor || 0),
      total: Number(b.total || b.valor || 0),
      valor_pago: Number(b.valorPago || 0),
      status: b.status || "pendente",
      banco: b.banco || null,
      agencia_conta: b.agenciaConta || null,
      identificacao_carne: b.identificacaoCarne || null,
      linha_digitavel: b.linhaDigitavel || null,
      pix: b.pix || b.codigoPix || null,
      efi_status: b.efiStatus || null,
      dados: b,
      origem: b.origem || "Fibra+ Hub",
      atualizado_em: new Date().toISOString()
    };
  },
  rowToBoleto(r){
    const d=r.dados||{};
    return {...d,id:r.id,numero:r.numero,login:r.cliente_login,nome:r.cliente_nome,cpfCnpj:r.cpf_cnpj,categoria:r.categoria,descricao:r.descricao,emissao:r.emissao,vencimento:r.vencimento,pagamento:r.pagamento,dataPagamento:r.pagamento,desconto:Number(r.desconto||0),valor:Number(r.valor||0),total:Number(r.total||0),valorPago:Number(r.valor_pago||0),status:r.status,banco:r.banco,agenciaConta:r.agencia_conta,identificacaoCarne:r.identificacao_carne,linhaDigitavel:r.linha_digitavel,pix:r.pix,efiStatus:r.efi_status};
  },
  async salvarClientes(clientes){
    const rows=(clientes||[]).map(c=>this.clienteToRow(c)).filter(r=>r.login||r.cpf_cnpj||r.nome);
    return rows.length ? await this.upsert("clientes", rows, "login") : [];
  },
  async carregarClientes(){
    const rows=await this.getAll("clientes","&order=nome.asc");
    const clientes=(rows||[]).map(r=>this.rowToCliente(r));
    ["clientes","clientesReceitaNet","fibra_clientes","clientes_importados"].forEach(k=>localStorage.setItem(k,JSON.stringify(clientes)));
    return clientes;
  },
  async salvarBoletos(boletos){
    const rows=(boletos||[]).map(b=>this.boletoToRow(b)).filter(r=>r.numero);
    return rows.length ? await this.upsert("boletos", rows, "numero") : [];
  },
  async carregarBoletos(){
    const rows=await this.getAll("boletos","&order=vencimento.asc");
    const boletos=(rows||[]).map(r=>this.rowToBoleto(r));
    ["boletos","titulos","cobrancas"].forEach(k=>localStorage.setItem(k,JSON.stringify(boletos)));
    return boletos;
  },
  async sincronizarTudo(){
    const clientes=await this.carregarClientes();
    const boletos=await this.carregarBoletos();
    return {clientes,boletos};
  }
};
window.FibraDB=FibraDB;
document.addEventListener("DOMContentLoaded",()=>setTimeout(()=>FibraDB.sincronizarTudo().catch(e=>console.warn("Supabase cache local:",e.message)),300));
