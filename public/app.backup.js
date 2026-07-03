



function abrirMenu(){document.querySelector(".sidebar").classList.add("open");document.querySelector(".overlay").classList.add("show");}
function fecharMenu(){document.querySelector(".sidebar").classList.remove("open");document.querySelector(".overlay").classList.remove("show");}
const histDownload=[],histUpload=[];const maxPontos=36;let socketConectado=false;
function numero(valor){if(valor===undefined||valor===null)return 0;let txt=String(valor).replace("Mbps","").replace("Mb","").replace("M","").replace("bps","").replace("%","").replace(",",".").trim();return parseFloat(txt)||0;}
async function carregarDashboard(){try{const r=await fetch("/api/latest");const dados=await r.json();aplicarDados(dados);}catch(e){setText("mkStatus","ERRO");}}
function aplicarDados(dados){if(!dados)return;const atualizado=dados.atualizadoEm?new Date(dados.atualizadoEm).toLocaleString("pt-BR"):"Aguardando envio";const down=numero(dados.download);const up=numero(dados.upload);const cpu=Number(dados.cpuMedia||0);setText("mkStatus",dados.servidoresOnline>0?"ONLINE":"AGUARDANDO");setText("servidoresOnline",(dados.servidoresOnline||0)+"/"+(dados.totalServidores||2));setText("pppoeTotal",dados.pppoeOnline||0);setText("clientesOffline",0);setText("mkCpu",cpu+"%");setText("mkNome","COLÔNIA + ARMANDO");setText("mkUptime","Multi-servidor");setText("mkAtualizado",atualizado);setText("downloadTexto",down+" Mbps");setText("uploadTexto",up+" Mbps");adicionarHistorico(down,up);desenharGrafico();carregarServidores(dados.servidores||{});carregarClientesOnline(dados.clientes||[]);carregarReceita();const live=document.getElementById("liveStatus");if(live){live.textContent=socketConectado?"AO VIVO":"CONSULTANDO";live.className="badge "+(socketConectado?"badge-live pulse":"badge-off");}}
function adicionarHistorico(download,upload){histDownload.push(download);histUpload.push(upload);if(histDownload.length>maxPontos){histDownload.shift();histUpload.shift();}}
function desenharGrafico(){const canvas=document.getElementById("graficoTempoReal");if(!canvas)return;const ctx=canvas.getContext("2d");const ratio=window.devicePixelRatio||1;canvas.width=canvas.offsetWidth*ratio;canvas.height=canvas.offsetHeight*ratio;ctx.scale(ratio,ratio);const largura=canvas.offsetWidth,altura=canvas.offsetHeight;ctx.clearRect(0,0,largura,altura);ctx.strokeStyle="rgba(255,255,255,.08)";ctx.lineWidth=1;for(let i=0;i<6;i++){const y=28+i*((altura-58)/5);ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(largura,y);ctx.stroke();}const maxTrafego=Math.max(10,...histDownload,...histUpload);desenharLinha(ctx,histDownload,largura,altura,maxTrafego,"#2f83ff",3);desenharLinha(ctx,histUpload,largura,altura,maxTrafego,"#22c55e",3);ctx.fillStyle="rgba(255,255,255,.78)";ctx.font="12px Arial";ctx.fillText("Download total: "+(histDownload.at(-1)||0)+" Mbps",12,18);ctx.fillText("Upload total: "+(histUpload.at(-1)||0)+" Mbps",230,18);}
function desenharLinha(ctx,dados,largura,altura,maxValor,cor,espessura){if(dados.length<2)return;const margemX=14,margemY=34,areaW=largura-(margemX*2),areaH=altura-(margemY*2);ctx.beginPath();dados.forEach((valor,i)=>{const x=margemX+(i/(maxPontos-1))*areaW;const y=margemY+areaH-(valor/maxValor)*areaH;if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);});ctx.strokeStyle=cor;ctx.lineWidth=espessura;ctx.lineJoin="round";ctx.lineCap="round";ctx.shadowColor=cor;ctx.shadowBlur=12;ctx.stroke();ctx.shadowBlur=0;}
function carregarServidores(servidores){const box=document.getElementById("servidoresBox");if(!box)return;const lista=Object.values(servidores);box.innerHTML=lista.map(s=>`<div class="server-card"><div class="server-title"><span class="server-name">${s.nome||s.identity}</span><span class="status-pill ${s.online?'':'status-off'}">${s.online?'ONLINE':'OFFLINE'}</span></div><div class="server-row"><span>Clientes</span><b>${s.pppoeOnline||0}</b></div><div class="server-row"><span>CPU</span><b>${s.cpu||0}%</b></div><div class="server-row"><span>Uptime</span><b>${s.uptime||'--'}</b></div><div class="server-row"><span>Download</span><b>${s.download||'0 Mbps'}</b></div><div class="server-row"><span>Upload</span><b>${s.upload||'0 Mbps'}</b></div></div>`).join("");}
function carregarClientesOnline(clientes){const tbody=document.getElementById("clientesTabela");if(!tbody)return;if(!clientes.length){tbody.innerHTML="<tr><td colspan='6'>Aguardando lista de clientes...</td></tr>";return;}tbody.innerHTML=clientes.map(c=>`<tr><td>${c.nome||c.user||"--"}</td><td>${c.servidor||"--"}</td><td>${c.plano||"--"}</td><td>${c.ip||"--"}</td><td>${c.uptime||"--"}</td><td><span class="online">ONLINE</span></td></tr>`).join("");}
async function carregarClientesBanco(){
 const tbody=document.getElementById("clientesBancoTabela");
 if(!tbody)return;

 try{
  const r=await fetch("/api/clientes");
  const clientes=await r.json();

  if(!Array.isArray(clientes) || !clientes.length){
   tbody.innerHTML="<tr><td colspan='13'>Nenhum cliente cadastrado ainda.</td></tr>";
   return;
  }

  tbody.innerHTML=clientes.map(c=>`
   <tr>
    <td>${c.nome || "--"}</td>
    <td>${c.servidor || "--"}</td>
    <td>${c.telefone || "--"}</td>
    <td>${c.cep || "--"}</td>
    <td>${c.bairro || "--"}</td>
    <td>${c.numero || "--"}</td>
    <td>${c.complemento || "--"}</td>
    <td>${c.plano || "--"}</td>
    <td>${c.pppoe || "--"}</td>
    <td>${c.valor || "--"}</td>
    <td><span class="${c.status==="ativo"?"online":"offline"}">${c.status || "ativo"}</span></td>
    <td><button class="small-btn" onclick="verCliente(${c.id})">Ver</button><button class="small-btn" onclick="editarCliente(${c.id})">Editar</button><button class="small-btn" onclick="excluirCliente(${c.id})">Excluir</button></td>
   </tr>
  `).join("");

 }catch(e){
  tbody.innerHTML="<tr><td colspan='13'>Erro ao carregar clientes.</td></tr>";
 }
}


