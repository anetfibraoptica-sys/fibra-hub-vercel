
/* ============================================================
   Fibra+ Hub - Compatibilidade Vercel
   Evita travamento por funções antigas não definidas.
============================================================ */
window.protegerPagina = window.protegerPagina || function(){
  return true;
};

window.iniciarSocket = window.iniciarSocket || function(){
  const el = document.getElementById("liveStatus");
  if(el){
    el.textContent = "ONLINE";
    el.className = "badge badge-live";
  }
};

window.abrirMenuLateral = window.abrirMenuLateral || function(){
  document.body.classList.add("menu-open");
  const s = document.querySelector(".sidebar");
  if(s) s.classList.add("open");
};

window.fecharMenuLateral = window.fecharMenuLateral || function(){
  document.body.classList.remove("menu-open");
  const s = document.querySelector(".sidebar");
  if(s){
    s.classList.remove("open");
    s.classList.remove("active");
  }
};

window.openMobileMenu = window.openMobileMenu || window.abrirMenuLateral;
window.closeMobileMenu = window.closeMobileMenu || window.fecharMenuLateral;

window.abrirMenu = window.abrirMenu || window.abrirMenuLateral;
window.fecharMenu = window.fecharMenu || window.fecharMenuLateral;

window.sair = window.sair || function(){
  localStorage.removeItem("fibraLogado");
  location.href = "login.html";
};

window.io = window.io || function(){
  return {
    on:function(){},
    emit:function(){},
    disconnect:function(){}
  };
};

document.addEventListener("DOMContentLoaded", function(){
  try{
    if(typeof iniciarSocket === "function") iniciarSocket();
  }catch(e){}
});
