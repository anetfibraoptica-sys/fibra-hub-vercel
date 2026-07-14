
function filtrarClientesPppoe(){
  const input = document.getElementById("buscaPppoe");
  const tbody = document.getElementById("clientesTabela");
  const resultado = document.getElementById("resultadoBuscaPppoe");
  if(!input || !tbody) return;
  const termo = input.value.trim().toLowerCase();
  const linhas = Array.from(tbody.querySelectorAll("tr"));
  let total = 0;
  let visiveis = 0;
  linhas.forEach(linha => {
    if(linha.querySelector("td[colspan]")) return;
    total++;
    const texto = (linha.innerText || "").toLowerCase();
    const mostrar = !termo || texto.includes(termo);
    linha.style.display = mostrar ? "" : "none";
    if(mostrar) visiveis++;
  });
  if(resultado){
    resultado.textContent = termo ? `${visiveis} de ${total} encontrados` : `${total} clientes`;
  }
}
document.addEventListener("DOMContentLoaded", () => {
  setTimeout(filtrarClientesPppoe, 500);
  setTimeout(filtrarClientesPppoe, 1500);
});
setInterval(filtrarClientesPppoe, 3000);
