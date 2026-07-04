function qs(id){
  return document.getElementById(id);
}

function val(id){
  const el = qs(id);
  return el ? el.value : "";
}

function setLoginOk(usuario, token){
  localStorage.setItem("fibra_logado", "sim");
  localStorage.setItem("fibraLogado", "1");
  localStorage.setItem("fibra_token", token || "fibra-admin");
  localStorage.setItem("fibra_usuario", usuario || "admin");
  localStorage.setItem("usuarioLogado", usuario || "admin");
}

async function login(){
  const usuario = (val("usuario") || val("login") || val("user")).trim();
  const senha = (val("senha") || val("password") || val("pass")).trim();
  const msg = qs("loginMsg");

  if(!usuario || !senha){
    if(msg) msg.textContent = "Informe usuário e senha.";
    else alert("Informe usuário e senha.");
    return;
  }

  // Login padrão local para garantir acesso inicial ao painel.
  if(usuario === "admin" && senha === "admin"){
    setLoginOk("admin", "fibra-admin");
    window.location.href = "dashboard.html";
    return;
  }

  // Fallback pela API, caso depois sejam cadastrados usuários no backend/banco.
  try{
    const r = await fetch("/api/login", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({usuario, senha, login: usuario, password: senha})
    });

    const d = await r.json();

    if(d.ok){
      setLoginOk(usuario, d.token || "fibra-admin");
      window.location.href = "dashboard.html";
      return;
    }

    if(msg) msg.textContent = d.erro || "Usuário ou senha inválidos.";
    else alert(d.erro || "Usuário ou senha inválidos.");
  }catch(e){
    if(msg) msg.textContent = "Erro ao conectar na API de login. Use admin/admin para acesso inicial.";
    else alert("Erro ao conectar na API de login.");
  }
}

function entrar(){
  return login();
}

function protegerPagina(){
  const pagina = window.location.pathname.split("/").pop();
  if(pagina === "" || pagina === "index.html" || pagina === "login.html") return;

  const ok = localStorage.getItem("fibra_logado") === "sim" || localStorage.getItem("fibraLogado") === "1";
  if(!ok){
    window.location.href = "index.html";
  }
}

function sair(){
  localStorage.removeItem("fibra_logado");
  localStorage.removeItem("fibraLogado");
  localStorage.removeItem("fibra_token");
  localStorage.removeItem("fibra_usuario");
  localStorage.removeItem("usuarioLogado");
  window.location.href = "index.html";
}

function carregarDashboard(){
  try{
    const r = await fetch("/api/servidores?_=" + Date.now());
    if(r.ok){
      const lista = await r.json();
      if(Array.isArray(lista)){
        fibraServidores = lista;
        aplicarServidores(lista);
        const principal = escolherServidorPrincipal(lista);
        if(principal) aplicarDashboard(principal);
      }
    }
  }catch(e){}

  try{
    const r2 = await fetch("/api/status-atual?_=" + Date.now());
    if(r2.ok){
      const d = await r2.json();
      if(d && Object.keys(d).length){
        fibraUltimoStatus = d;
        aplicarDashboard(d);
      }
    }
  }catch(e){}
}

function iniciarSocket(){
  if(typeof io === "undefined") return;
  try{
    socket = io();

    socket.on("connect", () => {
      const live = qs("liveStatus");
      if(live){
        live.textContent = "ONLINE";
        live.className = "badge badge-on";
      }
    });

    socket.on("disconnect", () => {
      const live = qs("liveStatus");
      if(live){
        live.textContent = "CONECTANDO";
        live.className = "badge badge-off";
      }
    });

    const eventos = ["status", "status-atualizado", "mikrotik-status", "dashboard"];
    eventos.forEach(ev => {
      socket.on(ev, (dados) => {
        if(!dados) return;
        fibraUltimoStatus = dados;
        aplicarDashboard(dados);
        carregarDashboard();
      });
    });

    socket.on("servidores", (dados) => {
      if(Array.isArray(dados)){
        fibraServidores = dados;
        aplicarServidores(dados);
        const principal = escolherServidorPrincipal(dados);
        if(principal) aplicarDashboard(principal);
      }
    });
  }catch(e){}
}

function aplicarDashboard(d){
  if(!d) return;

  const online = servidorOnline(d) || !!d.identity;
  if(qs("mkStatus")) qs("mkStatus").textContent = online ? "ONLINE" : "Aguardando";
  if(qs("pppoeTotal")) qs("pppoeTotal").textContent = d.pppoeOnline || d.pppoeTotal || 0;
  if(qs("clientesOffline")) qs("clientesOffline").textContent = d.clientesOffline || 0;
  if(qs("mkCpu")) qs("mkCpu").textContent = (d.cpu || 0) + "%";
  if(qs("mkNome")) qs("mkNome").textContent = normalizarNomeServidor(d.identity || d.nome);
  if(qs("mkUptime")) qs("mkUptime").textContent = d.uptime || "--";
  if(qs("mkAtualizado")) qs("mkAtualizado").textContent = d.atualizadoEm ? new Date(d.atualizadoEm).toLocaleString("pt-BR") : "Aguardando envio";
  if(qs("downloadTexto")) qs("downloadTexto").textContent = d.download || "0 Mbps";
  if(qs("uploadTexto")) qs("uploadTexto").textContent = d.upload || "0 Mbps";

  const live = qs("liveStatus");
  if(live && online){
    live.textContent = "ONLINE";
    live.className = "badge badge-on";
  }

  if(qs("interfacesTabela")){
    const interfaces = d.interfaces || [];
    qs("interfacesTabela").innerHTML = interfaces.length ? interfaces.map(i => `
      <tr>
        <td>${i.nome || i.name || i.interface || "--"}</td>
        <td>${i.rx || i.download || "--"}</td>
        <td>${i.tx || i.upload || "--"}</td>
        <td>${i.status || "ativo"}</td>
      </tr>
    `).join("") : '<tr><td colspan="4">Aguardando dados...</td></tr>';
  }

  if(qs("clientesTabela")){
    const clientes = d.clientes || [];
    qs("clientesTabela").innerHTML = clientes.length ? clientes.map(c => `
      <tr>
        <td>${c.name || c.cliente || c.usuario || "--"}</td>
        <td>${c.profile || c.plano || "--"}</td>
        <td>${c.address || c.ip || "--"}</td>
        <td>${c.uptime || "--"}</td>
        <td>Online</td>
      </tr>
    `).join("") : '<tr><td colspan="5">Aguardando dados...</td></tr>';
  }
}

function aplicarServidores(lista){
  if(!Array.isArray(lista)) return;

  const tbody = qs("servidoresTabela") || qs("servidoresBody");
  if(tbody){
    tbody.innerHTML = lista.length ? lista.map(s => `
      <tr>
        <td>${normalizarNomeServidor(s.identity || s.nome)}</td>
        <td>${servidorOnline(s) ? "🟢 Online" : "🔴 Offline"}</td>
        <td>${s.cpu || 0}%</td>
        <td>${s.pppoeOnline || 0}</td>
        <td>${s.download || "0 Mbps"}</td>
        <td>${s.upload || "0 Mbps"}</td>
      </tr>
    `).join("") : '<tr><td colspan="6">Aguardando servidores...</td></tr>';
  }

  // Cards por servidor, se existirem no HTML
  lista.forEach(s => {
    const nome = String(s.identity || "").toUpperCase();
    const prefix = nome.includes("COLONIA") ? "colonia" : nome.includes("ARMANDO") ? "armando" : "";
    if(prefix){
      if(qs(prefix + "Status")) qs(prefix + "Status").textContent = servidorOnline(s) ? "ONLINE" : "OFF";
      if(qs(prefix + "Cpu")) qs(prefix + "Cpu").textContent = (s.cpu || 0) + "%";
      if(qs(prefix + "Clientes")) qs(prefix + "Clientes").textContent = s.pppoeOnline || 0;
      if(qs(prefix + "Download")) qs(prefix + "Download").textContent = s.download || "0 Mbps";
      if(qs(prefix + "Upload")) qs(prefix + "Upload").textContent = s.upload || "0 Mbps";
    }
  });
}

setInterval(() => {
  if(document.getElementById("mkStatus") || document.getElementById("servidoresTabela")){
    carregarDashboard();
  }
}, 3000);

function listaServidores(dados){ if(Array.isArray(dados)) return dados; if(dados && typeof dados==='object') return Object.values(dados).filter(s=>s && typeof s==='object'); return []; }


// Correção: /api/servidores pode retornar objeto {colonia, armando}

function listaServidores(dados){
  if(Array.isArray(dados)) return dados;
  if(dados && typeof dados === "object"){
    return Object.values(dados).filter(s => s && typeof s === "object");
  }
  return [];
}

async function carregarDashboard(){
  try{
    const r = await fetch("/api/servidores?_=" + Date.now());
    if(r.ok){
      const dados = await r.json();
      const lista = listaServidores(dados);

      if(lista.length){
        fibraServidores = lista;
        aplicarServidores(lista);

        const principal = escolherServidorPrincipal(lista);
        if(principal) aplicarDashboard(principal);
      }
    }
  }catch(e){
    console.log("Erro ao carregar /api/servidores", e);
  }

  try{
    const r2 = await fetch("/api/status-atual?_=" + Date.now());
    if(r2.ok){
      const d = await r2.json();
      if(d && Object.keys(d).length){
        fibraUltimoStatus = d;
        aplicarDashboard(d);
      }
    }
  }catch(e){}
}

function aplicarServidores(dados){
  const lista = listaServidores(dados);

  const tbody = qs("servidoresTabela") || qs("servidoresBody");
  if(tbody){
    tbody.innerHTML = lista.length ? lista.map(s => `
      <tr>
        <td>${normalizarNomeServidor(s.identity || s.nome || s.servidor)}</td>
        <td>${servidorOnline(s) ? "🟢 Online" : "🔴 Offline"}</td>
        <td>${s.cpu || 0}%</td>
        <td>${s.pppoeOnline || 0}</td>
        <td>${s.download || "0 Mbps"}</td>
        <td>${s.upload || "0 Mbps"}</td>
      </tr>
    `).join("") : '<tr><td colspan="6">Aguardando servidores...</td></tr>';
  }

  lista.forEach(s => {
    const nome = String(s.identity || s.nome || s.servidor || "").toUpperCase();
    const prefix = nome.includes("COLONIA") || nome.includes("COLNIA") ? "colonia" : nome.includes("ARMANDO") ? "armando" : "";

    if(prefix){
      if(qs(prefix + "Status")) qs(prefix + "Status").textContent = servidorOnline(s) ? "ONLINE" : "OFF";
      if(qs(prefix + "Cpu")) qs(prefix + "Cpu").textContent = (s.cpu || 0) + "%";
      if(qs(prefix + "Clientes")) qs(prefix + "Clientes").textContent = s.pppoeOnline || 0;
      if(qs(prefix + "Download")) qs(prefix + "Download").textContent = s.download || "0 Mbps";
      if(qs(prefix + "Upload")) qs(prefix + "Upload").textContent = s.upload || "0 Mbps";
    }
  });
}



// ===== CORREÇÃO POPS + GRÁFICO AO VIVO =====

let historicoDownloadFibra = [];
let historicoUploadFibra = [];
let ultimoServidorPrincipalFibra = null;

function fibraNumMbps(valor){
  if(valor === null || valor === undefined) return 0;
  const txt = String(valor).replace(",", ".").replace(/[^\d.]/g, "");
  const n = Number(txt);
  return Number.isFinite(n) ? n : 0;
}

function fibraListaServidores(dados){
  if(Array.isArray(dados)) return dados;
  if(dados && typeof dados === "object"){
    return Object.values(dados).filter(s => s && typeof s === "object" && (s.servidor || s.identity || s.nome));
  }
  return [];
}

function fibraServidorOnline(s){
  if(typeof s.online === "boolean") return s.online;
  const t = s.atualizadoEm ? new Date(s.atualizadoEm).getTime() : 0;
  return !!t && (Date.now() - t) < 20000;
}

function fibraNomeServidor(s){
  const raw = String((s && (s.identity || s.nome || s.servidor)) || "").toUpperCase();
  if(raw.includes("COLONIA") || raw.includes("COLNIA") || raw.includes("COLÔNIA")) return "COLÔNIA ANTÔNIO ALEIXO";
  if(raw.includes("ARMANDO")) return "ARMANDO MENDES";
  return raw || "--";
}

function fibraServidorPrincipal(lista){
  if(!lista.length) return null;
  return lista.find(s => String(s.servidor || s.identity || "").toLowerCase().includes("colonia")) || lista[0];
}

