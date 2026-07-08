
(function(){
  function norm(v){
    return String(v || "").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
  }

  function texto(el){ return (el && el.textContent || "").trim(); }

  function acharCardPorLabel(labelTexto){
    const alvo = norm(labelTexto);
    const candidatos = Array.from(document.querySelectorAll("div,section,article,td,li"));
    return candidatos.find(function(card){
      const childrenText = Array.from(card.children || []).map(c => norm(c.textContent));
      return childrenText.some(t => t === alvo) || norm(card.textContent).startsWith(alvo);
    });
  }

  function getCampoPorLabel(labelTexto){
    const alvo = norm(labelTexto);
    const candidatos = Array.from(document.querySelectorAll("label,strong,b,span,p,div,td,th"));

    const label = candidatos.find(function(el){
      return norm(el.textContent) === alvo;
    });

    if(!label) return null;

    const card = label.closest("div,section,article,td,li") || label.parentElement;
    if(!card) return null;

    // caso tenha elemento marcado como valor
    const valorMarcado = card.querySelector(".valor,.value,.resumo-value,.boleto-value,span:last-child,p:last-child");
    if(valorMarcado && norm(valorMarcado.textContent) !== alvo) return valorMarcado;

    // procura irmão depois do label
    let n = label.nextElementSibling;
    while(n){
      if(norm(n.textContent) && norm(n.textContent) !== alvo) return n;
      n = n.nextElementSibling;
    }

    // fallback: último filho com texto diferente do label
    const filhos = Array.from(card.querySelectorAll("span,p,div,strong,b")).filter(function(x){
      const t = norm(x.textContent);
      return t && t !== alvo;
    });

    return filhos.length ? filhos[filhos.length - 1] : null;
  }

  function getValor(label){
    const campo = getCampoPorLabel(label);
    return texto(campo);
  }

  function setCampo(label, valor){
    const campo = getCampoPorLabel(label);
    if(campo){
      campo.textContent = valor || "—";
      return true;
    }

    // se não encontrou, tenta localizar card inteiro e substituir último nó textual
    const card = acharCardPorLabel(label);
    if(card){
      const divs = Array.from(card.querySelectorAll("div,span,p")).filter(x => norm(x.textContent) && norm(x.textContent) !== norm(label));
      if(divs.length){
        divs[divs.length-1].textContent = valor || "—";
        return true;
      }
    }

    return false;
  }

  function dadosBoletoAberto(){
    return {
      numero: getValor("Número") || getValor("Numero") || getValor("Nº") || "",
      valor: getValor("Valor do boleto").replace(/[^\d,.-]/g,""),
      valorPago: getValor("Valor pago").replace(/[^\d,.-]/g,""),
      vencimento: getValor("Vencimento"),
      emissao: getValor("Emissão") || getValor("Emissao"),
      cliente: getValor("Cliente"),
      status: getValor("Status")
    };
  }

  async function consultarBoletoAbertoNaEfi(){
    const dados = dadosBoletoAberto();

    // Não cria status novo no layout. Só altera o campo já existente "Situação na Efí".
    if(!dados.numero && !dados.vencimento && !dados.cliente) return;

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
        return norm(b.textContent).includes("segunda via");
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
    const t = norm(e.target && e.target.textContent || "");
    if(t.includes("boleto") || t.includes("segunda via") || t.includes("detalhe") || t.includes("cobrança") || t.includes("cobranca")){
      setTimeout(consultarBoletoAbertoNaEfi, 300);
      setTimeout(consultarBoletoAbertoNaEfi, 900);
      setTimeout(consultarBoletoAbertoNaEfi, 1800);
    }
  }, true);

  const obs = new MutationObserver(function(){
    const sit = getValor("Situação na Efí");
    if(norm(sit).includes("aguardando integracao") || norm(sit).includes("aguardando integração")){
      consultarBoletoAbertoNaEfi();
    }
  });

  document.addEventListener("DOMContentLoaded", function(){
    obs.observe(document.body, {childList:true, subtree:true, characterData:true});
    setTimeout(consultarBoletoAbertoNaEfi, 1000);
  });
})();
