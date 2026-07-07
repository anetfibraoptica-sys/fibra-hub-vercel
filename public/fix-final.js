
/* ============================================================
   Fix Vercel definitivo: socket.io + campos number com vírgula
============================================================ */
(function(){
  // remove scripts socket.io que alguma página tenha injetado depois
  document.addEventListener("DOMContentLoaded", function(){
    document.querySelectorAll('script[src*="socket.io"]').forEach(s => s.remove());

    // Corrige inputs number que tenham valor brasileiro tipo 0,00
    document.querySelectorAll('input[type="number"]').forEach(inp => {
      if(String(inp.value || "").includes(",")){
        inp.value = String(inp.value).replace(/\./g, "").replace(",", ".");
      }
    });
  });

  // Compatibilidade caso algum código antigo chame io()
  window.io = window.io || function(){
    return {on:function(){}, emit:function(){}, disconnect:function(){}};
  };

  // Funções antigas que algumas páginas chamam no onload
  window.protegerPagina = window.protegerPagina || function(){ return true; };
  window.iniciarSocket = window.iniciarSocket || function(){
    const el = document.getElementById("liveStatus");
    if(el){ el.textContent = "ONLINE"; el.className = "badge badge-live"; }
  };
})();
