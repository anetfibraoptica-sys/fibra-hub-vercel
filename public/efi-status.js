
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

  function marcarIntegrado(conta){
    try{
      localStorage.setItem("efi_integrado", "true");
      localStorage.setItem("fibra_efi_integrado", "true");
      localStorage.setItem("efi_configurado", "true");
      if(conta) localStorage.setItem("fibra_efi_conta_ativa", JSON.stringify(conta));
    }catch(e){}

    const textoOk = "Efí integrada";

    // IDs/classes mais comuns.
    document.querySelectorAll("#efiStatus,#statusEfi,#statusIntegracaoEfi,[data-efi-status],.efi-status,.status-efi").forEach(function(el){
      el.textContent = textoOk;
      el.classList.remove("badge-off","status-off","erro","danger","red");
      el.classList.add("badge-on","status-on","ok","success");
      el.style.color = "#22c55e";
    });

    // Qualquer elemento que esteja dizendo não integrado.
    Array.from(document.querySelectorAll("span,div,p,strong,b,small,td,th,button")).forEach(function(el){
      const t = (el.textContent || "").toLowerCase();
      if((t.includes("efi") || t.includes("efí")) && (t.includes("não integrado") || t.includes("nao integrado") || t.includes("não integrada") || t.includes("nao integrada"))){
        el.textContent = textoOk;
        el.classList.remove("badge-off","status-off","erro","danger","red");
        el.classList.add("badge-on","status-on","ok","success");
        el.style.color = "#22c55e";
      }
    });

    document.querySelectorAll(".efi-nao-integrado,.aviso-efi-nao-integrado,.efi-not-integrated").forEach(function(el){
      el.style.display = "none";
    });

    document.querySelectorAll(".efi-integrado-only,.efi-integrated-only").forEach(function(el){
      el.style.display = "";
    });
  }

  function marcarNaoIntegrado(){
    if(temEfiLocal()){
      marcarIntegrado(null);
    }
  }

  async function atualizarStatusEfiGlobal(){
    if(temEfiLocal()){
      marcarIntegrado(null);
    }

    const backend = await consultarBackend();
    if(backend && backend.integrada){
      marcarIntegrado(backend.conta || null);
    }else{
      marcarNaoIntegrado();
    }
  }

  window.atualizarStatusEfiGlobal = atualizarStatusEfiGlobal;
  window.marcarEfiIntegradoGlobal = function(conta){
    marcarIntegrado(conta || null);
  };

  document.addEventListener("DOMContentLoaded", function(){
    atualizarStatusEfiGlobal();
    setTimeout(atualizarStatusEfiGlobal, 500);
    setTimeout(atualizarStatusEfiGlobal, 1500);
    setTimeout(atualizarStatusEfiGlobal, 3500);
  });

  // Se outra função recriar tabela/card depois, revalida.
  setInterval(function(){
    if(temEfiLocal()) marcarIntegrado(null);
  }, 2000);
})();
