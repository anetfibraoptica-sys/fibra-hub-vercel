
(function(){
  async function atualizarStatusEfiGlobal(){
    try{
      const resp = await fetch("/api/efi/status", {cache:"no-store"});
      const json = await resp.json();

      if(json && json.ok && json.integrada){
        localStorage.setItem("efi_integrado", "true");
        localStorage.setItem("fibra_efi_integrado", "true");
        localStorage.setItem("efi_configurado", "true");
        localStorage.setItem("fibra_efi_conta_ativa", JSON.stringify(json.conta || {}));

        document.querySelectorAll("[data-efi-status], #efiStatus, #statusEfi, .efi-status").forEach(function(el){
          el.textContent = "Efí integrada";
          el.classList.remove("badge-off","status-off","erro");
          el.classList.add("badge-on","status-on","ok");
        });

        document.querySelectorAll(".efi-nao-integrado, .aviso-efi-nao-integrado").forEach(function(el){
          el.style.display = "none";
        });

        document.querySelectorAll(".efi-integrado-only").forEach(function(el){
          el.style.display = "";
        });
      }
    }catch(e){}
  }

  window.atualizarStatusEfiGlobal = atualizarStatusEfiGlobal;
  document.addEventListener("DOMContentLoaded", function(){
    atualizarStatusEfiGlobal();
    setTimeout(atualizarStatusEfiGlobal, 1000);
    setTimeout(atualizarStatusEfiGlobal, 3000);
  });
})();
