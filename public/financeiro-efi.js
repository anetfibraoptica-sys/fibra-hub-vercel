
let efiCobrancas = [];
let efiSelecionado = null;

function efiMoney(v){return Number(v||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});}
function efiHoje(){return new Date().toISOString().slice(0,10);}
function efiMaisDias(dias){let d=new Date();d.setDate(d.getDate()+dias);return d.toISOString().slice(0,10);}
function efiVencido(c){if(c.status==="pago")return false;let h=new Date();h.setHours(0,0,0,0);let d=new Date((c.vencimento||efiHoje())+"T00:00:00");return d<h;}
function efiStatusTexto(c){if(c.status==="pago")return"✅ Pago";if(c.status==="vencido"||efiVencido(c))return"🔴 Vencido";if(c.status==="cancelado")return"⚫ Cancelado";return"🟡 Aberto";}
function salvarConfigEfi(){let cfg={ambiente:val("efiAmbiente"),clientId:val("efiClientId"),clientSecret:val("efiClientSecret"),pixKey:val("efiPixKey"),certificado:val("efiCertificado"),webhook:val("efiWebhookUrl")};localStorage.setItem("fibraEfiConfig",JSON.stringify(cfg));alert("Configuração Efí salva localmente. Integração real será ligada depois.");}
function carregarConfigEfi(){try{let cfg=JSON.parse(localStorage.getItem("fibraEfiConfig")||"{}");Object.keys(cfg).forEach(k=>{});if(cfg.ambiente)document.getElementById("efiAmbiente").value=cfg.ambiente;if(cfg.clientId)document.getElementById("efiClientId").value=cfg.clientId;if(cfg.clientSecret)document.getElementById("efiClientSecret").value=cfg.clientSecret;if(cfg.pixKey)document.getElementById("efiPixKey").value=cfg.pixKey;if(cfg.certificado)document.getElementById("efiCertificado").value=cfg.certificado;if(cfg.webhook)document.getElementById("efiWebhookUrl").value=cfg.webhook;}catch(e){}}
function val(id){let el=document.getElementById(id);return el?el.value:"";}
function testarConexaoEfi(){document.getElementById("efiStatus").textContent="Aguardando API";alert("A conexão real com Efí será ativada na próxima etapa com Client ID, Secret e certificado .p12.");}
function carregarLocalEfi(){try{let s=localStorage.getItem("fibraEfiCobrancas");if(s){efiCobrancas=JSON.parse(s);return true;}}catch(e){}return false;}
function salvarFinanceiroEfi(){localStorage.setItem("fibraEfiCobrancas",JSON.stringify(efiCobrancas));atualizarResumoEfi();renderEfi();alert("Financeiro Efí salvo.");}
function salvarSilenciosoEfi(){localStorage.setItem("fibraEfiCobrancas",JSON.stringify(efiCobrancas));atualizarResumoEfi();renderEfi();}
async function carregarClientesOnlineEfi(){try{let r=await fetch("/api/servidores?_="+Date.now());let dados=await r.json();let serv=Array.isArray(dados)?dados:Object.values(dados||{});let nomes=[];serv.forEach(s=>(s.clientes||[]).forEach(c=>{if(c.nome)nomes.push(c.nome)}));let unicos=[...new Set(nomes)].sort();efiCobrancas=unicos.map(nome=>({cliente:nome,plano:"PPPoE",valor:100,vencimento:efiMaisDias(5),forma:"PIX + Boleto",status:"aberto",txid:"",boleto:""}));salvarSilenciosoEfi();}catch(e){alert("Não foi possível importar clientes online agora.");}}
async function carregarFinanceiroEfi(){if(typeof protegerPagina==="function")protegerPagina();carregarConfigEfi();let tem=carregarLocalEfi();if(!tem)await carregarClientesOnlineEfi();atualizarResumoEfi();renderEfi();}
function atualizarResumoEfi(){let recebido=0,pix=0,boletos=0,aberto=0,vencidos=0,previsto=0;efiCobrancas.forEach(c=>{let valor=Number(c.valor||0);previsto+=valor;if(c.status==="pago"){recebido+=valor;if((c.forma||"").includes("PIX"))pix++;if((c.forma||"").includes("Boleto"))boletos++;}else{aberto+=valor;}if(efiVencido(c))vencidos++;});setTxt("efiRecebidoMes",efiMoney(recebido));setTxt("efiPixRecebidos",pix);setTxt("efiBoletosPagos",boletos);setTxt("efiEmAberto",efiMoney(aberto));setTxt("efiVencidos",vencidos);setTxt("efiReceitaPrevista",efiMoney(previsto));}
function setTxt(id,v){let el=document.getElementById(id);if(el)el.textContent=v;}
function renderEfi(){let tb=document.getElementById("efiTabela");if(!tb)return;if(!efiCobrancas.length){tb.innerHTML='<tr><td colspan="7">Nenhuma cobrança cadastrada.</td></tr>';return;}tb.innerHTML=efiCobrancas.map((c,i)=>`<tr onclick="selecionarCobrancaEfi(${i})"><td><input value="${c.cliente||""}" onchange="editarEfi(${i},'cliente',this.value)"></td><td><input value="${c.plano||""}" onchange="editarEfi(${i},'plano',this.value)"></td><td><input type="number" value="${c.valor||0}" onchange="editarEfi(${i},'valor',this.value)"></td><td><input type="date" value="${c.vencimento||efiHoje()}" onchange="editarEfi(${i},'vencimento',this.value)"></td><td><select onchange="editarEfi(${i},'forma',this.value)"><option ${c.forma==='PIX'?'selected':''}>PIX</option><option ${c.forma==='Boleto'?'selected':''}>Boleto</option><option ${c.forma==='PIX + Boleto'?'selected':''}>PIX + Boleto</option></select></td><td><b>${efiStatusTexto(c)}</b></td><td class="efi-buttons"><button onclick="event.stopPropagation(); marcarPagoEfi(${i})">Pago</button><button onclick="event.stopPropagation(); gerarPixEfi(${i})">PIX</button><button onclick="event.stopPropagation(); gerarBoletoEfi(${i})">Boleto</button><button onclick="event.stopPropagation(); cancelarEfi(${i})">Cancelar</button><button onclick="event.stopPropagation(); removerEfi(${i})">Excluir</button></td></tr>`).join("");filtrarFinanceiroEfi();}
function editarEfi(i,campo,valor){if(!efiCobrancas[i])return;efiCobrancas[i][campo]=campo==="valor"?Number(valor||0):valor;localStorage.setItem("fibraEfiCobrancas",JSON.stringify(efiCobrancas));atualizarResumoEfi();}
function novaCobrancaEfi(){efiCobrancas.push({cliente:"novo-cliente",plano:"PPPoE",valor:100,vencimento:efiMaisDias(5),forma:"PIX + Boleto",status:"aberto",txid:"",boleto:""});salvarSilenciosoEfi();}
function marcarPagoEfi(i){efiCobrancas[i].status="pago";salvarSilenciosoEfi();}
function cancelarEfi(i){efiCobrancas[i].status="cancelado";salvarSilenciosoEfi();}
function removerEfi(i){if(!confirm("Excluir cobrança?"))return;efiCobrancas.splice(i,1);salvarSilenciosoEfi();}
function gerarPixEfi(i){selecionarCobrancaEfi(i);efiCobrancas[i].txid="DEMO"+Date.now();localStorage.setItem("fibraEfiCobrancas",JSON.stringify(efiCobrancas));document.getElementById("efiResultadoPagamento").innerHTML=`<b>PIX preparado para Efí</b><br>Cliente: ${efiCobrancas[i].cliente}<br>Valor: ${efiMoney(efiCobrancas[i].valor)}<br><code>PIX COPIA E COLA SERÁ GERADO PELA API EFÍ</code>`;}
async function gerarBoletoEfi(i){
  alert("⏳ Gerando boleto, aguarde...");
  selecionarCobrancaEfi(i);
  const c=efiCobrancas[i];
  if(!c) return;
  const payload={
    numero:Date.now(),
    cliente_id:c.cliente_id||c.clienteId||null,
    clienteId:c.cliente_id||c.clienteId||null,
    nome:c.cliente||"",
    cliente:c.cliente||"",
    login:c.login||c.loginPppoe||"",
    loginPppoe:c.login||c.loginPppoe||"",
    cpf:c.cpf||"",
    cpfCnpj:c.cpfCnpj||"",
    valor:Number(c.valor||0),
    total:Number(c.valor||0),
    vencimento:c.vencimento||efiHoje(),
    emissao:efiHoje(),
    descricao:c.plano||"Mensalidade",
    categoria:"Mensalidade",
    status:"pendente",
    origem:"Painel Fibra+ Hub Efí",
    conta:1
  };
  try{
    const resp=await fetch("/api/efi/boleto/criar",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    const json=await resp.json();
    if(!resp.ok || !json.ok) throw new Error(json.erro||json.mensagem||"Erro ao criar boleto");
    c.boleto=json.boleto||json.link_boleto||json.charge_id||"GERADO";
    c.efi=json;
    salvarSilenciosoEfi();
    document.getElementById("efiResultadoPagamento").innerHTML=`<b>✅ Boleto gerado na Efí</b><br>Cliente: ${c.cliente}<br>Valor: ${efiMoney(c.valor)}<br>${json.link_boleto?`<a target="_blank" href="${json.link_boleto}">Abrir boleto</a>`:"Cobrança criada com sucesso"}`;
  }catch(e){
    alert("Erro ao gerar boleto na Efí: "+e.message);
  }
}
function selecionarCobrancaEfi(i){efiSelecionado=i;let c=efiCobrancas[i];if(!c)return;setTxt("prevCliente",c.cliente);setTxt("prevPlano",c.plano);setTxt("prevValor",efiMoney(c.valor));setTxt("prevVencimento",c.vencimento);setTxt("prevStatus",efiStatusTexto(c));}
function gerarPixEfiDemo(){if(efiSelecionado===null)return alert("Selecione uma cobrança.");gerarPixEfi(efiSelecionado);}
function gerarBoletoEfiDemo(){if(efiSelecionado===null)return alert("Selecione uma cobrança.");gerarBoletoEfi(efiSelecionado);}
function gerarPixBoletoEfiDemo(){if(efiSelecionado===null)return alert("Selecione uma cobrança.");gerarPixEfi(efiSelecionado);gerarBoletoEfi(efiSelecionado);}
function filtrarFinanceiroEfi(){let input=document.getElementById("buscaFinanceiroEfi");let tb=document.getElementById("efiTabela");if(!input||!tb)return;let termo=input.value.trim().toLowerCase();Array.from(tb.querySelectorAll("tr")).forEach(tr=>{let txt=(tr.innerText||"").toLowerCase();tr.style.display=!termo||txt.includes(termo)?"":"none";});}


async function salvarConfiguracaoEfiConta(numero){
  try{
    const n=numero||1;
    const conta={
      nome:(document.getElementById("efi"+n+"NomeConta")||{}).value || ("Efí "+n),
      titular:(document.getElementById("efi"+n+"Documento")||{}).value || null,
      ambiente:(document.getElementById("efi"+n+"Ambiente")||{}).value || "producao",
      clientId:(document.getElementById("efi"+n+"ClientId")||{}).value || null,
      clientSecret:(document.getElementById("efi"+n+"ClientSecret")||{}).value || null,
      webhook:(document.getElementById("efi"+n+"Webhook")||{}).value || null
    };
    if(window.FibraDB && FibraDB.salvarContaEfi){
      await FibraDB.salvarContaEfi(conta);
    }
    alert("Conta Efí salva com sucesso.");
  }catch(e){
    alert("Erro ao salvar conta Efí: "+e.message);
  }
}
