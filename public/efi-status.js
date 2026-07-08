
(function(){
  function temEfiLocal(){
    try{
      if(localStorage.getItem("efi_integrado") === "true") return true;
      if(localStorage.getItem("fibra_efi_integrado") === "true") return true;
      if(localStorage.getItem("efi_configurado") === "true") return true;

      const contas = JSON.parse(localStorage.getItem("fibra_efi_contas") || "[]");
      if(Array.isArray(contas) && contas.some(c => c && (c.ClientId || c.clientId) && (c.ClientSecret || c.clientSecret))) return true;

      const c1 = JSON.parse(localStorage.getItem("fibra_efi_conta_1") || "null");
      if(c1 && (c1.ClientId || c1.clientId) && (c1.ClientSecret || c1.clientSecret)) return true;
    }catch(e){}
    return false;
  }

  async function consultarBackend(){
    try{
      const resp = await fetch("/api/efi/status", {cache:"no-store"});
      const json = await resp.json();
      if(json && json.ok && json.integrada) return json;
    }catch(e){}
    return null;
  }

  async function atualizarStatusEfiGlobal(){
    const local = temEfiLocal();
    const backend = await consultarBackend();
    const integrada = local || Boolean(backend && backend.integrada);

    if(integrada){
      try{
        localStorage.setItem("efi_integrado", "true");
        localStorage.setItem("fibra_efi_integrado", "true");
        localStorage.setItem("efi_configurado", "true");
        if(backend && backend.conta) localStorage.setItem("fibra_efi_conta_ativa", JSON.stringify(backend.conta));
      }catch(e){}
    }

    window.__EFI_INTEGRADA__ = integrada;
    return integrada;
  }

  window.atualizarStatusEfiGlobal = atualizarStatusEfiGlobal;
  window.marcarEfiIntegradoGlobal = function(conta){
    try{
      localStorage.setItem("efi_integrado", "true");
      localStorage.setItem("fibra_efi_integrado", "true");
      localStorage.setItem("efi_configurado", "true");
      if(conta) localStorage.setItem("fibra_efi_conta_ativa", JSON.stringify(conta));
    }catch(e){}
    window.__EFI_INTEGRADA__ = true;
  };

  document.addEventListener("DOMContentLoaded", function(){
    atualizarStatusEfiGlobal();
  });
})();
