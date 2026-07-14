
/* Fibra+ Hub — Supabase como fonte única */
(function(){
  const chavesDados = new Set([
    "clientes","clientesReceitaNet","fibra_clientes","clientes_importados",
    "clienteSelecionadoCompleto","clienteCadastroSelecionado","clienteEditar",
    "clienteEditarLogin","clienteOnlineSelecionado",
    "boletos","titulos","cobrancas","fibra_boletos","boletosImportados",
    "ultimaImportacaoReceitaNet","ultimaImportacaoBoletosReceitaNet",
    "fibra_configuracoes","efi_contas","fibraEfiConfig","fibraEfiCobrancas"
  ]);

  const memoria = Object.create(null);
  const originalGet = Storage.prototype.getItem;
  const originalSet = Storage.prototype.setItem;
  const originalRemove = Storage.prototype.removeItem;

  // Remove dados legados persistidos por versões anteriores. A memória abaixo
  // serve apenas como buffer temporário durante a tela atual.
  chavesDados.forEach(chave => {
    try{ originalRemove.call(localStorage, chave); }catch(e){}
    try{ originalRemove.call(sessionStorage, chave); }catch(e){}
  });

  Storage.prototype.getItem = function(chave){
    if(chavesDados.has(String(chave))){
      return Object.prototype.hasOwnProperty.call(memoria, chave) ? memoria[chave] : null;
    }
    return originalGet.call(this, chave);
  };

  Storage.prototype.setItem = function(chave, valor){
    if(chavesDados.has(String(chave))){
      memoria[chave] = String(valor);
      return;
    }
    return originalSet.call(this, chave, valor);
  };

  Storage.prototype.removeItem = function(chave){
    if(chavesDados.has(String(chave))){
      delete memoria[chave];
      return;
    }
    return originalRemove.call(this, chave);
  };

  window.FibraSupabaseOnly = {
    async listarClientes(){
      const r = await fetch("/api/clientes", {cache:"no-store"});
      const j = await r.json();
      if(!r.ok || !j.ok) throw new Error(j.erro || "Erro ao carregar clientes.");
      return Array.isArray(j.clientes) ? j.clientes : [];
    },

    async buscarCliente(chave){
      const r = await fetch("/api/clientes/buscar?chave=" + encodeURIComponent(chave), {cache:"no-store"});
      const j = await r.json();
      if(!r.ok || !j.ok) throw new Error(j.erro || "Cliente não encontrado.");
      return j.cliente;
    },

    async salvarCliente(dados){
      const r = await fetch("/api/clientes/salvar", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify(dados)
      });
      const j = await r.json();
      if(!r.ok || !j.ok) throw new Error(j.erro || "Erro ao salvar cliente.");
      return j.cliente;
    },

    abrirCadastro(cliente){
      const chave =
        cliente?.id ||
        cliente?.loginPppoe ||
        cliente?.login ||
        cliente?.cpfCnpj ||
        cliente?.cpf ||
        cliente?.nome ||
        "";
      location.href = "cadastro.html?cliente=" + encodeURIComponent(chave);
    }
  };
})();
