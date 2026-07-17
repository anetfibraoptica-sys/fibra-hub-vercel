/* Fibra+ Hub - autenticação por sessão segura no servidor (cookie HttpOnly). */
const FibraAuth = {
  _usuario: null,
  _carregando: null,

  permissoesPorFuncao(funcao){
    funcao = String(funcao || "").toLowerCase();
    if(funcao.includes("superadmin") || funcao.includes("super admin")) return {dashboard:true,clientes:true,cadastro:true,financeiro:true,boletos:true,baixa:true,configuracoes:true,usuarios:true,mikrotik:true,relatorios:true,excluir:true,super_admin:true};
    if(funcao.includes("admin")) return {dashboard:true,clientes:true,cadastro:true,financeiro:true,boletos:true,baixa:true,configuracoes:true,usuarios:true,mikrotik:true,relatorios:true,excluir:true};
    if(funcao.includes("financeiro")) return {dashboard:true,clientes:true,cadastro:false,financeiro:true,boletos:true,baixa:true,configuracoes:false,usuarios:false,mikrotik:false,relatorios:true,excluir:false};
    if(funcao.includes("técnico") || funcao.includes("tecnico")) return {dashboard:true,clientes:true,cadastro:false,financeiro:false,boletos:false,baixa:false,configuracoes:false,usuarios:false,mikrotik:true,relatorios:false,excluir:false};
    return {dashboard:true,clientes:true,cadastro:true,financeiro:false,boletos:true,baixa:false,configuracoes:false,usuarios:false,mikrotik:false,relatorios:false,excluir:false};
  },

  usuarioAtual(){ return this._usuario; },
  estaLogado(){ return !!this._usuario; },

  async requisicao(url, options={}){
    const resposta = await fetch(url, {
      ...options,
      credentials: "same-origin",
      headers: {"Content-Type":"application/json", ...(options.headers || {})}
    });
    let dados = {};
    try { dados = await resposta.json(); } catch(_) {}
    if(!resposta.ok) throw new Error(dados.erro || `Erro HTTP ${resposta.status}`);
    return dados;
  },

  async carregarSessao(forcar=false){
    if(this._usuario && !forcar) return this._usuario;
    if(this._carregando && !forcar) return this._carregando;
    this._carregando = this.requisicao("/api/auth/me")
      .then(r => {
        this._usuario = r.usuario || null;
        if(this._usuario && (!this._usuario.permissoes || !Object.keys(this._usuario.permissoes).length)) this._usuario.permissoes = this.permissoesPorFuncao(this._usuario.funcao);
        return this._usuario;
      })
      .catch(() => { this._usuario = null; return null; })
      .finally(() => { this._carregando = null; });
    return this._carregando;
  },

  async login(usuario, senha){
    const r = await this.requisicao("/api/auth/login", {method:"POST", body:JSON.stringify({usuario,senha})});
    this._usuario = r.usuario || null;
    return this._usuario;
  },

  async sair(){
    try { await this.requisicao("/api/auth/logout", {method:"POST", body:"{}"}); } catch(_) {}
    this._usuario = null;
    location.replace("/login.html");
  },

  permissaoDaPagina(){
    const pagina=(location.pathname.split("/").pop() || "dashboard.html").toLowerCase();
    if(pagina.includes("usuario")) return "usuarios";
    if(pagina.includes("configur")) return "configuracoes";
    if(pagina.includes("financeiro")) return "financeiro";
    if(pagina.includes("mikrotik") || pagina.includes("pppoe") || pagina.includes("monitoramento")) return "mikrotik";
    if(pagina.includes("relatorio")) return "relatorios";
    if(pagina.includes("cadastro")) return "cadastro";
    if(pagina.includes("cliente")) return "clientes";
    return "dashboard";
  },

  async proteger(){
    const pagina=location.pathname.split("/").pop() || "dashboard.html";
    if(pagina === "login.html" || pagina === "index.html") return true;
    const u=await this.carregarSessao();
    if(!u){ location.replace("/login.html"); return false; }
    const p=this.permissaoDaPagina();
    const permitido = u.super_admin || (u.permissoes && u.permissoes[p] !== false);
    if(!permitido){ alert("Seu usuário não tem permissão para acessar esta página."); location.replace("/dashboard.html"); return false; }
    document.querySelectorAll(".usuario-logado,.user-name,#usuarioLogado").forEach(el => el.textContent=u.nome || u.usuario);
    return true;
  },

  async criarUsuario({nome,usuario,senha,funcao,status}){
    const permissoes=this.permissoesPorFuncao(funcao);
    const r=await this.requisicao("/api/usuarios-painel", {method:"POST",body:JSON.stringify({nome,usuario,senha,funcao,status,permissoes})});
    return r.usuario;
  },

  async listarUsuarios(){
    const r=await this.requisicao("/api/usuarios-painel");
    return r.usuarios || [];
  },

  async auditar(acao,entidade,entidade_id,dados){
    try{
      await this.requisicao("/api/auditoria-painel", {method:"POST",body:JSON.stringify({acao,entidade,entidade_id,dados:dados||{}})});
    }catch(e){ console.warn("Auditoria não salva:",e.message); }
  }
};

window.FibraAuth=FibraAuth;
window.protegerPagina=function(){ return FibraAuth.proteger(); };
window.sair=function(){ return FibraAuth.sair(); };

document.addEventListener("DOMContentLoaded", async function(){
  await FibraAuth.proteger();
});
