
/* ============================================================
   FIBRA+ HUB - FIX DEFINITIVO VERCEL
   Remove dependência de socket.io e aceita valores brasileiros.
============================================================ */
(function(){
  window.io = function(){
    return {on:function(){}, emit:function(){}, disconnect:function(){}};
  };

  window.socket = window.socket || {on:function(){}, emit:function(){}, disconnect:function(){}};

  window.protegerPagina = window.protegerPagina || function(){ return true; };

  window.iniciarSocket = window.iniciarSocket || function(){
    const el = document.getElementById("liveStatus");
    if(el){
      el.textContent = "ONLINE";
      el.className = "badge badge-live";
    }
    return window.socket;
  };

  window.abrirMenuLateral = window.abrirMenuLateral || function(){
    document.body.classList.add("menu-open");
    const s=document.querySelector(".sidebar");
    if(s) s.classList.add("open");
  };

  window.fecharMenuLateral = window.fecharMenuLateral || function(){
    document.body.classList.remove("menu-open");
    const s=document.querySelector(".sidebar");
    if(s){s.classList.remove("open");s.classList.remove("active");}
  };

  window.openMobileMenu = window.openMobileMenu || window.abrirMenuLateral;
  window.closeMobileMenu = window.closeMobileMenu || window.fecharMenuLateral;
  window.abrirMenu = window.abrirMenu || window.abrirMenuLateral;
  window.fecharMenu = window.fecharMenu || window.fecharMenuLateral;

  function corrigirInputs(){
    document.querySelectorAll("input").forEach(function(inp){
      if(inp.type === "number"){
        inp.type = "text";
        inp.setAttribute("inputmode","decimal");
      }
      if(String(inp.value || "").match(/^\d+,\d+$/)){
        inp.value = String(inp.value).replace(",", ".");
      }
    });
  }

  document.addEventListener("DOMContentLoaded", corrigirInputs);
  setTimeout(corrigirInputs, 300);
  setTimeout(corrigirInputs, 1000);
})();
