
(function(){
  function norm(v){
    return String(v || "").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
  }

  function texto(el){ return (el && el.textContent || "").trim(); }

  function lerConfigEfi(){
    try{
      const c1 = JSON.parse(localStorage.getItem("fibra_efi_conta_1") || "null");
      if(c1 && (c1.ClientId || c1.clientId) && (c1.ClientSecret || c1.clientSecret)) return c1;
    }catch(e){}

    try{
      const contas = JSON.parse(localStorage.getItem("fibra_efi_contas") || "[]");
      if(Array.isArray(contas)){
        const c = contas.find(x => x && (x.ClientId || x.clientId) && (x.ClientSecret || x.clientSecret));
        if(c) return c;
      }
    }catch(e){}

    return null;
  }

  function getCampoPorLabel(labelTexto){
    const alvo = norm(labelTexto);

    const cards = Array.from(document.querySelectorAll("div,section,article,td,li"));
    for(const card of cards){
      const filhos = Array.from(card.children || []);
      if(filhos.length < 2) continue;

      const label = filhos.find(f => norm(f.textContent) === alvo);
      if(label){
        const vals = filhos.filter(f => f !== label && norm(f.textContent));
        if(vals.length) return vals[vals.length - 1];
      }
    }

    const all = Array.from(document.querySelectorAll("label,strong,b,span,p,div,td,th"));
    const label = all.find(el => norm(el.textContent) === alvo);
    if(!label) return null;

    let n = label.nextElementSibling;
    while(n){
      if(norm(n.textContent) && norm(n.textContent) !== alvo) return n;
      n = n.nextElementSibling;
    }

    const card = label.closest("div,section,article,td,li") || label.parentElement;
    if(card){
      const vals = Array.from(card.querySelectorAll("span,p,div,strong,b")).filter(x => {
        const t = norm(x.textContent);
        return t && t !== alvo;
      });
      if(vals.length) return vals[vals.length-1];
    }

    return null;
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
    return false;
  }

  function dadosBoletoAberto(){
    return {
      numero: getValor("Número") || getValor("Numero") || getValor("Nº") || "",
      cliente: getValor("Cliente"),
      categoria: getValor("Categoria"),
      descricao: getValor("Descrição") || getValor("Descricao"),
      valor: getValor("Valor do boleto").replace(/[^\d,.-]/g,""),
      valorPago: getValor("Valor pago").replace(/[^\d,.-]/g,""),
      emissao: getValor("Emissão") || getValor("Emissao"),
      vencimento: getValor("Vencimento"),
      status: getValor("Status"),
      efiConfig: lerConfigEfi()
    };
  }

  async function consultarBoletoAbertoNaEfi(){
    const dados = dadosBoletoAberto();

    if(!dados.numero && !dados.vencimento && !dados.cliente) return;

    if(!dados.efiConfig){
      setCampo("Situação na Efí", "Efí sem credenciais salvas");
      return;
    }

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

      setCampo("Situação na Efí", json.situacao_efi || (json.encontrado ? "Registrado na Efí" : "Integrado na Efí - boleto não localizado"));
      setCampo("Linha Digitável", json.linha_digitavel || "—");
      setCampo("Pix Copia e Cola", json.pix_copia_cola || "—");

      const btn2via = Array.from(document.querySelectorAll("button,a")).find(b => norm(b.textContent).includes("segunda via"));
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
    if(t.includes("boleto") || t.includes("segunda via") || t.includes("detalhe") || t.includes("cobranca") || t.includes("cobrança")){
      setTimeout(consultarBoletoAbertoNaEfi, 300);
      setTimeout(consultarBoletoAbertoNaEfi, 1000);
      setTimeout(consultarBoletoAbertoNaEfi, 2000);
    }
  }, true);

  const obs = new MutationObserver(function(){
    const sit = getValor("Situação na Efí");
    if(norm(sit).includes("aguardando integracao") || norm(sit).includes("aguardando integração") || norm(sit) === "—"){
      consultarBoletoAbertoNaEfi();
    }
  });

  document.addEventListener("DOMContentLoaded", function(){
    obs.observe(document.body, {childList:true, subtree:true, characterData:true});
    setTimeout(consultarBoletoAbertoNaEfi, 1000);
  });
})();