function getClienteForm(){
  return {
    servidor: val("servidorCliente"),
    nome: val("nome"),
    cpf: val("cpf"),
    telefone: val("telefone"),
    cep: val("cep"),
    endereco: val("endereco"),
    numero: val("numero"),
    complemento: val("complemento"),
    bairro: val("bairro"),
    referencia: val("referencia"),
    plano: val("plano"),
    pppoe: limparPPPoE(val("pppoe")),
    acessoRemoto: val("acessoRemoto"),
    senha: val("senha"),
    vencimento: val("vencimento"),
    valor: val("valor"),
    
    observacoes: val("observacoes")
  };
}

async function salvarCliente(){
  const cliente = getClienteForm();
  const editId = new URLSearchParams(window.location.search).get("id");
  const url = editId ? "/api/clientes/" + editId : "/api/clientes";
  const method = editId ? "PUT" : "POST";

  const r = await fetch(url,{method,headers:{"Content-Type":"application/json"},body:JSON.stringify(cliente)});
  const d = await r.json();

  if(d.ok){
    if(editId){
      if(d.migracaoErro){
        alert("Cliente atualizado, mas houve erro ao migrar no MikroTik: " + d.migracaoErro);
      } else if(d.migracao && d.migracao.migrado){
        alert("Cliente atualizado e migrado para o novo servidor.");
      } else {
        alert("Cliente atualizado com sucesso.");
      }
      window.location.href = "clientes.html";
      return;
    }

    if(d.pppoeCriado){
      alert("Cliente salvo e PPPoE criado no MikroTik.");
    } else {
      alert("Cliente salvo, mas PPPoE não foi criado: " + (d.pppoeErro || "verifique a API do MikroTik"));
    }
    document.querySelectorAll("input, textarea").forEach(i=>i.value="");
  } else {
    alert("Erro: " + (d.erro || "falha ao salvar"));
  }
}