function garantirBlocoPops(){
  const content = document.querySelector(".content");
  if(!content) return;

  if(!document.getElementById("popsResumo")){
    const section = document.createElement("section");
    section.className = "grid-2";
    section.id = "popsResumo";
    section.innerHTML = `
      <div class="panel">
        <h3>POP Colônia Antônio Aleixo</h3>
        <p><b>Status:</b> <span id="coloniaStatus">Aguardando</span></p>
        <p><b>CPU:</b> <span id="coloniaCpu">0%</span></p>
        <p><b>Clientes PPPoE:</b> <span id="coloniaClientes">0</span></p>
        <p><b>Download:</b> <span id="coloniaDownload">0 Mbps</span></p>
        <p><b>Upload:</b> <span id="coloniaUpload">0 Mbps</span></p>
      </div>
      <div class="panel">
        <h3>POP Armando Mendes</h3>
        <p><b>Status:</b> <span id="armandoStatus">Aguardando</span></p>
        <p><b>CPU:</b> <span id="armandoCpu">0%</span></p>
        <p><b>Clientes PPPoE:</b> <span id="armandoClientes">0</span></p>
        <p><b>Download:</b> <span id="armandoDownload">0 Mbps</span></p>
        <p><b>Upload:</b> <span id="armandoUpload">0 Mbps</span></p>
      </div>
    `;
    const cards = content.querySelector(".cards");
    if(cards && cards.nextSibling){
      content.insertBefore(section, cards.nextSibling);
    }else{
      content.prepend(section);
    }
  }
}

function garantirGrafico(){
  if(document.getElementById("graficoTempoReal")) return;

  const content = document.querySelector(".content");
  if(!content) return;

  const panel = document.createElement("section");
  panel.className = "panel";
  panel.innerHTML = `
    <h3>Gráfico ao vivo</h3>
    <div class="chart-legend">
      <span><i class="dot dot-blue"></i>Download</span>
      <span><i class="dot dot-green"></i>Upload</span>
    </div>
    <canvas id="graficoTempoReal" class="real-chart" height="220"></canvas>
    <div style="display:flex;gap:35px;justify-content:center;margin-top:14px;font-weight:800;flex-wrap:wrap">
      <span>⬇️ Download: <span id="downloadTexto">0 Mbps</span></span>
      <span>⬆️ Upload: <span id="uploadTexto">0 Mbps</span></span>
    </div>
  `;
  content.appendChild(panel);
}

