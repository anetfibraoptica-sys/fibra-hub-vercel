/* Fix página Usuários */
(function(){
  document.addEventListener("DOMContentLoaded", function(){
    document.body.style.display = "block";
    document.body.style.visibility = "visible";
    document.body.classList.remove("login-body");
    const main = document.querySelector(".content,.main");
    if(main){ main.style.minHeight = "100vh"; }
  });
  window.addEventListener("error", function(e){
    console.error("Erro na página usuários:", e.message);
    const tb = document.getElementById("tabelaUsuariosPainel");
    if(tb){ tb.innerHTML = '<tr><td colspan="5">Erro na página: '+e.message+'</td></tr>'; }
  });
})();
