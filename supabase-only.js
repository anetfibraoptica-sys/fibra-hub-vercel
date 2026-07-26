/* Fibra+ Hub — clientes com Supabase como fonte única */
(function(){
  "use strict";

  async function api(url, options={}){
    const resposta = await fetch(url, {cache:"no-store", ...options});
    const json = await resposta.json().catch(()=>({}));
    if(!resposta.ok || json.ok === false) throw new Error(json.erro || `Falha HTTP ${resposta.status}`);
    return json;
  }

  function atualizarCache(lista){
    const clientes = Array.isArray(lista) ? lista : [];
    window.__fibraClientesSupabase = clientes;
    window.__clientesReceitaNet = clientes;
    return clientes;
  }

  window.FibraSupabaseOnly = {
    async listarClientes(){
      const json = await api("/api/clientes");
      return atualizarCache(json.clientes);
    },
    async buscarCliente(chave){
      const json = await api("/api/clientes/buscar?chave=" + encodeURIComponent(chave));
      return json.cliente;
    },
    async salvarCliente(dados){
      const json = await api("/api/clientes/salvar", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify(dados || {})
      });
      const atual = atualizarCache(window.__fibraClientesSupabase);
      const cliente = json.cliente;
      const indice = atual.findIndex(c => String(c.id || "") === String(cliente.id || ""));
      if(indice >= 0) atual[indice] = cliente; else atual.unshift(cliente);
      return cliente;
    },
    async salvarClientes(lista){
      const clientes = Array.isArray(lista) ? lista : [];
      const salvos = [];
      for(const cliente of clientes) salvos.push(await this.salvarCliente(cliente));
      return salvos;
    },
    abrirCadastro(cliente){
      const chave = typeof cliente === "object" ? cliente?.id : cliente;
      location.href = "cadastro.html?id=" + encodeURIComponent(chave || "");
    },
    cache(){ return atualizarCache(window.__fibraClientesSupabase); },
    atualizarCache
  };
})();
