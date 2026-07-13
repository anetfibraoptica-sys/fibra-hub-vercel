/* Fibra+ Hub - Etapa 1: clientes com Supabase como fonte única */
(function(){
  "use strict";
  const api = async (url, options={}) => {
    const r=await fetch(url,{cache:"no-store",...options});
    const j=await r.json().catch(()=>({}));
    if(!r.ok || j.ok===false) throw new Error(j.erro || `Falha HTTP ${r.status}`);
    return j;
  };
  async function listar(){
    const j=await api('/api/clientes');
    const lista=Array.isArray(j.clientes)?j.clientes:[];
    window.__fibraClientesSupabase=lista;
    window.__clientesReceitaNet=lista; // compatibilidade visual, sem persistência
    return lista;
  }
  async function buscar(chave){
    const j=await api('/api/clientes/buscar?chave='+encodeURIComponent(chave));
    return j.cliente;
  }
  async function salvar(cliente){
    const j=await api('/api/clientes/salvar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(cliente||{})});
    return j.cliente;
  }
  function chave(c={}){ return c.id || c.loginPppoe || c.login || c.cpfCnpj || c.cpf || c.nome || ''; }
  function abrir(c){ location.href='cadastro.html?cliente='+encodeURIComponent(typeof c==='object'?chave(c):c); }
  window.FibraClientesStage1={listar,buscar,salvar,abrir};
  window.abrirClienteCadastro=abrir;

  async function atualizarLista(){
    if(!/clientes\.html$/i.test(location.pathname)) return;
    const lista=await listar();
    if(typeof atualizarContadores==='function') atualizarContadores(lista);
    if(typeof renderizarClientesReceitaNet==='function') renderizarClientesReceitaNet(lista);
    else if(typeof renderizarClientes==='function') renderizarClientes(lista);
    else if(typeof renderClientes==='function') renderClientes(lista);
  }
  async function carregarCadastroURL(){
    if(!/cadastro\.html$/i.test(location.pathname)) return;
    const valor=new URLSearchParams(location.search).get('cliente');
    if(!valor) return;
    const c=await buscar(valor);
    window.__fibraClienteSelecionado=c;
    if(typeof preencherCadastro==='function') preencherCadastro(c);
    else if(typeof preencherFormularioCliente==='function') preencherFormularioCliente(c);
    else if(typeof carregarClienteNoCadastro==='function') carregarClienteNoCadastro(c);
    document.dispatchEvent(new CustomEvent('fibra:cliente-carregado',{detail:c}));
  }
  document.addEventListener('DOMContentLoaded',()=>{
    atualizarLista().catch(e=>console.error('Clientes Supabase:',e));
    carregarCadastroURL().catch(e=>console.error('Cadastro Supabase:',e));
  });
  window.addEventListener('pageshow',()=>atualizarLista().catch(()=>{}));
})();