async function carregarClienteParaEditar(){
  const id = new URLSearchParams(window.location.search).get("id");
  if(!id) return;

  const titulo = document.querySelector("h1");
  if(titulo) titulo.textContent = "Editar Cliente";

  const r = await fetch("/api/clientes/" + id);
  const c = await r.json();

  if(c.erro){
    alert(c.erro);
    return;
  }

  setVal("servidorCliente", c.servidor);
  setVal("nome", c.nome);
  setVal("cpf", c.cpf);
  setVal("telefone", c.telefone);
  setVal("cep", c.cep);
  setVal("endereco", c.endereco);
  setVal("numero", c.numero);
  setVal("complemento", c.complemento);
  setVal("bairro", c.bairro);
  setVal("referencia", c.referencia);
  setVal("plano", c.plano);
  setVal("pppoe", c.pppoe);
  setVal("acessoRemoto", c.acesso_remoto || c.acessoRemoto);
  setVal("senha", c.senha);
  setVal("vencimento", c.vencimento);
  setVal("valor", c.valor);
  
  setVal("observacoes", c.observacoes);
}

function setVal(id, valor){
  const el = document.getElementById(id);
  if(el) el.value = valor || "";
}

function verCliente(id){
  window.location.href = "cliente.html?id=" + id;
}

function editarCliente(id){
  window.location.href = "cadastro.html?id=" + id;
}

async function carregarClienteDetalhes(){
  const id = new URLSearchParams(window.location.search).get("id");
  const box = document.getElementById("clienteDetalhes");
  if(!id || !box) return;

  const r = await fetch("/api/clientes/" + id);
  const c = await r.json();

  if(c.erro){
    box.innerHTML = "<p>Cliente não encontrado.</p>";
    return;
  }

  box.innerHTML = `<div id="statusMikrotikCliente"></div>
    <div class="grid-2">
      <div class="panel">
        <h3>Dados do Cliente</h3>
        <p><b>Nome:</b> ${c.nome || "--"}</p>
        <p><b>CPF/CNPJ:</b> ${c.cpf || "--"}</p>
        <p><b>Telefone:</b> ${c.telefone || "--"}</p>
        <p><b>Status:</b> ${c.status || "ativo"}</p><p><b>Confiança até:</b> ${c.confianca_ate ? new Date(c.confianca_ate).toLocaleDateString("pt-BR") : "--"}</p>
      </div>
      <div class="panel">
        <h3>Internet</h3>
        <p><b>Servidor:</b> ${c.servidor || "--"}</p>
        <p><b>Plano:</b> ${c.plano || "--"}</p>
        <p><b>PPPoE:</b> ${c.pppoe || "--"}</p><p><b>Acesso remoto:</b> ${c.acesso_remoto || "--"}</p>
        <p><b>Senha:</b> ${c.senha || "--"}</p>
      </div>
    </div>
    <div class="panel">
      <h3>Endereço</h3>
      <p><b>CEP:</b> ${c.cep || "--"}</p>
      <p><b>Endereço:</b> ${c.endereco || "--"}, Nº ${c.numero || "--"}</p>
      <p><b>Complemento:</b> ${c.complemento || "--"}</p>
      <p><b>Bairro:</b> ${c.bairro || "--"}</p>
      <p><b>Ponto de referência:</b> ${c.referencia || "--"}</p>
    </div>
    <div class="panel">
      <h3>Financeiro</h3>
      <p><b>Valor:</b> ${c.valor || "--"}</p>
      <p><b>Vencimento:</b> ${c.vencimento || "--"}</p>
      <p><b>Observações:</b> ${c.observacoes || "--"}</p>
      <button onclick="bloquearCliente(${c.id})">🔴 Bloquear</button><button onclick="desbloquearCliente(${c.id})">🟢 Desbloquear</button><button onclick="liberarConfianca(${c.id})">⭐ Liberar em Confiança</button><button onclick="editarCliente(${c.id})">✏️ Editar Cliente</button>
    </div>
  `;
  carregarStatusMikroTikCliente(c.id);
  
}