function desenharGraficoFibra(){
  const canvas = document.getElementById("graficoTempoReal");
  if(!canvas) return;

  const ctx = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(320, Math.floor(rect.width || canvas.parentElement.clientWidth || 700));
  const height = 220;

  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = width + "px";
  canvas.style.height = height + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.clearRect(0, 0, width, height);

  const pad = 28;
  const maxVal = Math.max(10, ...historicoDownloadFibra, ...historicoUploadFibra);
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;

  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(120,120,120,.25)";
  for(let i=0;i<=4;i++){
    const y = pad + (innerH/4)*i;
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(width-pad, y);
    ctx.stroke();
  }

  function drawLine(data, stroke){
    if(data.length < 2) return;
    ctx.lineWidth = 3;
    ctx.strokeStyle = stroke;
    ctx.beginPath();

    data.forEach((v, i) => {
      const x = pad + (innerW / Math.max(1, data.length - 1)) * i;
      const y = height - pad - ((v / maxVal) * innerH);
      if(i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    ctx.stroke();
  }

  drawLine(historicoDownloadFibra, "#3b82f6");
  drawLine(historicoUploadFibra, "#22c55e");

  ctx.fillStyle = "rgba(120,120,120,.8)";
  ctx.font = "12px Arial";
  ctx.fillText("0 Mbps", 4, height - pad + 4);
  ctx.fillText(Math.round(maxVal) + " Mbps", 4, pad + 4);
}

function aplicarPopsEGrafico(dados){
  garantirBlocoPops();
  garantirGrafico();

  const lista = fibraListaServidores(dados);
  if(!lista.length) return;

  const totalOnline = lista.reduce((acc, s) => acc + Number(s.pppoeOnline || 0), 0);
  const principal = fibraServidorPrincipal(lista);
  ultimoServidorPrincipalFibra = principal || ultimoServidorPrincipalFibra;

  if(document.getElementById("pppoeTotal")) document.getElementById("pppoeTotal").textContent = totalOnline;
  if(document.getElementById("mkStatus")) document.getElementById("mkStatus").textContent = lista.some(fibraServidorOnline) ? "ONLINE" : "Aguardando";

  lista.forEach(s => {
    const nome = String(s.servidor || s.identity || s.nome || "").toLowerCase();
    const prefix = nome.includes("colonia") || nome.includes("coln") ? "colonia" : nome.includes("armando") ? "armando" : "";

    if(prefix){
      const status = document.getElementById(prefix + "Status");
      const cpu = document.getElementById(prefix + "Cpu");
      const clientes = document.getElementById(prefix + "Clientes");
      const down = document.getElementById(prefix + "Download");
      const up = document.getElementById(prefix + "Upload");

      if(status) status.textContent = fibraServidorOnline(s) ? "🟢 Online" : "🔴 Offline";
      if(cpu) cpu.textContent = (s.cpu || 0) + "%";
      if(clientes) clientes.textContent = s.pppoeOnline || 0;
      if(down) down.textContent = s.download || "0 Mbps";
      if(up) up.textContent = s.upload || "0 Mbps";
    }
  });

  if(principal){
    if(document.getElementById("mkNome")) document.getElementById("mkNome").textContent = fibraNomeServidor(principal);
    if(document.getElementById("mkCpu")) document.getElementById("mkCpu").textContent = (principal.cpu || 0) + "%";
    if(document.getElementById("mkUptime")) document.getElementById("mkUptime").textContent = principal.uptime || "--";
    if(document.getElementById("mkAtualizado")) document.getElementById("mkAtualizado").textContent = principal.atualizadoEm ? new Date(principal.atualizadoEm).toLocaleString("pt-BR") : "Aguardando envio";
    if(document.getElementById("downloadTexto")) document.getElementById("downloadTexto").textContent = principal.download || "0 Mbps";
    if(document.getElementById("uploadTexto")) document.getElementById("uploadTexto").textContent = principal.upload || "0 Mbps";

    const down = fibraNumMbps(principal.download);
    const up = fibraNumMbps(principal.upload);
    historicoDownloadFibra.push(down);
    historicoUploadFibra.push(up);
    if(historicoDownloadFibra.length > 40) historicoDownloadFibra.shift();
    if(historicoUploadFibra.length > 40) historicoUploadFibra.shift();
    desenharGraficoFibra();

    const interfacesTabela = document.getElementById("interfacesTabela");
    if(interfacesTabela){
      const interfaces = principal.interfaces || [];
      interfacesTabela.innerHTML = interfaces.length ? interfaces.map(i => `
        <tr>
          <td>${i.nome || "--"}</td>
          <td>${i.rx || "--"}</td>
          <td>${i.tx || "--"}</td>
          <td>Ativo</td>
        </tr>
      `).join("") : '<tr><td colspan="4">Aguardando dados...</td></tr>';
    }

    const clientesTabela = document.getElementById("clientesTabela");
    if(clientesTabela){
      const clientes = principal.clientes || [];
      clientesTabela.innerHTML = clientes.length ? clientes.map(c => `
        <tr>
          <td>${c.nome || "--"}</td>
          <td>${c.plano || "--"}</td>
          <td>${c.ip || "--"}</td>
          <td>${c.uptime || "--"}</td>
          <td>🟢 Online</td>
        </tr>
      `).join("") : '<tr><td colspan="5">Aguardando dados...</td></tr>';
    }
  }
}

async function carregarDashboardCompletoFibra(){
  try{
    const r = await fetch("/api/servidores?_=" + Date.now());
    const dados = await r.json();
    aplicarPopsEGrafico(dados);
  }catch(e){
    console.log("Falha ao carregar servidores:", e);
  }
}

const carregarDashboardOriginalFibra = typeof carregarDashboard === "function" ? carregarDashboard : null;
carregarDashboard = async function(){
  if(carregarDashboardOriginalFibra){
    try{ await carregarDashboardOriginalFibra(); }catch(e){}
  }
  await carregarDashboardCompletoFibra();
};

const iniciarSocketOriginalFibra = typeof iniciarSocket === "function" ? iniciarSocket : null;
iniciarSocket = function(){
  if(iniciarSocketOriginalFibra){
    try{ iniciarSocketOriginalFibra(); }catch(e){}
  }

  if(typeof io !== "undefined"){
    try{
      const sock = io();
      sock.on("connect", () => {
        const live = document.getElementById("liveStatus");
        if(live){
          live.textContent = "ONLINE";
          live.className = "badge badge-on";
        }
      });
      ["servidores", "status", "status-atualizado", "mikrotik-status", "dashboard"].forEach(ev => {
        sock.on(ev, () => carregarDashboardCompletoFibra());
      });
    }catch(e){}
  }
};

document.addEventListener("DOMContentLoaded", () => {
  if(document.getElementById("mkStatus") || document.querySelector(".content")){
    garantirBlocoPops();
    garantirGrafico();
    carregarDashboardCompletoFibra();
    setInterval(carregarDashboardCompletoFibra, 1000);
  }
});



// ===== REMOVER TABELA ANTIGA SERVIDORES / POPS =====
function removerTabelaAntigaServidores(){
  const possiveis = [
    document.getElementById("servidoresTabela"),
    document.getElementById("servidoresBody")
  ].filter(Boolean);

  possiveis.forEach(el => {
    let bloco = el.closest(".panel") || el.closest("section") || el.closest("div");
    if(bloco){
      bloco.style.display = "none";
      bloco.remove();
    }
  });

  const titulos = Array.from(document.querySelectorAll("h1,h2,h3,h4"));
  titulos.forEach(t => {
    const texto = (t.textContent || "").trim().toLowerCase();
    if(texto.includes("servidores / pops") || texto === "servidores" || texto === "pops"){
      const bloco = t.closest(".panel") || t.closest("section") || t.parentElement;
      if(bloco){
        bloco.style.display = "none";
        bloco.remove();
      }
    }
  });
}

document.addEventListener("DOMContentLoaded", removerTabelaAntigaServidores);
setInterval(removerTabelaAntigaServidores, 1500);



// ===== RESUMO GERAL COLÔNIA + ARMANDO E GRÁFICO SÓ DASHBOARD/MONITORAMENTO =====

function fibraPaginaAtual(){
  return (window.location.pathname.split("/").pop() || "index.html").toLowerCase();
}

function fibraGraficoPermitido(){
  const p = fibraPaginaAtual();
  return p === "dashboard.html" || p === "monitoramento.html";
}

function fibraRemoverGraficoForaDasPaginas(){
  if(fibraGraficoPermitido()) return;

  const canvas = document.getElementById("graficoTempoReal");
  if(canvas){
    const bloco = canvas.closest(".panel") || canvas.closest("section") || canvas.parentElement;
    if(bloco) bloco.remove();
  }

  const titulos = Array.from(document.querySelectorAll("h1,h2,h3,h4"));
  titulos.forEach(t => {
    const texto = (t.textContent || "").trim().toLowerCase();
    if(texto.includes("gráfico ao vivo") || texto.includes("grafico ao vivo")){
      const bloco = t.closest(".panel") || t.closest("section") || t.parentElement;
      if(bloco) bloco.remove();
    }
  });
}

function fibraGarantirResumoGeral(){
  const content = document.querySelector(".content");
  if(!content) return;

  let painel = document.getElementById("resumoGeralFibra");
  if(!painel){
    painel = document.createElement("section");
    painel.className = "panel";
    painel.id = "resumoGeralFibra";
    painel.innerHTML = `
      <h3>Resumo Geral</h3>
      <p><b>POPs:</b> <span id="resumoPops">COLÔNIA + ARMANDO</span></p>
      <p><b>Clientes Online:</b> <span id="resumoClientesOnline">0</span></p>
      <p><b>CPU Média:</b> <span id="resumoCpuMedia">0%</span></p>
      <p><b>Download Total:</b> <span id="resumoDownloadTotal">0 Mbps</span></p>
      <p><b>Upload Total:</b> <span id="resumoUploadTotal">0 Mbps</span></p>
      <p><b>Última atualização:</b> <span id="resumoUltimaAtualizacao">Aguardando envio</span></p>
    `;

    const cards = content.querySelector(".cards");
    if(cards && cards.nextSibling){
      content.insertBefore(painel, cards.nextSibling);
    }else{
      content.prepend(painel);
    }
  }
}

function fibraAtualizarResumoGeral(dados){
  const lista = typeof fibraListaServidores === "function"
    ? fibraListaServidores(dados)
    : (Array.isArray(dados) ? dados : Object.values(dados || {}));

  if(!lista.length) return;

  fibraGarantirResumoGeral();

  const colonia = lista.find(s => String(s.servidor || s.identity || s.nome || "").toLowerCase().includes("colonia") || String(s.nome || "").toLowerCase().includes("coln"));
  const armando = lista.find(s => String(s.servidor || s.identity || s.nome || "").toLowerCase().includes("armando"));

  const nomes = [];
  if(colonia) nomes.push("COLÔNIA ANTÔNIO ALEIXO 🟢");
  if(armando) nomes.push("ARMANDO MENDES 🟢");

  const clientes = lista.reduce((acc, s) => acc + Number(s.pppoeOnline || 0), 0);
  const cpuMedia = Math.round(lista.reduce((acc, s) => acc + Number(s.cpu || 0), 0) / Math.max(1, lista.length));
  const downTotal = lista.reduce((acc, s) => acc + fibraNumMbps(s.download), 0);
  const upTotal = lista.reduce((acc, s) => acc + fibraNumMbps(s.upload), 0);

  const ultima = lista
    .map(s => s.atualizadoEm ? new Date(s.atualizadoEm).getTime() : 0)
    .filter(Boolean)
    .sort((a,b) => b-a)[0];

  const el = id => document.getElementById(id);
  if(el("resumoPops")) el("resumoPops").textContent = nomes.length ? nomes.join(" | ") : "COLÔNIA + ARMANDO";
  if(el("resumoClientesOnline")) el("resumoClientesOnline").textContent = clientes;
  if(el("resumoCpuMedia")) el("resumoCpuMedia").textContent = cpuMedia + "%";
  if(el("resumoDownloadTotal")) el("resumoDownloadTotal").textContent = Math.round(downTotal) + " Mbps";
  if(el("resumoUploadTotal")) el("resumoUploadTotal").textContent = Math.round(upTotal) + " Mbps";
  if(el("resumoUltimaAtualizacao")) el("resumoUltimaAtualizacao").textContent = ultima ? new Date(ultima).toLocaleString("pt-BR") : "Aguardando envio";

  // Corrige painel antigo "Dados do MikroTik" / "Resumo Geral", se existir
  if(document.getElementById("mkNome")) document.getElementById("mkNome").textContent = "COLÔNIA + ARMANDO";
  if(document.getElementById("mkUptime")) document.getElementById("mkUptime").textContent = "Colônia: " + (colonia?.uptime || "--") + " | Armando: " + (armando?.uptime || "--");
  if(document.getElementById("mkAtualizado")) document.getElementById("mkAtualizado").textContent = ultima ? new Date(ultima).toLocaleString("pt-BR") : "Aguardando envio";
  if(document.getElementById("mkCpu")) document.getElementById("mkCpu").textContent = cpuMedia + "%";
  if(document.getElementById("pppoeTotal")) document.getElementById("pppoeTotal").textContent = clientes;
}

const fibraAplicarPopsEGraficoOriginal = typeof aplicarPopsEGrafico === "function" ? aplicarPopsEGrafico : null;
aplicarPopsEGrafico = function(dados){
  fibraAtualizarResumoGeral(dados);

  if(fibraGraficoPermitido()){
    if(fibraAplicarPopsEGraficoOriginal){
      fibraAplicarPopsEGraficoOriginal(dados);
    }
  }else{
    fibraRemoverGraficoForaDasPaginas();
    // Ainda atualiza POPs se a função original também monta cards, mas remove gráfico logo depois.
    if(fibraAplicarPopsEGraficoOriginal){
      fibraAplicarPopsEGraficoOriginal(dados);
      fibraRemoverGraficoForaDasPaginas();
    }
  }
};

const fibraGarantirGraficoOriginal = typeof garantirGrafico === "function" ? garantirGrafico : null;
garantirGrafico = function(){
  if(!fibraGraficoPermitido()){
    fibraRemoverGraficoForaDasPaginas();
    return;
  }
  if(fibraGarantirGraficoOriginal) fibraGarantirGraficoOriginal();
};

const fibraDesenharGraficoOriginal = typeof desenharGraficoFibra === "function" ? desenharGraficoFibra : null;
desenharGraficoFibra = function(){
  if(!fibraGraficoPermitido()){
    fibraRemoverGraficoForaDasPaginas();
    return;
  }
  if(fibraDesenharGraficoOriginal) fibraDesenharGraficoOriginal();
};

document.addEventListener("DOMContentLoaded", () => {
  fibraRemoverGraficoForaDasPaginas();
  fibraGarantirResumoGeral();

  if(typeof carregarDashboardCompletoFibra === "function"){
    carregarDashboardCompletoFibra();
  }
});

setInterval(() => {
  fibraRemoverGraficoForaDasPaginas();
}, 1500);



// ===== GRÁFICO REAL COM CONSUMO SOMADO DOS DOIS SERVIDORES =====

function fibraConsumoTotalServidores(dados){
  const lista = typeof fibraListaServidores === "function"
    ? fibraListaServidores(dados)
    : (Array.isArray(dados) ? dados : Object.values(dados || {}));

  const downloadTotal = lista.reduce((acc, s) => acc + fibraNumMbps(s.download), 0);
  const uploadTotal = lista.reduce((acc, s) => acc + fibraNumMbps(s.upload), 0);

  return {
    lista,
    downloadTotal,
    uploadTotal
  };
}

function atualizarGraficoConsumoTotal(dados){
  if(typeof fibraGraficoPermitido === "function" && !fibraGraficoPermitido()) return;

  garantirGrafico();

  const total = fibraConsumoTotalServidores(dados);

  historicoDownloadFibra.push(total.downloadTotal);
  historicoUploadFibra.push(total.uploadTotal);

  if(historicoDownloadFibra.length > 40) historicoDownloadFibra.shift();
  if(historicoUploadFibra.length > 40) historicoUploadFibra.shift();

  if(document.getElementById("downloadTexto")){
    document.getElementById("downloadTexto").textContent = Math.round(total.downloadTotal) + " Mbps";
  }

  if(document.getElementById("uploadTexto")){
    document.getElementById("uploadTexto").textContent = Math.round(total.uploadTotal) + " Mbps";
  }

  desenharGraficoFibra();
}

const aplicarPopsEGraficoAntesDoTotal = typeof aplicarPopsEGrafico === "function" ? aplicarPopsEGrafico : null;

aplicarPopsEGrafico = function(dados){
  const lista = typeof fibraListaServidores === "function"
    ? fibraListaServidores(dados)
    : (Array.isArray(dados) ? dados : Object.values(dados || {}));

  if(typeof fibraAtualizarResumoGeral === "function"){
    fibraAtualizarResumoGeral(dados);
  }

  if(aplicarPopsEGraficoAntesDoTotal){
    aplicarPopsEGraficoAntesDoTotal(dados);
  }

  if(lista.length){
    const total = fibraConsumoTotalServidores(dados);

    if(document.getElementById("downloadTexto")){
      document.getElementById("downloadTexto").textContent = Math.round(total.downloadTotal) + " Mbps";
    }

    if(document.getElementById("uploadTexto")){
      document.getElementById("uploadTexto").textContent = Math.round(total.uploadTotal) + " Mbps";
    }

    atualizarGraficoConsumoTotal(dados);
  }
};

const carregarDashboardCompletoFibraTotalOriginal = typeof carregarDashboardCompletoFibra === "function" ? carregarDashboardCompletoFibra : null;

carregarDashboardCompletoFibra = async function(){
  try{
    const r = await fetch("/api/servidores?_=" + Date.now());
    const dados = await r.json();

    if(typeof aplicarPopsEGrafico === "function"){
      aplicarPopsEGrafico(dados);
    }
  }catch(e){
    if(carregarDashboardCompletoFibraTotalOriginal){
      try{ await carregarDashboardCompletoFibraTotalOriginal(); }catch(err){}
    }
  }
};



// ===== DASHBOARD/MONITORAMENTO: RESUMO + POPS + SERVIDORES ONLINE 2/2 =====

function fibraPaginaNocPermitida(){
  const p = (window.location.pathname.split("/").pop() || "index.html").toLowerCase();
  return p === "dashboard.html" || p === "monitoramento.html";
}

function fibraConverterListaServidores(dados){
  if(Array.isArray(dados)) return dados;
  if(dados && typeof dados === "object"){
    return Object.values(dados).filter(s => s && typeof s === "object" && (s.servidor || s.identity || s.nome));
  }
  return [];
}

function fibraMbpsNumero(v){
  if(v === null || v === undefined) return 0;
  const n = Number(String(v).replace(",", ".").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function fibraEstaOnline(s){
  if(typeof s.online === "boolean") return s.online;
  const t = s.atualizadoEm ? new Date(s.atualizadoEm).getTime() : 0;
  return !!t && (Date.now() - t) < 20000;
}

function fibraEncontrarPop(lista, tipo){
  const t = tipo.toLowerCase();
  return lista.find(s => {
    const n = String(s.servidor || s.identity || s.nome || "").toLowerCase();
    if(t === "colonia") return n.includes("colonia") || n.includes("coln") || n.includes("colônia");
    if(t === "armando") return n.includes("armando");
    return false;
  });
}

function fibraRemoverNocForaDasPaginas(){
  if(fibraPaginaNocPermitida()) return;

  [
    "resumoGeralFibra",
    "popsResumo",
    "graficoTempoReal"
  ].forEach(id => {
    const el = document.getElementById(id);
    if(el){
      const bloco = el.closest(".panel") || el.closest("section") || el.parentElement;
      if(bloco) bloco.remove();
      else el.remove();
    }
  });

  const titulos = Array.from(document.querySelectorAll("h1,h2,h3,h4"));
  titulos.forEach(t => {
    const texto = (t.textContent || "").trim().toLowerCase();
    if(
      texto.includes("resumo geral") ||
      texto.includes("pop colônia") ||
      texto.includes("pop colonia") ||
      texto.includes("pop armando") ||
      texto.includes("gráfico ao vivo") ||
      texto.includes("grafico ao vivo")
    ){
      const bloco = t.closest(".panel") || t.closest("section") || t.parentElement;
      if(bloco) bloco.remove();
    }
  });
}

function fibraGarantirResumoEPops(){
  if(!fibraPaginaNocPermitida()){
    fibraRemoverNocForaDasPaginas();
    return;
  }

  const content = document.querySelector(".content");
  if(!content) return;

  let resumo = document.getElementById("resumoGeralFibra");
  if(!resumo){
    resumo = document.createElement("section");
    resumo.className = "panel";
    resumo.id = "resumoGeralFibra";
    resumo.innerHTML = `
      <h3>Resumo Geral</h3>
      <p><b>POPs:</b> <span id="resumoPops">COLÔNIA ANTÔNIO ALEIXO | ARMANDO MENDES</span></p>
      <p><b>Clientes Online:</b> <span id="resumoClientesOnline">0</span></p>
      <p><b>CPU Média:</b> <span id="resumoCpuMedia">0%</span></p>
      <p><b>Download Total:</b> <span id="resumoDownloadTotal">0 Mbps</span></p>
      <p><b>Upload Total:</b> <span id="resumoUploadTotal">0 Mbps</span></p>
      <p><b>Última atualização:</b> <span id="resumoUltimaAtualizacao">Aguardando envio</span></p>
    `;
    const firstPanel = content.querySelector(".panel");
    if(firstPanel) content.insertBefore(resumo, firstPanel);
    else content.prepend(resumo);
  }

  let pops = document.getElementById("popsResumo");
  if(!pops){
    pops = document.createElement("section");
    pops.className = "grid-2";
    pops.id = "popsResumo";
    pops.innerHTML = `
      <div class="panel">
        <h3>POP Colônia Antônio Aleixo</h3>
        <p><b>Status:</b> <span id="coloniaStatus">Aguardando</span></p>
        <p><b>CPU:</b> <span id="coloniaCpu">0%</span></p>
        <p><b>Clientes PPPoE:</b> <span id="coloniaClientes">0</span></p>
        <p><b>Download:</b> <span id="coloniaDownload">0 Mbps</span></p>
        <p><b>Upload:</b> <span id="coloniaUpload">0 Mbps</span></p>
      </div>
      <div class="panel">
        <h3>POP Armando Mendes</h3>
        <p><b>Status:</b> <span id="armandoStatus">Aguardando</span></p>
        <p><b>CPU:</b> <span id="armandoCpu">0%</span></p>
        <p><b>Clientes PPPoE:</b> <span id="armandoClientes">0</span></p>
        <p><b>Download:</b> <span id="armandoDownload">0 Mbps</span></p>
        <p><b>Upload:</b> <span id="armandoUpload">0 Mbps</span></p>
      </div>
    `;
    if(resumo.nextSibling) content.insertBefore(pops, resumo.nextSibling);
    else content.appendChild(pops);
  }
}

function fibraAtualizarServidorOnlineCard(lista){
  const total = Math.max(2, lista.length || 2);
  const online = lista.filter(fibraEstaOnline).length;

  const candidatos = [
    "servidoresOnline",
    "servidoresOnlineTotal",
    "servidoresOnlineTexto",
    "popsOnline",
    "popsOnlineTotal"
  ];

  candidatos.forEach(id => {
    const el = document.getElementById(id);
    if(el) el.textContent = `${online}/${total}`;
  });

  // Busca card pelo texto "Servidores Online"
  const todos = Array.from(document.querySelectorAll("*"));
  const titulo = todos.find(el => (el.textContent || "").trim().toLowerCase() === "servidores online");
  if(titulo){
    const card = titulo.closest(".card") || titulo.closest(".panel") || titulo.parentElement;
    if(card){
      const spans = Array.from(card.querySelectorAll("span,h2,h3,strong,p,div"));
      const alvo = spans.reverse().find(el => /^\d+\/\d+$/.test((el.textContent || "").trim()));
      if(alvo) alvo.textContent = `${online}/${total}`;
    }
  }
}

function fibraAtualizarResumoPopsFinal(dados){
  if(!fibraPaginaNocPermitida()){
    fibraRemoverNocForaDasPaginas();
    return;
  }

  fibraGarantirResumoEPops();

  const lista = fibraConverterListaServidores(dados);
  if(!lista.length) return;

  const colonia = fibraEncontrarPop(lista, "colonia");
  const armando = fibraEncontrarPop(lista, "armando");

  const clientesOnline = lista.reduce((acc, s) => acc + Number(s.pppoeOnline || 0), 0);
  const cpuMedia = Math.round(lista.reduce((acc, s) => acc + Number(s.cpu || 0), 0) / Math.max(1, lista.length));
  const downloadTotal = Math.round(lista.reduce((acc, s) => acc + fibraMbpsNumero(s.download), 0));
  const uploadTotal = Math.round(lista.reduce((acc, s) => acc + fibraMbpsNumero(s.upload), 0));

  const ultima = lista.map(s => s.atualizadoEm ? new Date(s.atualizadoEm).getTime() : 0).filter(Boolean).sort((a,b)=>b-a)[0];

  const el = id => document.getElementById(id);

  if(el("resumoPops")){
    const popTxt = [
      colonia ? `COLÔNIA ANTÔNIO ALEIXO ${fibraEstaOnline(colonia) ? "🟢" : "🔴"}` : "COLÔNIA ANTÔNIO ALEIXO 🔴",
      armando ? `ARMANDO MENDES ${fibraEstaOnline(armando) ? "🟢" : "🔴"}` : "ARMANDO MENDES 🔴"
    ].join(" | ");
    el("resumoPops").textContent = popTxt;
  }

  if(el("resumoClientesOnline")) el("resumoClientesOnline").textContent = clientesOnline;
  if(el("resumoCpuMedia")) el("resumoCpuMedia").textContent = cpuMedia + "%";
  if(el("resumoDownloadTotal")) el("resumoDownloadTotal").textContent = downloadTotal + " Mbps";
  if(el("resumoUploadTotal")) el("resumoUploadTotal").textContent = uploadTotal + " Mbps";
  if(el("resumoUltimaAtualizacao")) el("resumoUltimaAtualizacao").textContent = ultima ? new Date(ultima).toLocaleString("pt-BR") : "Aguardando envio";

  function preencherPop(prefix, s){
    if(el(prefix + "Status")) el(prefix + "Status").textContent = s && fibraEstaOnline(s) ? "🟢 Online" : "🔴 Offline";
    if(el(prefix + "Cpu")) el(prefix + "Cpu").textContent = (s?.cpu || 0) + "%";
    if(el(prefix + "Clientes")) el(prefix + "Clientes").textContent = s?.pppoeOnline || 0;
    if(el(prefix + "Download")) el(prefix + "Download").textContent = s?.download || "0 Mbps";
    if(el(prefix + "Upload")) el(prefix + "Upload").textContent = s?.upload || "0 Mbps";
  }

  preencherPop("colonia", colonia);
  preencherPop("armando", armando);

  fibraAtualizarServidorOnlineCard(lista);

  // Corrige cards antigos gerais
  if(el("pppoeTotal")) el("pppoeTotal").textContent = clientesOnline;
  if(el("mkCpu")) el("mkCpu").textContent = cpuMedia + "%";
  if(el("downloadTexto")) el("downloadTexto").textContent = downloadTotal + " Mbps";
  if(el("uploadTexto")) el("uploadTexto").textContent = uploadTotal + " Mbps";
  if(el("mkNome")) el("mkNome").textContent = "COLÔNIA + ARMANDO";
  if(el("mkUptime")) el("mkUptime").textContent = `Colônia: ${colonia?.uptime || "--"} | Armando: ${armando?.uptime || "--"}`;
  if(el("mkAtualizado")) el("mkAtualizado").textContent = ultima ? new Date(ultima).toLocaleString("pt-BR") : "Aguardando envio";
}

function fibraAtualizarGraficoTotalFinal(dados){
  if(!fibraPaginaNocPermitida()) return;

  const lista = fibraConverterListaServidores(dados);
  if(!lista.length) return;

  const downloadTotal = lista.reduce((acc, s) => acc + fibraMbpsNumero(s.download), 0);
  const uploadTotal = lista.reduce((acc, s) => acc + fibraMbpsNumero(s.upload), 0);

  if(typeof garantirGrafico === "function") garantirGrafico();

  if(typeof historicoDownloadFibra !== "undefined"){
    historicoDownloadFibra.push(downloadTotal);
    if(historicoDownloadFibra.length > 40) historicoDownloadFibra.shift();
  }

  if(typeof historicoUploadFibra !== "undefined"){
    historicoUploadFibra.push(uploadTotal);
    if(historicoUploadFibra.length > 40) historicoUploadFibra.shift();
  }

  if(document.getElementById("downloadTexto")) document.getElementById("downloadTexto").textContent = Math.round(downloadTotal) + " Mbps";
  if(document.getElementById("uploadTexto")) document.getElementById("uploadTexto").textContent = Math.round(uploadTotal) + " Mbps";

  if(typeof desenharGraficoFibra === "function") desenharGraficoFibra();
}

async function fibraCarregarNocFinal(){
  try{
    const r = await fetch("/api/servidores?_=" + Date.now());
    const dados = await r.json();

    fibraAtualizarResumoPopsFinal(dados);
    fibraAtualizarGraficoTotalFinal(dados);
  }catch(e){
    console.log("Erro NOC final:", e);
  }
}

const fibraCarregarDashboardAnterior = typeof carregarDashboard === "function" ? carregarDashboard : null;
carregarDashboard = async function(){
  if(fibraCarregarDashboardAnterior){
    try{ await fibraCarregarDashboardAnterior(); }catch(e){}
  }
  await fibraCarregarNocFinal();
};

const fibraIniciarSocketAnterior = typeof iniciarSocket === "function" ? iniciarSocket : null;
iniciarSocket = function(){
  if(fibraIniciarSocketAnterior){
    try{ fibraIniciarSocketAnterior(); }catch(e){}
  }
  if(typeof io !== "undefined"){
    try{
      const s = io();
      ["servidores", "status", "status-atualizado", "mikrotik-status", "dashboard"].forEach(ev => {
        s.on(ev, () => fibraCarregarNocFinal());
      });
    }catch(e){}
  }
};

document.addEventListener("DOMContentLoaded", () => {
  fibraRemoverNocForaDasPaginas();
  if(fibraPaginaNocPermitida()){
    fibraGarantirResumoEPops();
    fibraCarregarNocFinal();
    setInterval(fibraCarregarNocFinal, 1000);
  }
});



// ===== REMOÇÃO SEGURA DO RESUMO GERAL =====
function fibraDesativarResumoGeralSeguro(){
  const resumo = document.getElementById("resumoGeralFibra");
  if(resumo){
    resumo.remove();
  }

  document.querySelectorAll("h1,h2,h3,h4").forEach(t => {
    const texto = (t.textContent || "").trim().toLowerCase();
    if(texto === "resumo geral"){
      const painel = t.closest("#resumoGeralFibra");
      if(painel) painel.remove();
    }
  });
}

// Impede a função antiga de criar o Resumo Geral novamente
function fibraGarantirResumoGeral(){ return; }
function fibraAtualizarResumoGeral(){ return; }

// Mantém POPs e gráfico funcionando normalmente
document.addEventListener("DOMContentLoaded", fibraDesativarResumoGeralSeguro);
setTimeout(fibraDesativarResumoGeralSeguro, 300);
setTimeout(fibraDesativarResumoGeralSeguro, 1000);



// ===== POPS SOMENTE DASHBOARD E MONITORAMENTO =====
function paginaPermitePopsFibra(){
  const pagina = (window.location.pathname.split("/").pop() || "index.html").toLowerCase();
  return pagina === "dashboard.html" || pagina === "monitoramento.html";
}

function removerPopsForaDasPaginasFibra(){
  if(paginaPermitePopsFibra()) return;

  const ids = [
    "popsResumo",
    "coloniaStatus",
    "coloniaCpu",
    "coloniaClientes",
    "coloniaDownload",
    "coloniaUpload",
    "armandoStatus",
    "armandoCpu",
    "armandoClientes",
    "armandoDownload",
    "armandoUpload"
  ];

  ids.forEach(id => {
    const el = document.getElementById(id);
    if(el){
      const bloco = el.closest("#popsResumo") || el.closest(".grid-2") || el.closest(".panel") || el.closest("section") || el.parentElement;
      if(bloco) bloco.remove();
      else el.remove();
    }
  });

  document.querySelectorAll("h1,h2,h3,h4").forEach(t => {
    const texto = (t.textContent || "").trim().toLowerCase();
    if(texto.includes("pop colônia") || texto.includes("pop colonia") || texto.includes("pop armando")){
      const bloco = t.closest("#popsResumo") || t.closest(".grid-2") || t.closest(".panel") || t.closest("section") || t.parentElement;
      if(bloco) bloco.remove();
    }
  });
}

// Bloqueia criação de POPs em páginas que não são Dashboard/Monitoramento
const garantirBlocoPopsOriginalFibra = typeof garantirBlocoPops === "function" ? garantirBlocoPops : null;
garantirBlocoPops = function(){
  if(!paginaPermitePopsFibra()){
    removerPopsForaDasPaginasFibra();
    return;
  }
  if(garantirBlocoPopsOriginalFibra) garantirBlocoPopsOriginalFibra();
};

const aplicarPopsEGraficoOriginalPopsFibra = typeof aplicarPopsEGrafico === "function" ? aplicarPopsEGrafico : null;
aplicarPopsEGrafico = function(dados){
  if(!paginaPermitePopsFibra()){
    removerPopsForaDasPaginasFibra();
    return;
  }
  if(aplicarPopsEGraficoOriginalPopsFibra) aplicarPopsEGraficoOriginalPopsFibra(dados);
};

document.addEventListener("DOMContentLoaded", removerPopsForaDasPaginasFibra);
setInterval(removerPopsForaDasPaginasFibra, 1000);



// ===== CORREÇÃO FINAL SERVIDORES ONLINE 2/2 =====
function fibraListaServidoresOnlineFinal(dados){
  if(Array.isArray(dados)) return dados;
  if(dados && typeof dados === "object"){
    return Object.values(dados).filter(s => s && typeof s === "object" && (s.servidor || s.identity || s.nome));
  }
  return [];
}

function fibraIsOnlineFinal(s){
  if(typeof s.online === "boolean") return s.online;
  const t = s.atualizadoEm ? new Date(s.atualizadoEm).getTime() : 0;
  return !!t && (Date.now() - t) < 30000;
}

function fibraAtualizarCardServidoresOnlineFinal(dados){
  const lista = fibraListaServidoresOnlineFinal(dados);
  const total = Math.max(2, lista.length || 2);
  const online = lista.filter(fibraIsOnlineFinal).length;
  const texto = `${online}/${total}`;

  const ids = [
    "servidoresOnline",
    "servidoresOnlineTotal",
    "servidoresOnlineTexto",
    "popsOnline",
    "popsOnlineTotal",
    "serverOnline",
    "servidoresQtd"
  ];

  ids.forEach(id => {
    const el = document.getElementById(id);
    if(el) el.textContent = texto;
  });

  // Procura o card que tem o título "Servidores Online" e atualiza o número dentro dele
  const elementos = Array.from(document.querySelectorAll("div,section,article,.card,.panel"));
  elementos.forEach(card => {
    const txt = (card.innerText || "").toLowerCase();
    if(txt.includes("servidores online")){
      const filhos = Array.from(card.querySelectorAll("h1,h2,h3,h4,p,span,strong,div"));
      let alvo = filhos.find(el => /^\s*\d+\s*\/\s*\d+\s*$/.test(el.textContent || ""));
      if(!alvo){
        alvo = filhos.reverse().find(el => {
          const t = (el.textContent || "").trim();
          return t === "0/2" || t === "1/2" || t === "2/2";
        });
      }
      if(alvo) alvo.textContent = texto;
    }
  });
}

async function fibraBuscarEAtualizarServidoresOnlineFinal(){
  try{
    const r = await fetch("/api/servidores?_=" + Date.now());
    const dados = await r.json();
    fibraAtualizarCardServidoresOnlineFinal(dados);
  }catch(e){}
}

document.addEventListener("DOMContentLoaded", () => {
  fibraBuscarEAtualizarServidoresOnlineFinal();
  setInterval(fibraBuscarEAtualizarServidoresOnlineFinal, 1000);
});

const fibraCarregarDashboardServidorOnlineAnterior = typeof carregarDashboard === "function" ? carregarDashboard : null;
carregarDashboard = async function(){
  if(fibraCarregarDashboardServidorOnlineAnterior){
    try{ await fibraCarregarDashboardServidorOnlineAnterior(); }catch(e){}
  }
  await fibraBuscarEAtualizarServidoresOnlineFinal();
};



// ===== GRÁFICO AO VIVO DETALHADO =====
let historicoTempoFibraDetalhado = [];

function graficoDetalhadoPermitidoFibra(){
  const p = (window.location.pathname.split("/").pop() || "index.html").toLowerCase();
  return p === "dashboard.html" || p === "monitoramento.html";
}

function listaServidoresGraficoFibra(dados){
  if(Array.isArray(dados)) return dados;
  if(dados && typeof dados === "object"){
    return Object.values(dados).filter(s => s && typeof s === "object" && (s.servidor || s.identity || s.nome));
  }
  return [];
}

function mbpsGraficoFibra(v){
  if(v === null || v === undefined) return 0;
  const n = Number(String(v).replace(",", ".").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function garantirGraficoDetalhadoFibra(){
  if(!graficoDetalhadoPermitidoFibra()) return;

  let canvas = document.getElementById("graficoTempoReal");
  if(canvas) return;

  const content = document.querySelector(".content");
  if(!content) return;

  const panel = document.createElement("section");
  panel.className = "panel";
  panel.id = "painelGraficoDetalhadoFibra";
  panel.innerHTML = `
    <h3>Gráfico ao vivo detalhado</h3>
    <div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:12px;font-size:14px">
      <span><b>⬇️ Download total:</b> <span id="downloadTexto">0 Mbps</span></span>
      <span><b>⬆️ Upload total:</b> <span id="uploadTexto">0 Mbps</span></span>
      <span><b>📈 Pico down:</b> <span id="picoDownloadFibra">0 Mbps</span></span>
      <span><b>📈 Pico up:</b> <span id="picoUploadFibra">0 Mbps</span></span>
      <span><b>📊 Média down:</b> <span id="mediaDownloadFibra">0 Mbps</span></span>
      <span><b>📊 Média up:</b> <span id="mediaUploadFibra">0 Mbps</span></span>
    </div>
    <canvas id="graficoTempoReal" class="real-chart" height="280"></canvas>
    <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:10px;font-size:12px;opacity:.8">
      <span>Azul: download total dos dois servidores</span>
      <span>Verde: upload total dos dois servidores</span>
      <span>Histórico: últimos 60 segundos</span>
    </div>
  `;

  content.appendChild(panel);
}

function desenharGraficoFibra(){
  if(!graficoDetalhadoPermitidoFibra()) return;

  garantirGraficoDetalhadoFibra();

  const canvas = document.getElementById("graficoTempoReal");
  if(!canvas) return;

  const ctx = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;

  const width = Math.max(360, Math.floor(rect.width || canvas.parentElement.clientWidth || 800));
  const height = 280;

  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = width + "px";
  canvas.style.height = height + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.clearRect(0, 0, width, height);

  const padL = 52;
  const padR = 18;
  const padT = 18;
  const padB = 34;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  const downloads = historicoDownloadFibra || [];
  const uploads = historicoUploadFibra || [];
  const valores = [...downloads, ...uploads];

  const maxBruto = Math.max(10, ...valores);
  const maxVal = Math.ceil(maxBruto / 10) * 10;

  // Fundo
  ctx.fillStyle = "rgba(255,255,255,.02)";
  ctx.fillRect(padL, padT, innerW, innerH);

  // Grade horizontal e labels
  ctx.font = "11px Arial";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for(let i=0;i<=5;i++){
    const y = padT + (innerH / 5) * i;
    const valor = Math.round(maxVal - (maxVal / 5) * i);

    ctx.strokeStyle = "rgba(120,120,120,.22)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(width - padR, y);
    ctx.stroke();

    ctx.fillStyle = "rgba(160,160,160,.9)";
    ctx.fillText(valor + "M", padL - 8, y);
  }

  // Grade vertical
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const pontos = Math.max(downloads.length, uploads.length);
  for(let i=0;i<=6;i++){
    const x = padL + (innerW / 6) * i;
    ctx.strokeStyle = "rgba(120,120,120,.12)";
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, height - padB);
    ctx.stroke();

    const segundos = Math.max(0, 60 - Math.round((60 / 6) * i));
    ctx.fillStyle = "rgba(160,160,160,.75)";
    ctx.fillText("-" + segundos + "s", x, height - padB + 9);
  }

  function pontoXY(data, i){
    const x = padL + (innerW / Math.max(1, data.length - 1)) * i;
    const y = padT + innerH - ((data[i] / maxVal) * innerH);
    return {x, y};
  }

  function drawArea(data, stroke, fill){
    if(data.length < 2) return;

    ctx.beginPath();
    data.forEach((v, i) => {
      const p = pontoXY(data, i);
      if(i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.lineTo(padL + innerW, padT + innerH);
    ctx.lineTo(padL, padT + innerH);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();

    ctx.beginPath();
    data.forEach((v, i) => {
      const p = pontoXY(data, i);
      if(i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 3;
    ctx.stroke();

    // ponto atual
    const last = pontoXY(data, data.length - 1);
    ctx.beginPath();
    ctx.arc(last.x, last.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = stroke;
    ctx.fill();
  }

  drawArea(downloads, "#3b82f6", "rgba(59,130,246,.14)");
  drawArea(uploads, "#22c55e", "rgba(34,197,94,.12)");

  // Linha base
  ctx.strokeStyle = "rgba(120,120,120,.35)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, padT + innerH);
  ctx.lineTo(width - padR, padT + innerH);
  ctx.stroke();

  // Valor atual na lateral direita
  const downAtual = downloads.length ? downloads[downloads.length - 1] : 0;
  const upAtual = uploads.length ? uploads[uploads.length - 1] : 0;

  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = "bold 12px Arial";
  ctx.fillStyle = "#3b82f6";
  ctx.fillText("Down " + Math.round(downAtual) + "M", padL + 8, padT + 14);
  ctx.fillStyle = "#22c55e";
  ctx.fillText("Up " + Math.round(upAtual) + "M", padL + 110, padT + 14);
}

function atualizarGraficoDetalhadoComServidores(dados){
  if(!graficoDetalhadoPermitidoFibra()) return;

  const lista = listaServidoresGraficoFibra(dados);
  if(!lista.length) return;

  const downloadTotal = lista.reduce((acc, s) => acc + mbpsGraficoFibra(s.download), 0);
  const uploadTotal = lista.reduce((acc, s) => acc + mbpsGraficoFibra(s.upload), 0);

  if(typeof historicoDownloadFibra === "undefined") window.historicoDownloadFibra = [];
  if(typeof historicoUploadFibra === "undefined") window.historicoUploadFibra = [];

  historicoDownloadFibra.push(downloadTotal);
  historicoUploadFibra.push(uploadTotal);
  historicoTempoFibraDetalhado.push(new Date());

  while(historicoDownloadFibra.length > 60) historicoDownloadFibra.shift();
  while(historicoUploadFibra.length > 60) historicoUploadFibra.shift();
  while(historicoTempoFibraDetalhado.length > 60) historicoTempoFibraDetalhado.shift();

  const media = arr => arr.length ? arr.reduce((a,b) => a+b, 0) / arr.length : 0;
  const picoDown = Math.max(0, ...historicoDownloadFibra);
  const picoUp = Math.max(0, ...historicoUploadFibra);

  const set = (id, v) => {
    const el = document.getElementById(id);
    if(el) el.textContent = v;
  };

  set("downloadTexto", Math.round(downloadTotal) + " Mbps");
  set("uploadTexto", Math.round(uploadTotal) + " Mbps");
  set("picoDownloadFibra", Math.round(picoDown) + " Mbps");
  set("picoUploadFibra", Math.round(picoUp) + " Mbps");
  set("mediaDownloadFibra", Math.round(media(historicoDownloadFibra)) + " Mbps");
  set("mediaUploadFibra", Math.round(media(historicoUploadFibra)) + " Mbps");

  desenharGraficoFibra();
}

async function carregarGraficoDetalhadoFibra(){
  if(!graficoDetalhadoPermitidoFibra()) return;
  try{
    const r = await fetch("/api/servidores?_=" + Date.now());
    const dados = await r.json();
    atualizarGraficoDetalhadoComServidores(dados);
  }catch(e){}
}

const carregarDashboardGraficoDetalhadoAnterior = typeof carregarDashboard === "function" ? carregarDashboard : null;
carregarDashboard = async function(){
  if(carregarDashboardGraficoDetalhadoAnterior){
    try{ await carregarDashboardGraficoDetalhadoAnterior(); }catch(e){}
  }
  await carregarGraficoDetalhadoFibra();
};

document.addEventListener("DOMContentLoaded", () => {
  if(graficoDetalhadoPermitidoFibra()){
    garantirGraficoDetalhadoFibra();
    carregarGraficoDetalhadoFibra();
    setInterval(carregarGraficoDetalhadoFibra, 1000);
  }
});



// ===== EXIBIR TODOS OS CLIENTES ONLINE DOS POPS =====
function fibraListaServidoresClientesTodos(dados){
  if(Array.isArray(dados)) return dados;
  if(dados && typeof dados === "object"){
    return Object.values(dados).filter(s => s && typeof s === "object" && (s.servidor || s.identity || s.nome));
  }
  return [];
}

function fibraNomePopClienteTodos(s){
  const nome = String(s.servidor || s.identity || s.nome || "").toLowerCase();
  if(nome.includes("colonia") || nome.includes("coln") || nome.includes("colônia")) return "COLÔNIA";
  if(nome.includes("armando")) return "ARMANDO";
  return String(s.nome || s.identity || s.servidor || "--").toUpperCase();
}

function fibraMontarListaClientesTodos(dados){
  const lista = fibraListaServidoresClientesTodos(dados);
  const todos = [];

  lista.forEach(s => {
    const pop = fibraNomePopClienteTodos(s);
    const clientes = Array.isArray(s.clientes) ? s.clientes : [];
    clientes.forEach(c => {
      todos.push({
        pop,
        nome: c.nome || c.name || c.cliente || "--",
        plano: c.plano || c.profile || "PPPoE",
        ip: c.ip || c.address || "--",
        uptime: c.uptime || "--",
        mac: c.mac || c["caller-id"] || "--"
      });
    });
  });

  return todos;
}

function fibraAtualizarTabelaClientesTodos(dados){
  const tbody = document.getElementById("clientesTabela") || document.getElementById("clientesOnlineTabela") || document.getElementById("pppoeTabela");
  if(!tbody) return;

  const clientes = fibraMontarListaClientesTodos(dados);

  if(!clientes.length){
    tbody.innerHTML = '<tr><td colspan="6">Aguardando clientes online...</td></tr>';
    return;
  }

  tbody.innerHTML = clientes.map(c => `
    <tr>
      <td>${c.nome}</td>
      <td>${c.pop}</td>
      <td>${c.plano}</td>
      <td>${c.ip}</td>
      <td>${c.uptime}</td>
      <td>🟢 Online</td>
    </tr>
  `).join("");

  const totalEl = document.getElementById("totalClientesTabela") || document.getElementById("clientesTabelaTotal");
  if(totalEl) totalEl.textContent = clientes.length;
}

async function fibraBuscarClientesTodos(){
  try{
    const r = await fetch("/api/servidores?_=" + Date.now());
    const dados = await r.json();
    fibraAtualizarTabelaClientesTodos(dados);
  }catch(e){}
}

const carregarDashboardClientesTodosAnterior = typeof carregarDashboard === "function" ? carregarDashboard : null;
carregarDashboard = async function(){
  if(carregarDashboardClientesTodosAnterior){
    try{ await carregarDashboardClientesTodosAnterior(); }catch(e){}
  }
  await fibraBuscarClientesTodos();
};

document.addEventListener("DOMContentLoaded", () => {
  fibraBuscarClientesTodos();
  
});



// ===== TABELA CLIENTES PPPoE ESTÁVEL SEM PISCAR =====
let fibraClientesUltimaAtualizacao = 0;
let fibraClientesAtualizando = false;
let fibraClientesUltimaAssinatura = "";

function fibraTabelaClientesPermitida(){
  const pagina = (window.location.pathname.split("/").pop() || "").toLowerCase();
  return pagina === "dashboard.html" || pagina === "monitoramento.html";
}

function fibraAssinaturaClientes(clientes){
  return clientes.map(c => `${c.pop}|${c.nome}|${c.ip}|${c.uptime}|${c.mac}`).join(";");
}

function fibraRenderizarClientesEstavel(clientes){
  const tbody = document.getElementById("clientesTabela") || document.getElementById("clientesOnlineTabela") || document.getElementById("pppoeTabela");
  if(!tbody) return;

  const assinatura = fibraAssinaturaClientes(clientes);
  if(assinatura === fibraClientesUltimaAssinatura) return;

  fibraClientesUltimaAssinatura = assinatura;

  const scrollBox = tbody.closest(".table-wrap") || tbody.closest(".panel") || window;
  const scrollTop = scrollBox === window ? window.scrollY : scrollBox.scrollTop;

  if(!clientes.length){
    tbody.innerHTML = '<tr><td colspan="6">Aguardando clientes online...</td></tr>';
  }else{
    tbody.innerHTML = clientes.map(c => `
      <tr data-cliente="${c.pop}-${c.nome}">
        <td>${c.nome}</td>
        <td>${c.pop}</td>
        <td>${c.plano}</td>
        <td>${c.ip}</td>
        <td>${c.uptime}</td>
        <td>🟢 Online</td>
      </tr>
    `).join("");
  }

  if(scrollBox === window) window.scrollTo(0, scrollTop);
  else scrollBox.scrollTop = scrollTop;

  const totalEl = document.getElementById("totalClientesTabela") || document.getElementById("clientesTabelaTotal");
  if(totalEl) totalEl.textContent = clientes.length;
}

async function fibraBuscarClientesTodosEstavel(forcar=false){
  if(!fibraTabelaClientesPermitida()) return;
  if(fibraClientesAtualizando) return;

  const agora = Date.now();
  if(!forcar && (agora - fibraClientesUltimaAtualizacao) < 15000) return;

  fibraClientesAtualizando = true;

  try{
    const r = await fetch("/api/servidores?_=" + Date.now());
    const dados = await r.json();

    const clientes = typeof fibraMontarListaClientesTodos === "function"
      ? fibraMontarListaClientesTodos(dados)
      : [];

    fibraRenderizarClientesEstavel(clientes);
    fibraClientesUltimaAtualizacao = Date.now();
  }catch(e){
    console.log("Erro ao atualizar clientes PPPoE:", e);
  }finally{
    fibraClientesAtualizando = false;
  }
}

// Desativa atualização agressiva antiga da tabela, mantendo esta estável
const fibraBuscarClientesTodosAntigo = typeof fibraBuscarClientesTodos === "function" ? fibraBuscarClientesTodos : null;
fibraBuscarClientesTodos = async function(){
  await fibraBuscarClientesTodosEstavel(false);
};

const fibraAtualizarTabelaClientesTodosAntigo = typeof fibraAtualizarTabelaClientesTodos === "function" ? fibraAtualizarTabelaClientesTodos : null;
fibraAtualizarTabelaClientesTodos = function(dados){
  if(!fibraTabelaClientesPermitida()) return;
  const clientes = typeof fibraMontarListaClientesTodos === "function"
    ? fibraMontarListaClientesTodos(dados)
    : [];
  fibraRenderizarClientesEstavel(clientes);
  fibraClientesUltimaAtualizacao = Date.now();
};

document.addEventListener("DOMContentLoaded", () => {
  fibraBuscarClientesTodosEstavel(true);
  
});



// ===== CORREÇÃO FINAL CLIENTES PPPoE SEM PISCAR =====
let fibraClientesRenderLiberadoFinal = false;
let fibraClientesAssinaturaFinal = "";
let fibraClientesUltimoRenderFinal = 0;
let fibraClientesTimerFinal = null;

function fibraPaginaComClientesFinal(){
  const p = (window.location.pathname.split("/").pop() || "").toLowerCase();
  return p === "dashboard.html" || p === "monitoramento.html";
}

function fibraTbodyClientesFinal(){
  return document.getElementById("clientesTabela") ||
         document.getElementById("clientesOnlineTabela") ||
         document.getElementById("pppoeTabela");
}

function fibraServidoresParaListaFinal(dados){
  if(Array.isArray(dados)) return dados;
  if(dados && typeof dados === "object"){
    return Object.values(dados).filter(s => s && typeof s === "object" && (s.servidor || s.identity || s.nome || s.clientes));
  }
  return [];
}

function fibraPopNomeFinal(s){
  const nome = String(s.servidor || s.identity || s.nome || "").toLowerCase();
  if(nome.includes("colonia") || nome.includes("colônia") || nome.includes("coln")) return "COLÔNIA";
  if(nome.includes("armando")) return "ARMANDO";
  return String(s.nome || s.identity || s.servidor || "--").toUpperCase();
}

function fibraClientesDeServidoresFinal(dados){
  const servidores = fibraServidoresParaListaFinal(dados);
  const clientes = [];

  servidores.forEach(s => {
    const pop = fibraPopNomeFinal(s);
    const lista = Array.isArray(s.clientes) ? s.clientes : [];

    lista.forEach(c => {
      clientes.push({
        pop: pop,
        nome: c.nome || c.name || c.cliente || "--",
        plano: c.plano || c.profile || "PPPoE",
        ip: c.ip || c.address || "--",
        uptime: c.uptime || "--",
        mac: c.mac || c["caller-id"] || "--"
      });
    });
  });

  clientes.sort((a,b) => {
    if(a.pop !== b.pop) return a.pop.localeCompare(b.pop);
    return a.nome.localeCompare(b.nome);
  });

  return clientes;
}

function fibraAssinaturaClientesFinal(clientes){
  return clientes.map(c => `${c.pop}|${c.nome}|${c.ip}|${c.uptime}|${c.mac}`).join(";");
}

function fibraHtmlClientesFinal(clientes){
  if(!clientes.length){
    return '<tr><td colspan="6">Aguardando clientes online...</td></tr>';
  }

  return clientes.map(c => `
    <tr>
      <td>${c.nome}</td>
      <td>${c.pop}</td>
      <td>${c.plano}</td>
      <td>${c.ip}</td>
      <td>${c.uptime}</td>
      <td>🟢 Online</td>
    </tr>
  `).join("");
}

function fibraRenderClientesFinal(clientes, forcar=false){
  const tbody = fibraTbodyClientesFinal();
  if(!tbody) return;

  const assinatura = fibraAssinaturaClientesFinal(clientes);
  const agora = Date.now();

  if(!forcar && assinatura === fibraClientesAssinaturaFinal) return;
  if(!forcar && (agora - fibraClientesUltimoRenderFinal) < 12000) return;

  fibraClientesAssinaturaFinal = assinatura;
  fibraClientesUltimoRenderFinal = agora;

  const container = tbody.closest(".table-wrap") || tbody.closest(".panel") || document.scrollingElement;
  const scrollTop = container ? container.scrollTop : 0;

  fibraClientesRenderLiberadoFinal = true;
  tbody.innerHTML = fibraHtmlClientesFinal(clientes);
  fibraClientesRenderLiberadoFinal = false;

  if(container) container.scrollTop = scrollTop;

  const totalEl = document.getElementById("totalClientesTabela") || document.getElementById("clientesTabelaTotal");
  if(totalEl) totalEl.textContent = clientes.length;
}

async function fibraAtualizarClientesFinal(forcar=false){
  if(!fibraPaginaComClientesFinal()) return;

  try{
    const r = await fetch("/api/servidores?_=" + Date.now());
    const dados = await r.json();
    const clientes = fibraClientesDeServidoresFinal(dados);
    fibraRenderClientesFinal(clientes, forcar);
  }catch(e){
    console.log("Erro clientes final:", e);
  }
}

// Bloqueia escritas antigas na tabela de clientes que causavam piscar.
(function(){
  const desc = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
  if(!desc || !desc.set || window.__fibraInnerHTMLProtegidoClientes) return;

  window.__fibraInnerHTMLProtegidoClientes = true;

  Object.defineProperty(Element.prototype, "innerHTML", {
    get: desc.get,
    set: function(valor){
      try{
        const id = this.id || "";
        const isTabelaClientes = id === "clientesTabela" || id === "clientesOnlineTabela" || id === "pppoeTabela";

        if(isTabelaClientes && !fibraClientesRenderLiberadoFinal){
          // Permite só mensagens iniciais antes do render final existir.
          const texto = String(valor || "").toLowerCase();
          if(fibraClientesAssinaturaFinal && (texto.includes("aguardando") || texto.includes("<tr"))){
            return;
          }
        }
      }catch(e){}

      return desc.set.call(this, valor);
    }
  });
})();

// Desativa funções antigas agressivas
fibraBuscarClientesTodos = async function(){ return fibraAtualizarClientesFinal(false); };
fibraAtualizarTabelaClientesTodos = function(dados){
  const clientes = fibraClientesDeServidoresFinal(dados);
  fibraRenderClientesFinal(clientes, false);
};
fibraBuscarClientesTodosEstavel = async function(forcar=false){ return fibraAtualizarClientesFinal(forcar); };

document.addEventListener("DOMContentLoaded", () => {
  if(!fibraPaginaComClientesFinal()) return;

  fibraAtualizarClientesFinal(true);

  if(fibraClientesTimerFinal) clearInterval(fibraClientesTimerFinal);
  fibraClientesTimerFinal = setInterval(() => fibraAtualizarClientesFinal(false), 15000);
});



// ===== REMOVER SOMENTE CLIENTES PPPoE DO DASHBOARD =====
function fibraRemoverClientesPppoeSomenteDashboard(){
  const pagina = (window.location.pathname.split("/").pop() || "").toLowerCase();
  if(pagina !== "dashboard.html") return;

  const ids = ["clientesTabela", "clientesOnlineTabela", "pppoeTabela"];

  ids.forEach(id => {
    const el = document.getElementById(id);
    if(el){
      const bloco = el.closest(".panel") || el.closest("section") || el.closest(".card") || el.closest("article") || el.closest("table")?.parentElement;
      if(bloco) bloco.remove();
      else el.remove();
    }
  });

  document.querySelectorAll(".panel, section, article, .card").forEach(bloco => {
    const texto = (bloco.innerText || "").toLowerCase();
    if(
      texto.includes("clientes pppoe online") ||
      texto.includes("sessões pppoe online") ||
      texto.includes("sessoes pppoe online")
    ){
      bloco.remove();
    }
  });
}

document.addEventListener("DOMContentLoaded", fibraRemoverClientesPppoeSomenteDashboard);
setTimeout(fibraRemoverClientesPppoeSomenteDashboard, 500);
setTimeout(fibraRemoverClientesPppoeSomenteDashboard, 1500);
setInterval(fibraRemoverClientesPppoeSomenteDashboard, 3000);



// ===== PPPoE TOTAL FIXO SOMANDO COLÔNIA + ARMANDO =====
let fibraPppoeTotalFixoAtual = null;

function fibraArrayServidoresTotalFixo(dados){
  if(Array.isArray(dados)) return dados;
  if(dados && typeof dados === "object"){
    return Object.values(dados).filter(s => s && typeof s === "object" && (s.servidor || s.identity || s.nome || s.pppoeOnline !== undefined));
  }
  return [];
}

function fibraCalcularPppoeTotalFixo(dados){
  const lista = fibraArrayServidoresTotalFixo(dados);
  if(!lista.length) return null;

  const somaPppoe = lista.reduce((acc, s) => acc + Number(s.pppoeOnline || 0), 0);
  const somaClientes = lista.reduce((acc, s) => acc + (Array.isArray(s.clientes) ? s.clientes.length : 0), 0);

  return Math.max(somaPppoe, somaClientes);
}

function fibraAplicarPppoeTotalFixo(total){
  if(total === null || total === undefined || Number.isNaN(Number(total))) return;

  fibraPppoeTotalFixoAtual = Number(total);

  const ids = [
    "pppoeTotal",
    "totalPppoe",
    "pppoeOnlineTotal",
    "clientesOnline",
    "clientesOnlineTotal"
  ];

  ids.forEach(id => {
    const el = document.getElementById(id);
    if(el) el.textContent = fibraPppoeTotalFixoAtual;
  });

  // Corrige o card "PPPoE Total"
  document.querySelectorAll(".card,.stat-card,.info-card,.panel,section,div").forEach(card => {
    const txt = (card.innerText || "").toLowerCase();
    if(txt.includes("pppoe total")){
      const filhos = Array.from(card.querySelectorAll("h1,h2,h3,h4,p,span,strong,div"));
      const alvo = filhos.reverse().find(el => /^\s*\d+\s*$/.test(el.textContent || ""));
      if(alvo) alvo.textContent = fibraPppoeTotalFixoAtual;
    }
  });
}

async function fibraAtualizarPppoeTotalFixo(){
  try{
    const r = await fetch("/api/servidores?_=" + Date.now());
    const dados = await r.json();
    const total = fibraCalcularPppoeTotalFixo(dados);
    fibraAplicarPppoeTotalFixo(total);
  }catch(e){}
}

// Protege contra scripts antigos que colocam apenas 17 ou apenas 62/63
(function(){
  if(window.__fibraProtegePppoeTotalFixo) return;
  window.__fibraProtegePppoeTotalFixo = true;

  const desc = Object.getOwnPropertyDescriptor(Node.prototype, "textContent");
  if(!desc || !desc.set) return;

  Object.defineProperty(Node.prototype, "textContent", {
    get: desc.get,
    set: function(valor){
      try{
        const id = this.id || "";
        const ehTotal = ["pppoeTotal","totalPppoe","pppoeOnlineTotal","clientesOnline","clientesOnlineTotal"].includes(id);

        if(ehTotal && fibraPppoeTotalFixoAtual !== null){
          const n = Number(String(valor).replace(/\D/g, ""));
          if(n && n !== fibraPppoeTotalFixoAtual){
            return desc.set.call(this, String(fibraPppoeTotalFixoAtual));
          }
        }
      }catch(e){}

      return desc.set.call(this, valor);
    }
  });
})();

const carregarDashboardPppoeTotalFixoAnterior = typeof carregarDashboard === "function" ? carregarDashboard : null;
carregarDashboard = async function(){
  if(carregarDashboardPppoeTotalFixoAnterior){
    try{ await carregarDashboardPppoeTotalFixoAnterior(); }catch(e){}
  }
  await fibraAtualizarPppoeTotalFixo();
};

document.addEventListener("DOMContentLoaded", () => {
  fibraAtualizarPppoeTotalFixo();
  setInterval(fibraAtualizarPppoeTotalFixo, 1000);
});



// ===== CORREÇÃO PC + CELULAR / MENU MOBILE =====
function fecharMenuMobileSeguro(){
  try{
    document.body.classList.remove("menu-open");
    document.body.classList.remove("sidebar-open");
    document.documentElement.classList.remove("menu-open");

    const sidebar = document.querySelector(".sidebar");
    if(sidebar){
      sidebar.classList.remove("open");
      sidebar.classList.remove("active");
      sidebar.classList.remove("show");
    }

    const overlay = document.querySelector(".overlay");
    if(overlay){
      overlay.classList.remove("open");
      overlay.classList.remove("active");
      overlay.style.display = "";
      overlay.style.pointerEvents = "";
    }
  }catch(e){}
}

function abrirMenu(){
  document.body.classList.add("menu-open");
  const sidebar = document.querySelector(".sidebar");
  if(sidebar) sidebar.classList.add("open");
  const overlay = document.querySelector(".overlay");
  if(overlay) overlay.classList.add("active");
}

function fecharMenu(){
  fecharMenuMobileSeguro();
}

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".nav a").forEach(link => {
    link.addEventListener("click", () => {
      if(window.innerWidth <= 900){
        fecharMenuMobileSeguro();
      }
    });
  });

  const overlay = document.querySelector(".overlay");
  if(overlay){
    overlay.addEventListener("click", fecharMenuMobileSeguro);
  }

  document.addEventListener("keydown", (e) => {
    if(e.key === "Escape") fecharMenuMobileSeguro();
  });

  window.addEventListener("resize", () => {
    if(window.innerWidth > 900){
      fecharMenuMobileSeguro();
    }
  });
});

window.addEventListener("pageshow", fecharMenuMobileSeguro);



// ===== BLOQUEIO DO RENDER ANTIGO DA ABA CLIENTES =====
// O app.js antigo usava "clientesTabela" e desenhava só Login PPPoE.
// A aba clientes.html agora usa "clientesReceitaFinalTabela" e render próprio.
(function(){
  const page = (location.pathname.split("/").pop() || "").toLowerCase();
  if(page !== "clientes.html") return;

  // impede funções antigas de sobrescreverem a lista de clientes
  window.carregarClientes = window.carregarClientesReceitaFinal || function(){};
  window.renderClientes = window.renderClientesReceitaFinal || function(){};
  window.listarClientes = window.carregarClientesReceitaFinal || function(){};
  window.atualizarClientes = window.carregarClientesReceitaFinal || function(){};

  // protege qualquer tbody antigo chamado clientesTabela caso exista no HTML por cache
  setTimeout(function(){
    const antigo = document.getElementById("clientesTabela");
    if(antigo && document.getElementById("clientesReceitaFinalTabela")){
      antigo.id = "clientesTabelaAntigaDesativada";
    }
  }, 50);
})();



// ===== AUDITORIA FINAL: NÃO SOBRESCREVER ABA CLIENTES =====
(function(){
  const pagina = (location.pathname.split("/").pop() || "").toLowerCase();
  if(pagina !== "clientes.html") return;

  // Evita que funções antigas do app.js renderizem só Login PPPoE.
  window.__FIBRA_CLIENTES_AUDITORIA__ = true;

  const nomesAntigos = [
    "carregarClientes",
    "renderClientes",
    "listarClientes",
    "atualizarClientes",
    "carregarClientesManual",
    "renderClientesManual",
    "carregarClientesPainel",
    "renderClientesPainel",
    "carregarClientesCompletos",
    "renderClientesCompletos",
    "carregarClientesForcado",
    "renderClientesForcado"
  ];

  nomesAntigos.forEach(nome => {
    try{
      window[nome] = function(){
        if(typeof window.carregarClientesHub === "function"){
          return window.carregarClientesHub();
        }
      };
    }catch(e){}
  });
})();


/* ============================================================
   AJUSTE: REMOVER GRÁFICO EM TEMPO REAL
   Mantém dashboard, clientes online e atualização dos dados,
   mas impede a criação/exibição do canvas graficoTempoReal.
============================================================ */
(function(){
  function removerGraficoTempoReal(){
    const canvas = document.getElementById("graficoTempoReal");
    if(canvas){
      const bloco = canvas.closest(".panel") || canvas.parentElement;
      if(bloco) bloco.remove();
    }

    document.querySelectorAll(".panel").forEach(panel => {
      const titulo = (panel.querySelector("h3")?.textContent || "").toLowerCase();
      if(titulo.includes("gráfico ao vivo") || titulo.includes("grafico ao vivo")){
        panel.remove();
      }
    });
  }

  window.garantirGrafico = function(){
    removerGraficoTempoReal();
  };

  window.desenharGraficoFibra = function(){
    removerGraficoTempoReal();
  };

  window.fibraGraficoPermitido = function(){
    return false;
  };

  document.addEventListener("DOMContentLoaded", removerGraficoTempoReal);
  setTimeout(removerGraficoTempoReal, 500);
  setTimeout(removerGraficoTempoReal, 1500);
})();


/* ============================================================
   FIBRA HUB - CORREÇÃO FINAL LIMPA
   - Login reconhece fibra_logado e fibraLogado.
   - Clientes importados continuam na lista.
   - Clientes PPPoE online aparecem em seção separada.
   - Clique em cliente abre os dados.
============================================================ */

function fibraEscapeHtml(v){
  return String(v ?? "").replace(/[&<>"']/g, s => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[s]));
}
function fibraPrimeiroValor(c, campos){
  for(const campo of campos){
    const v = c && c[campo];
    if(v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}
function fibraSetCampo(ids, valor){
  ids.forEach(id => { const el=document.getElementById(id); if(el) el.value = valor || ""; });
}
function fibraGetClientesImportados(){
  try{ const a=JSON.parse(localStorage.getItem("clientes") || "[]"); return Array.isArray(a)?a:[]; }catch(e){ return []; }
}
function fibraChaveCliente(c){
  return String(fibraPrimeiroValor(c,["loginPppoe","login","usuario","user","name","pppoe"]) || fibraPrimeiroValor(c,["nome","cliente","razaoSocial"])).toLowerCase().trim();
}
function fibraNomeServidor(chave){
  const k=String(chave||"").toLowerCase();
  if(k.includes("arm")) return "Armando Mendes";
  if(k.includes("col")) return "Colônia Antônio Aleixo";
  return chave || "Servidor";
}
async function fibraFetchJson(path){
  const r = await fetch(path, { cache:"no-store" });
  const t = await r.text();
  try{return JSON.parse(t)}catch(e){return {ok:false, erro:t||r.statusText}}
}
function abrirClienteOnline(cliente){
  localStorage.setItem("clienteOnlineSelecionado", JSON.stringify(cliente || {}));
  localStorage.setItem("clienteEditarLogin", cliente.login || cliente.usuario || cliente.name || cliente.nome || "");
  window.location.href = "cliente.html";
}
function fibraAbrirClienteImportado(c){
  localStorage.setItem("clienteSelecionadoCompleto", JSON.stringify(c || {}));
  localStorage.setItem("clienteEditarLogin", fibraChaveCliente(c));
  window.location.href = "cliente.html";
}
function carregarClienteSelecionadoNoCadastro(){
  let c=null;
  try{ const salvo=localStorage.getItem("clienteSelecionadoCompleto"); if(salvo) c=JSON.parse(salvo); }catch(e){}
  if(!c){
    const login=String(localStorage.getItem("clienteEditarLogin")||"").toLowerCase().trim();
    if(login) c=fibraGetClientesImportados().find(x=>fibraChaveCliente(x)===login);
  }
  if(!c) return false;
  fibraSetCampo(["cadLogin","pppoe"], fibraPrimeiroValor(c,["loginPppoe","login","usuario","user","name","pppoe"]));
  fibraSetCampo(["cadSenha","senha"], fibraPrimeiroValor(c,["senhaPppoe","senha","password"]));
  fibraSetCampo(["cadNome","nome"], fibraPrimeiroValor(c,["nome","cliente","razaoSocial"]));
  fibraSetCampo(["cadCpf","cpf"], fibraPrimeiroValor(c,["cpfCnpj","cpf","cnpj","documento"]));
  fibraSetCampo(["cadEmail","email"], fibraPrimeiroValor(c,["email","e_mail"]));
  fibraSetCampo(["cadTelefone1","telefone"], fibraPrimeiroValor(c,["telefone1","telefone","celular","fone"]));
  fibraSetCampo(["cadEndereco","endereco"], fibraPrimeiroValor(c,["endereco","logradouro","rua"]));
  fibraSetCampo(["cadBairro","bairro"], fibraPrimeiroValor(c,["bairro"]));
  fibraSetCampo(["cadCep","cep"], fibraPrimeiroValor(c,["cep"]));
  fibraSetCampo(["cadPlano","plano"], fibraPrimeiroValor(c,["plano","profile"]));
  fibraSetCampo(["cadValor","valor"], fibraPrimeiroValor(c,["valorMensal","valor"]));
  fibraSetCampo(["cadPop","servidorCliente"], fibraPrimeiroValor(c,["popServidor","servidor","pop"]));
  fibraSetCampo(["cadIp"], fibraPrimeiroValor(c,["ip","address"]));
  fibraSetCampo(["cadMac"], fibraPrimeiroValor(c,["mac","callerId","caller-id"]));
  if(typeof atualizarResumoCadastro === "function") atualizarResumoCadastro();
  return true;
}

function carregarClienteDetalhes(){
  const box=document.getElementById("clienteDetalhes");
  if(!box) return;
  let c=null;
  try{ const a=localStorage.getItem("clienteOnlineSelecionado"); if(a) c=JSON.parse(a); }catch(e){}
  if(!c){ try{ const a=localStorage.getItem("clienteSelecionadoCompleto"); if(a) c=JSON.parse(a); }catch(e){} }
  if(!c){ const login=String(localStorage.getItem("clienteEditarLogin")||"").toLowerCase().trim(); if(login) c=fibraGetClientesImportados().find(x=>fibraChaveCliente(x)===login); }
  if(!c){ box.innerHTML='<section class="panel"><h3>Cliente não selecionado</h3><p>Volte para a lista de clientes e clique em um cliente.</p></section>'; return; }
  const login=fibraPrimeiroValor(c,["login","usuario","name","loginPppoe","pppoe"]);
  const nome=fibraPrimeiroValor(c,["nome","cliente","razaoSocial"]) || login;
  const servidor=fibraPrimeiroValor(c,["servidor","pop","popServidor"]);
  const ip=fibraPrimeiroValor(c,["ip","address"]);
  const mac=fibraPrimeiroValor(c,["mac","callerId","caller-id"]);
  const uptime=fibraPrimeiroValor(c,["uptime"]);
  const plano=fibraPrimeiroValor(c,["plano","profile"]) || "PPPoE";
  const telefone=fibraPrimeiroValor(c,["telefone1","telefone","celular","fone"]);
  const endereco=fibraPrimeiroValor(c,["endereco","logradouro","rua"]);
  box.innerHTML=`
    <div class="grid-2">
      <section class="panel"><h3>Dados do Cliente</h3><p><b>Login:</b> ${fibraEscapeHtml(login||"--")}</p><p><b>Nome:</b> ${fibraEscapeHtml(nome||"--")}</p><p><b>Telefone:</b> ${fibraEscapeHtml(telefone||"--")}</p><p><b>Endereço:</b> ${fibraEscapeHtml(endereco||"--")}</p><p><b>Status:</b> 🟢 Online/Importado</p></section>
      <section class="panel"><h3>Conexão PPPoE</h3><p><b>Servidor:</b> ${fibraEscapeHtml(fibraNomeServidor(servidor)||"--")}</p><p><b>Plano/Profile:</b> ${fibraEscapeHtml(plano||"--")}</p><p><b>IP:</b> ${fibraEscapeHtml(ip||"--")}</p><p><b>MAC/Caller ID:</b> ${fibraEscapeHtml(mac||"--")}</p><p><b>Tempo conectado:</b> ${fibraEscapeHtml(uptime||"--")}</p></section>
    </div><section class="panel"><h3>Ações</h3><button onclick="localStorage.setItem('clienteSelecionadoCompleto', JSON.stringify(JSON.parse(localStorage.getItem('clienteOnlineSelecionado')||localStorage.getItem('clienteSelecionadoCompleto')||'{}'))); location.href='cadastro.html'">Abrir no Cadastro</button> <button onclick="history.back()">Voltar</button></section>`;
}

function fibraGarantirSecaoOnline(){
  if(document.getElementById("fibraOnlineSeparado")) return;
  const pagina=window.location.pathname.split('/').pop();
  if(!["clientes.html","dashboard.html","servidores.html","pppoe.html"].includes(pagina)) return;
  const main=document.querySelector("main .content") || document.querySelector("main") || document.body;
  const sec=document.createElement("section");
  sec.id="fibraOnlineSeparado";
  sec.className="panel";
  sec.innerHTML=`<h2>Clientes PPPoE Online</h2><p>Lista vinda da API MikroTik. Não substitui os clientes importados.</p><div id="fibraResumoServidores" class="servers-grid"></div><table class="data-table"><thead><tr><th>Login</th><th>Servidor</th><th>IP</th><th>MAC</th><th>Uptime</th><th>Status</th></tr></thead><tbody id="fibraTbodyOnlineSeparado"><tr><td colspan="6">Carregando...</td></tr></tbody></table>`;
  main.appendChild(sec);
}
function fibraCardServidor(nome, ok, total, erro){return `<div class="server-card ${ok?'online':'offline'}"><div class="server-head"><div><h3>${fibraEscapeHtml(nome)}</h3><small>${ok?'Conectado':'Sem conexão'}</small></div><span class="${ok?'badge-online':'badge-offline'}">${ok?'Online':'Offline'}</span></div><div class="server-metrics"><div><b>${total||0}</b><span>PPPoE online</span></div></div>${erro?`<p class="server-error">${fibraEscapeHtml(erro)}</p>`:''}</div>`}
async function fibraCarregarOnlineSeparado(){
  fibraGarantirSecaoOnline();
  const tbody=document.getElementById("fibraTbodyOnlineSeparado"); if(!tbody) return;
  const resumo=document.getElementById("fibraResumoServidores");
  try{
    const dados=await fibraFetchJson('/api/online');
    const arm=dados?.servidores?.armando||{}; const col=dados?.servidores?.colonia||{};
    if(resumo) resumo.innerHTML=fibraCardServidor('Armando Mendes',!!arm.ok,arm.total||(arm.clientes||[]).length,arm.erro)+fibraCardServidor('Colônia Antônio Aleixo',!!col.ok,col.total||(col.clientes||[]).length,col.erro);
    const lista=Array.isArray(dados.clientes)?dados.clientes:[];
    if(!lista.length){ tbody.innerHTML='<tr><td colspan="6">Nenhum cliente PPPoE online encontrado.</td></tr>'; return; }
    tbody.innerHTML=lista.map(c=>{ const cliente={login:c.usuario||c.name||c.login||'',nome:c.nome||c.usuario||c.name||'',servidor:c.servidor||'',pop:c.servidor||'',ip:c.ip||c.address||'',mac:c.callerId||c.mac||c['caller-id']||'',uptime:c.uptime||'',service:c.service||'pppoe',raw:c}; return `<tr class="linha-clicavel" onclick='abrirClienteOnline(${JSON.stringify(cliente).replace(/'/g,"&apos;")})'><td>${fibraEscapeHtml(cliente.login)}</td><td>${fibraEscapeHtml(fibraNomeServidor(cliente.servidor))}</td><td>${fibraEscapeHtml(cliente.ip)}</td><td>${fibraEscapeHtml(cliente.mac)}</td><td>${fibraEscapeHtml(cliente.uptime)}</td><td>🟢 Online</td></tr>`; }).join('');
  }catch(e){ tbody.innerHTML=`<tr><td colspan="6">Erro ao carregar: ${fibraEscapeHtml(e.message)}</td></tr>`; }
}

document.addEventListener('DOMContentLoaded',()=>{ setTimeout(()=>{ fibraCarregarOnlineSeparado(); carregarClienteSelecionadoNoCadastro(); },500); });


/* Compatibilidade base de clientes importados ReceitaNet */
function fibraGetBaseClientesImportados(){
  const chaves = ["clientes", "clientesReceitaNet", "fibra_clientes", "clientes_importados"];
  for(const chave of chaves){
    try{
      const raw = localStorage.getItem(chave);
      if(!raw) continue;
      const lista = JSON.parse(raw);
      if(Array.isArray(lista) && lista.length) return lista;
    }catch(e){}
  }
  return [];
}



/* ============================================================
   CORREÇÃO: AO CLICAR EM CLIENTES, ABRIR CADASTRO PREENCHIDO
============================================================ */

function fibraNorm(v){
  return String(v || "").toLowerCase().trim();
}

function fibraCampo(c, campos){
  for(const campo of campos){
    const v = c && c[campo];
    if(v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

function fibraSet(ids, valor){
  ids.forEach(id => {
    const el = document.getElementById(id);
    if(el) el.value = valor || "";
  });
}

function fibraClientesBase(){
  const chaves = ["clientes", "clientesReceitaNet", "fibra_clientes", "clientes_importados"];
  for(const chave of chaves){
    try{
      const raw = localStorage.getItem(chave);
      if(!raw) continue;
      const lista = JSON.parse(raw);
      if(Array.isArray(lista) && lista.length) return lista;
    }catch(e){}
  }
  return [];
}

function fibraLocalizarClienteSelecionado(){
  let c = null;

  try{
    c = JSON.parse(localStorage.getItem("clienteSelecionadoCompleto") || "null");
  }catch(e){}

  if(!c){
    try{
      c = JSON.parse(localStorage.getItem("clienteCadastroSelecionado") || "null");
    }catch(e){}
  }

  const params = new URLSearchParams(location.search);
  const busca = fibraNorm(
    params.get("cliente") ||
    localStorage.getItem("clienteEditarLogin") ||
    ""
  );

  if((!c || !Object.keys(c).length) && busca){
    c = fibraClientesBase().find(x => {
      const login = fibraNorm(fibraCampo(x, ["loginPppoe","login","usuario","user","name","pppoe"]));
      const nome = fibraNorm(fibraCampo(x, ["nome","cliente","razaoSocial"]));
      return login === busca || nome === busca;
    });
  }

  return c;
}

function fibraPreencherCadastroClienteSelecionado(){
  const c = fibraLocalizarClienteSelecionado();
  if(!c) return false;

  // Dados pessoais
  fibraSet(["cadNome","nome","clienteNome"], fibraCampo(c, ["nome","cliente","razaoSocial","name"]));
  fibraSet(["cadCpf","cpf","documento"], fibraCampo(c, ["cpfCnpj","cpf","cnpj","documento"]));
  fibraSet(["cadRg","rg"], fibraCampo(c, ["rgIe","rg","ie"]));
  fibraSet(["cadNascimento","nascimento"], fibraCampo(c, ["dataNascimento","nascimento"]));
  fibraSet(["cadEmail","email"], fibraCampo(c, ["email","e_mail"]));
  fibraSet(["cadTelefone1","telefone","telefone1"], fibraCampo(c, ["telefone1","telefone","celular","fone"]));
  fibraSet(["cadTelefone2","telefone2"], fibraCampo(c, ["telefone2","celular2","fone2"]));
  fibraSet(["cadTelefone3","telefone3"], fibraCampo(c, ["telefone3","celular3","fone3"]));

  // Endereço
  fibraSet(["cadCep","cep"], fibraCampo(c, ["cep"]));
  fibraSet(["cadEndereco","endereco","logradouro"], fibraCampo(c, ["endereco","logradouro","rua"]));
  fibraSet(["cadNumero","numero"], fibraCampo(c, ["numero","num"]));
  fibraSet(["cadReferencia","referencia"], fibraCampo(c, ["referencia","pontoReferencia"]));
  fibraSet(["cadComplemento","complemento"], fibraCampo(c, ["complemento"]));
  fibraSet(["cadBairro","bairro"], fibraCampo(c, ["bairro"]));
  fibraSet(["cadCidade","cidade"], fibraCampo(c, ["cidade","localidade"]) || "Manaus");
  fibraSet(["cadUf","uf"], fibraCampo(c, ["uf","estado"]) || "AM");

  // Acesso PPPoE / plano
  fibraSet(["cadLogin","login","loginPppoe"], fibraCampo(c, ["loginPppoe","login","usuario","user","name","pppoe"]));
  fibraSet(["cadSenha","senha","senhaPppoe"], fibraCampo(c, ["senhaPppoe","senha","password"]));
  fibraSet(["cadPlano","plano"], fibraCampo(c, ["plano","profile"]));
  fibraSet(["cadValor","valor"], fibraCampo(c, ["valorMensal","valor","mensalidade"]));
  fibraSet(["cadVencimento","vencimento"], fibraCampo(c, ["diaVencimento","vencimento"]));
  fibraSet(["cadPop","servidor"], fibraCampo(c, ["popServidor","servidor","servidorReceita"]));
  fibraSet(["cadIp","ip"], fibraCampo(c, ["ip","address"]));
  fibraSet(["cadMac","mac"], fibraCampo(c, ["mac","callerId","caller-id"]));
  fibraSet(["cadProfile","profile"], fibraCampo(c, ["profile","plano"]));
  fibraSet(["cadObservacao","observacao"], fibraCampo(c, ["observacao","observacoes"]));

  const titulo = document.querySelector(".topbar h1, h1");
  if(titulo && location.pathname.includes("cadastro")) titulo.textContent = "Cadastro de Cliente - Editando";

  const aviso = document.getElementById("cadastroClienteCarregado");
  if(aviso){
    aviso.innerHTML = "Cliente carregado da aba Clientes.";
  }else{
    const form = document.querySelector("form") || document.querySelector("main") || document.body;
    const div = document.createElement("div");
    div.id = "cadastroClienteCarregado";
    div.className = "import-status-clientes";
    div.innerHTML = "Cliente carregado da aba Clientes.";
    form.prepend(div);
  }

  if(typeof atualizarResumoCadastro === "function") atualizarResumoCadastro();
  return true;
}

document.addEventListener("DOMContentLoaded", () => {
  if(location.pathname.endsWith("cadastro.html")){
    setTimeout(fibraPreencherCadastroClienteSelecionado, 300);
  }
});


/* Menu mobile - abrir/fechar abas no celular */
function toggleMobileMenu(){
  const sidebar = document.querySelector(".sidebar, aside, nav.sidebar, .menu-lateral");
  const overlay = document.getElementById("mobileMenuOverlay");
  if(sidebar){
    sidebar.classList.toggle("open");
    sidebar.classList.toggle("mobile-open");
  }
  if(overlay){
    overlay.classList.toggle("show");
  }
}

function closeMobileMenu(){
  const sidebar = document.querySelector(".sidebar, aside, nav.sidebar, .menu-lateral");
  const overlay = document.getElementById("mobileMenuOverlay");
  if(sidebar){
    sidebar.classList.remove("open");
    sidebar.classList.remove("mobile-open");
  }
  if(overlay){
    overlay.classList.remove("show");
  }
}

document.addEventListener("DOMContentLoaded", function(){
  const sidebar = document.querySelector(".sidebar, aside, nav.sidebar, .menu-lateral");
  if(sidebar){
    sidebar.querySelectorAll("a, button").forEach(function(el){
      el.addEventListener("click", function(){
        if(window.innerWidth <= 768){
          setTimeout(closeMobileMenu, 150);
        }
      });
    });
  }
});

