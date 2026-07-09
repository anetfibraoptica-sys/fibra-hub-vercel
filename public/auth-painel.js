
/* ============================================================
   Fibra+ Hub - Login por usuários do painel
   Remove admin/admin e usa usuarios_painel no Supabase.
============================================================ */
const FibraAuth = {
  async sha256(text){
    const enc = new TextEncoder().encode(String(text || ""));
    const buf = await crypto.subtle.digest("SHA-256", enc);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,"0")).join("");
  },

  permissoesPorFuncao(funcao){
    funcao = String(funcao || "").toLowerCase();
    if(funcao.includes("superadmin") || funcao.includes("super admin")){
      return {dashboard:true, clientes:true, cadastro:true, financeiro:true, boletos:true, baixa:true, configuracoes:true, usuarios:true, mikrotik:true, relatorios:true, excluir:true, super_admin:true};
    }
    if(funcao.includes("admin")){
      return {
        dashboard:true, clientes:true, cadastro:true, financeiro:true,
        boletos:true, baixa:true, configuracoes:true, usuarios:true,
        mikrotik:true, relatorios:true, excluir:true
      };
    }
    if(funcao.includes("financeiro")){
      return {
        dashboard:true, clientes:true, cadastro:false, financeiro:true,
        boletos:true, baixa:true, configuracoes:false, usuarios:false,
        mikrotik:false, relatorios:true, excluir:false
      };
    }
    if(funcao.includes("técnico") || funcao.includes("tecnico")){
      return {
        dashboard:true, clientes:true, cadastro:false, financeiro:false,
        boletos:false, baixa:false, configuracoes:false, usuarios:false,
        mikrotik:true, relatorios:false, excluir:false
      };
    }
    return {
      dashboard:true, clientes:true, cadastro:true, financeiro:false,
      boletos:true, baixa:false, configuracoes:false, usuarios:false,
      mikrotik:false, relatorios:false, excluir:false
    };
  },

  usuarioAtual(){
    try{
      return JSON.parse(localStorage.getItem("fibra_usuario_atual") || "null");
    }catch(e){ return null; }
  },

  estaLogado(){
    return !!this.usuarioAtual();
  },

  async buscarUsuario(usuario){
    if(!window.FibraDB) throw new Error("Supabase não carregou.");
    const u = String(usuario || "").trim().toLowerCase();
    const rows = await FibraDB.getAll("usuarios_painel", "&usuario=eq." + encodeURIComponent(u));
    return rows && rows[0] ? rows[0] : null;
  },

  async login(usuario, senha){
    const u = String(usuario || "").trim().toLowerCase();
    const s = String(senha || "");
    if(!u || !s) throw new Error("Informe usuário e senha.");

    const row = await this.buscarUsuario(u);
    if(!row) throw new Error("Usuário não encontrado.");
    if(String(row.status || "").toLowerCase() !== "ativo") throw new Error("Usuário inativo.");

    const hash = await this.sha256(s);
    if(hash !== row.senha_hash) throw new Error("Senha incorreta.");

    const sessao = {
      id: row.id,
      nome: row.nome,
      usuario: row.usuario,
      funcao: row.funcao,
      super_admin: !!row.super_admin,
      permissoes: row.permissoes && Object.keys(row.permissoes).length ? row.permissoes : this.permissoesPorFuncao(row.funcao),
      loginEm: new Date().toISOString()
    };

    localStorage.setItem("fibra_usuario_atual", JSON.stringify(sessao));
    localStorage.setItem("fibraLogado", "1");

    try{
      await FibraDB.updateWhere("usuarios_painel", "usuario", row.usuario, {ultimo_acesso:new Date().toISOString()});
      await this.auditar("login", "usuarios_painel", row.id, {});
    }catch(e){}

    return sessao;
  },

  sair(){
    localStorage.removeItem("fibra_usuario_atual");
    localStorage.removeItem("fibraLogado");
    location.href = "login.html";
  },

  proteger(){
    const pagina = location.pathname.split("/").pop() || "dashboard.html";
    if(pagina === "login.html" || pagina === "index.html") return true;
    if(!this.estaLogado()){
      location.href = "login.html";
      return false;
    }
    return true;
  },

  async criarUsuario({nome, usuario, senha, funcao, status}){
    if(!window.FibraDB) throw new Error("Supabase não carregou.");
    nome = String(nome || "").trim();
    usuario = String(usuario || "").trim().toLowerCase();
    senha = String(senha || "");
    funcao = String(funcao || "Atendimento");
    status = String(status || "ativo").toLowerCase();

    if(!nome) throw new Error("Informe o nome.");
    if(!usuario) throw new Error("Informe o usuário.");
    if(senha.length < 4) throw new Error("A senha precisa ter pelo menos 4 caracteres.");

    const senha_hash = await this.sha256(senha);
    const row = {
      nome, usuario, senha_hash, funcao, status,
      permissoes:this.permissoesPorFuncao(funcao),
      atualizado_em:new Date().toISOString()
    };

    const ret = await FibraDB.upsert("usuarios_painel", row, "usuario");
    await this.auditar("criar/atualizar usuário", "usuarios_painel", usuario, {nome, usuario, funcao, status});
    return ret;
  },

  async listarUsuarios(){
    if(!window.FibraDB) return [];
    return await FibraDB.getAll("usuarios_painel", "&order=nome.asc");
  },

  async auditar(acao, entidade, entidade_id, dados){
    const u = this.usuarioAtual() || {};
    if(!window.FibraDB) return;
    try{
      await FibraDB.upsert("auditoria_painel", {
        usuario_id:u.id || null,
        usuario_nome:u.nome || null,
        usuario_login:u.usuario || null,
        acao,
        entidade,
        entidade_id:String(entidade_id || ""),
        cliente_login:dados && (dados.cliente_login || dados.login) || null,
        cliente_nome:dados && (dados.cliente_nome || dados.nome) || null,
        valor:dados && dados.valor !== undefined ? Number(dados.valor || 0) : null,
        dados:dados || {}
      });
    }catch(e){
      console.warn("Auditoria não salva:", e.message);
    }
  }
};

window.FibraAuth = FibraAuth;
window.protegerPagina = function(){ return FibraAuth.proteger(); };
window.sair = function(){ FibraAuth.sair(); };

document.addEventListener("DOMContentLoaded", function(){
  setTimeout(function(){
    FibraAuth.proteger();
    const u = FibraAuth.usuarioAtual();
    if(u){
      document.querySelectorAll(".usuario-logado,.user-name,#usuarioLogado").forEach(el => el.textContent = u.nome || u.usuario);
    }
  }, 200);
});