async function excluirCliente(id){if(!confirm("Excluir cliente?"))return;await fetch("/api/clientes/"+id,{method:"DELETE"});carregarClientesBanco();}
function val(id){const el=document.getElementById(id);return el?el.value:"";}
function setText(id,v){const el=document.getElementById(id);if(el)el.textContent=v;}
function iniciarSocket(){if(typeof io==="undefined"){setInterval(()=>{if(!location.pathname.includes("index"))carregarDashboard();},3000);return;}const socket=io();socket.on("connect",()=>{socketConectado=true;const live=document.getElementById("liveStatus");if(live){live.textContent="AO VIVO";live.className="badge badge-live pulse";}});socket.on("disconnect",()=>{socketConectado=false;const live=document.getElementById("liveStatus");if(live){live.textContent="OFFLINE";live.className="badge badge-off";}});socket.on("hub-update",(dados)=>aplicarDados(dados));socket.on("mikrotik-update",(dados)=>aplicarDados(dados));}
window.addEventListener("resize",()=>desenharGrafico());function salvarDemo(t){alert(t||"Função visual pronta.");}


function moedaBR(valor){
  return Number(valor || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function valorNumeroBR(valor){
  if(valor === undefined || valor === null) return 0;
  let txt = String(valor)
    .replace("R$","")
    .replace(/\s/g,"")
    .replace(/\./g,"")
    .replace(",",".")
    .trim();
  return parseFloat(txt) || 0;
}

async function carregarReceita(){
  try{
    const r = await fetch("/api/clientes");
    const clientes = await r.json();
    let total = 0;
    if(Array.isArray(clientes)){
      clientes.forEach(c => {
        if((c.status || "ativo") === "ativo"){
          total += valorNumeroBR(c.valor);
        }
      });
    }
    setText("receitaTotal", moedaBR(total));
  }catch(e){
    setText("receitaTotal", "R$ 0,00");
  }
}


async function buscarCEP(){
  const cepInput = document.getElementById("cep");
  const bairroInput = document.getElementById("bairro");
  const enderecoInput = document.getElementById("endereco");

  if(!cepInput) return;

  const cepLimpo = cepInput.value.replace(/\D/g, "");

  if(cepLimpo.length !== 8){
    if(cepLimpo.length > 0){
      alert("Digite um CEP válido com 8 números.");
    }
    return;
  }

  cepInput.value = cepLimpo.replace(/^(\d{5})(\d{3})$/, "$1-$2");

  try{
    const resposta = await fetch(`https://viacep.com.br/ws/${cepLimpo}/json/`);
    const dados = await resposta.json();

    if(dados.erro){
      alert("CEP não encontrado.");
      return;
    }

    if(bairroInput) bairroInput.value = dados.bairro || "";
    if(enderecoInput) enderecoInput.value = dados.logradouro || "";

  }catch(e){
    alert("Erro ao consultar CEP. Verifique sua conexão.");
  }
}


function acessoRemotoCliente(link){
  if(!link || link === "--"){
    alert("Este cliente não possui acesso remoto cadastrado.");
    return;
  }

  let url = String(link).trim();

  if(!url.startsWith("http://") && !url.startsWith("https://")){
    url = "http://" + url;
  }

  window.open(url, "_blank");
}


async function bloquearCliente(id){
  if(!confirm("Bloquear este cliente no MikroTik?")) return;
  const r = await fetch(`/api/clientes/${id}/bloquear`, { method:"POST" });
  const d = await r.json();
  if(d.ok){ alert("Cliente bloqueado com sucesso."); location.reload(); }
  else alert("Erro ao bloquear: " + d.erro);
}

async function desbloquearCliente(id){
  if(!confirm("Desbloquear este cliente no MikroTik?")) return;
  const r = await fetch(`/api/clientes/${id}/desbloquear`, { method:"POST" });
  const d = await r.json();
  if(d.ok){ alert("Cliente desbloqueado com sucesso."); location.reload(); }
  else alert("Erro ao desbloquear: " + d.erro);
}

async function liberarConfianca(id){
  const dias = prompt("Liberar em confiança por quantos dias?", "7");
  if(!dias) return;

  const r = await fetch(`/api/clientes/${id}/confianca`, {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({dias:Number(dias)})
  });

  const d = await r.json();
  if(d.ok){ alert("Cliente liberado em confiança."); location.reload(); }
  else alert("Erro ao liberar em confiança: " + d.erro);
}


function limparPPPoE(valor){
  return String(valor || "").trim();
}


async function carregarStatusMikroTikCliente(id){
  const box = document.getElementById("statusMikrotikCliente");
  if(!box || !id) return;

  box.innerHTML = `<div class="panel"><h3>Status de Conexão</h3><p>Consultando MikroTik...</p></div>`;

  try{
    const r = await fetch(`/api/clientes/${id}/status-mikrotik`);
    const s = await r.json();

    if(!s.ok){
      box.innerHTML = `<div class="panel"><h3>Status de Conexão</h3><p>Erro: ${s.erro}</p></div>`;
      return;
    }

    let extra = "";
    if(s.ip) extra += `<p><b>IP atual:</b> ${s.ip}</p>`;
    if(s.uptime) extra += `<p><b>Tempo conectado:</b> ${s.uptime}</p>`;
    if(s.caller_id) extra += `<p><b>MAC/Caller ID:</b> ${s.caller_id}</p>`;
    if(s.confianca_ate) extra += `<p><b>Confiança até:</b> ${new Date(s.confianca_ate).toLocaleDateString("pt-BR")}</p>`;

    let botoesRemoto = "";
    if((s.status === "online" || s.status === "confianca") && s.ip){
      botoesRemoto = `
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px">
          <button class="small-btn" onclick="window.open(`/remoto/${id}`, `_blank`)">🌐 Acessar pelo Painel</button><button class="small-btn" onclick="window.open('http://${s.ip}', '_blank')">🌐 Abrir HTTP</button>
          <button class="small-btn" onclick="window.open('https://${s.ip}', '_blank')">🔒 Abrir HTTPS</button>
          <button class="small-btn" onclick="window.open('http://${s.ip}:8291', '_blank')">🖥️ Abrir Winbox</button>
        </div>
      `;
    }

    box.innerHTML = `
      <div class="panel">
        <h3>Status de Conexão</h3>
        <h2>${s.texto}</h2>
        <p>${s.detalhe || ""}</p>
        <p><b>PPPoE:</b> ${s.pppoe || "--"}</p>
        <p><b>Servidor:</b> ${s.servidor || "--"}</p>
        ${extra}
        ${botoesRemoto}
      </div>
    `;
  }catch(e){
    box.innerHTML = `<div class="panel"><h3>Status de Conexão</h3><p>Erro ao consultar o MikroTik.</p></div>`;
  }
}



function abrirAcessoHttp(ip){
  window.open(`http://${ip}`, "_blank");
}

function abrirAcessoHttps(ip){
  window.open(`https://${ip}`, "_blank");
}

function abrirAcessoWinbox(ip){
  window.open(`http://${ip}:8291`, "_blank");
}


function abrirRemotoPainel(id){
  window.open(`/remoto/${id}`, "_blank");
}


async function login(){
  const usuario =
    document.getElementById("usuario")?.value ||
    document.getElementById("login")?.value ||
    document.getElementById("user")?.value ||
    "";

  const senha =
    document.getElementById("senha")?.value ||
    document.getElementById("password")?.value ||
    document.getElementById("pass")?.value ||
    "";

  try{
    const r = await fetch("/api/login", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({usuario, senha, login: usuario, password: senha})
    });

    const d = await r.json();

    if(d.ok){
      localStorage.setItem("fibra_logado", "sim");
      localStorage.setItem("fibra_token", d.token || "fibra-admin");
      localStorage.setItem("fibra_usuario", usuario);
      window.location.href = "dashboard.html";
      return;
    }

    alert(d.erro || "Usuário ou senha inválidos.");
  }catch(e){
    alert("Erro ao fazer login. Verifique o deploy do Render.");
  }
}

function entrar(){
  return login();
}

function protegerPagina(){
  const pagina = window.location.pathname.split("/").pop();
  if(pagina === "" || pagina === "index.html" || pagina === "login.html") return;

  const logado = localStorage.getItem("fibra_logado");
  if(logado !== "sim"){
    window.location.href = "index.html";
  }
}

function sair(){
  localStorage.removeItem("fibra_logado");
  localStorage.removeItem("fibra_token");
  localStorage.removeItem("fibra_usuario");
  window.location.href = "index.html";
}

document.addEventListener("DOMContentLoaded", () => {
  const form = document.querySelector("form");
  if(form && (document.getElementById("usuario") || document.getElementById("login"))){
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      login();
    });
  }

  const btns = Array.from(document.querySelectorAll("button"));
  for(const b of btns){
    const t = (b.textContent || "").toLowerCase();
    if(t.includes("entrar") || t.includes("login") || t.includes("acessar")){
      b.onclick = (e) => {
        if(e) e.preventDefault();
        login();
      };
    }
  }
});
