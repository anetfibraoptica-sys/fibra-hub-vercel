
(function(){
  function texto(el){ return (el && el.textContent || "").trim(); }

  function getCampoPorLabel(labelTexto){
    const alvo = labelTexto.toLowerCase();
    const candidatos = Array.from(document.querySelectorAll("div,span,p,strong,b,label,td,th"));
    const label = candidatos.find(function(el){
      return (el.textContent || "").trim().toLowerCase() === alvo;
    });

    if(!label) return null;

    const card = label.closest("div");
    if(!card) return null;

    const filhos = Array.from(card.querySelectorAll("span,p,div,strong,b"));
    const valores = filhos.filter(function(x){
      const t = (x.textContent || "").trim();
      return t && t.toLowerCase() !== alvo;
    });

    return valores.length ? valores[valores.length - 1] : null;
  }

  function setCampo(label, valor){
    const campo = getCampoPorLabel(label);
    if(campo) campo.textContent = valor || "—";
  }

  function dadosBoletoAberto(){
    const numero = texto(getCampoPorLabel("Número"));
    const valor = texto(getCampoPorLabel("Valor do boleto")).replace(/[^\d,.-]/g,"");
    const vencimento = texto(getCampoPorLabel("Vencimento"));
    const cliente = texto(getCampoPorLabel("Cliente"));
    return { numero, valor, vencimento, cliente };
  }

  async function consultarBoletoAbertoNaEfi(){
    const dados = dadosBoletoAberto();

    if(!dados.numero && !dados.vencimento) return;

    setCampo("Situação na Efí", "Consultando Efí...");

    try{
      const resp = await fetch("/api/efi/boleto-importado/consultar", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify(dados)
      });
      const json = await resp.json();

      if(!resp.ok || !json.ok){
        setCampo("Situação na Efí", "Erro na consulta Efí");
        return;
      }

      setCampo("Situação na Efí", json.situacao_efi || (json.encontrado ? "Registrado na Efí" : "Não encontrado na Efí"));
      setCampo("Linha Digitável", json.linha_digitavel || "—");
      setCampo("Pix Copia e Cola", json.pix_copia_cola || "—");

      const btn2via = Array.from(document.querySelectorAll("button,a")).find(function(b){
        return (b.textContent || "").toLowerCase().includes("segunda via");
      });

      if(btn2via && json.link_boleto){
        btn2via.onclick = function(e){
          e.preventDefault();
          window.open(json.link_boleto, "_blank");
        };
      }
    }catch(e){
      setCampo("Situação na Efí", "Erro na consulta Efí");
    }
  }

  window.consultarBoletoAbertoNaEfi = consultarBoletoAbertoNaEfi;

  document.addEventListener("click", function(e){
    const txt = (e.target && e.target.textContent || "").toLowerCase();
    if(txt.includes("boleto") || txt.includes("segunda via") || txt.includes("detalhe")){
      setTimeout(consultarBoletoAbertoNaEfi, 500);
      setTimeout(consultarBoletoAbertoNaEfi, 1500);
    }
  }, true);

  const obs = new MutationObserver(function(){
    const sit = getCampoPorLabel("Situação na Efí");
    if(sit && (sit.textContent || "").toLowerCase().includes("aguardando integração")){
      consultarBoletoAbertoNaEfi();
    }
  });

  document.addEventListener("DOMContentLoaded", function(){
    obs.observe(document.body, {childList:true, subtree:true});
    setTimeout(consultarBoletoAbertoNaEfi, 1000);
  });
})();
