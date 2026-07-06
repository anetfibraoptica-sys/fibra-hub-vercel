
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

function cadastroDeveAbrirLimpo(){
    const path = location.pathname.toLowerCase();
    if(!path.includes("cadastro")) return false;

    const url = new URL(location.href);

    // Se vier com dados claros de edição, pode carregar o cliente.
    const temEdicao =
        url.searchParams.has("id") ||
        url.searchParams.has("login") ||
        url.searchParams.has("cliente") ||
        url.searchParams.has("editar") ||
        url.searchParams.has("edit");

    // cadastro.html?novo=1 sempre abre limpo.
    if(url.searchParams.get("novo") === "1" || url.searchParams.get("novo") === "true"){
        return true;
    }

    // Cadastro aberto direto pelo menu, sem parâmetros, deve abrir limpo.
    if(!temEdicao){
        return true;
    }

    return false;
}

function carregarClienteSelecionadoNoCadastro(){
    if(cadastroDeveAbrirLimpo()){
        return false;
    }
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











/* Botão azul de 3 linhas abre a lateral/menu */
function abrirMenu(){
  const sidebar = document.querySelector(".sidebar, aside, nav.sidebar, .menu-lateral");
  const overlay = document.getElementById("menuOverlay") || document.getElementById("mobileMenuOverlay");

  if(sidebar){
    sidebar.classList.add("open");
    sidebar.classList.add("mobile-open");
  }

  if(overlay){
    overlay.classList.add("show");
  }
}

function fecharMenu(){
  const sidebar = document.querySelector(".sidebar, aside, nav.sidebar, .menu-lateral");
  const overlay = document.getElementById("menuOverlay") || document.getElementById("mobileMenuOverlay");

  if(sidebar){
    sidebar.classList.remove("open");
    sidebar.classList.remove("mobile-open");
  }

  if(overlay){
    overlay.classList.remove("show");
  }
}

function alternarMenu(){
  const sidebar = document.querySelector(".sidebar, aside, nav.sidebar, .menu-lateral");
  if(!sidebar) return;

  if(sidebar.classList.contains("open") || sidebar.classList.contains("mobile-open")){
    fecharMenu();
  }else{
    abrirMenu();
  }
}

document.addEventListener("DOMContentLoaded", function(){
  // Garante que o botão azul de 3 linhas chame abrirMenu.
  document.querySelectorAll(".menu-btn, #menuBtn, .hamburger, .btn-menu").forEach(function(btn){
    btn.onclick = function(e){
      e.preventDefault();
      abrirMenu();
    };
  });

  // Fecha lateral ao tocar fora.
  const overlay = document.getElementById("menuOverlay") || document.getElementById("mobileMenuOverlay");
  if(overlay){
    overlay.onclick = fecharMenu;
  }

  // Fecha no celular depois de tocar em uma opção do menu.
  const sidebar = document.querySelector(".sidebar, aside, nav.sidebar, .menu-lateral");
  if(sidebar){
    sidebar.querySelectorAll("a").forEach(function(link){
      link.addEventListener("click", function(){
        if(window.innerWidth <= 768){
          setTimeout(fecharMenu, 150);
        }
      });
    });
  }
});



/* FIX FINAL: botão azul de 3 linhas abre a lateral */
function encontrarSidebarFibra(){
  return document.querySelector(".sidebar") ||
         document.querySelector("aside") ||
         document.querySelector("nav") ||
         document.querySelector(".menu-lateral");
}

function abrirMenuLateral(){
  const sidebar = encontrarSidebarFibra();
  const overlay = document.querySelector(".sidebar-overlay");

  if(sidebar){
    sidebar.classList.add("sidebar-aberta");
    sidebar.classList.add("open");
    sidebar.style.left = "0";
    sidebar.style.transform = "translateX(0)";
    sidebar.style.display = "block";
    sidebar.style.visibility = "visible";
  }

  if(overlay){
    overlay.classList.add("show");
    overlay.style.display = "block";
  }
}

function fecharMenuLateral(){
  const sidebar = encontrarSidebarFibra();
  const overlay = document.querySelector(".sidebar-overlay");

  if(sidebar){
    sidebar.classList.remove("sidebar-aberta");
    sidebar.classList.remove("open");
    if(window.innerWidth <= 768){
      sidebar.style.left = "-290px";
      sidebar.style.transform = "translateX(-100%)";
    }
  }

  if(overlay){
    overlay.classList.remove("show");
    overlay.style.display = "none";
  }
}

// Mantém compatibilidade com botão antigo onclick="abrirMenu()"
function abrirMenu(){
  abrirMenuLateral();
}

document.addEventListener("DOMContentLoaded", function(){
  document.querySelectorAll(".menu-btn, #menuBtn, .hamburger, .btn-menu").forEach(function(btn){
    btn.onclick = function(e){
      e.preventDefault();
      e.stopPropagation();
      abrirMenuLateral();
    };
  });

  const sidebar = encontrarSidebarFibra();
  if(sidebar){
    sidebar.querySelectorAll("a").forEach(function(a){
      a.addEventListener("click", function(){
        if(window.innerWidth <= 768) setTimeout(fecharMenuLateral, 150);
      });
    });
  }
});


/* FIX DEFINITIVO - botão azul 3 linhas abre menu lateral */
(function(){
  function sidebar(){ return document.querySelector('aside.sidebar') || document.querySelector('.sidebar') || document.querySelector('aside'); }
  function overlay(){ return document.querySelector('.overlay') || document.querySelector('.sidebar-overlay'); }
  window.abrirMenu = window.abrirMenuLateral = function(){
    document.body.classList.add('menu-open');
    const s = sidebar(); if(s){ s.classList.add('open','mobile-open','sidebar-aberta'); }
    const o = overlay(); if(o){ o.classList.add('show','active'); }
  };
  window.fecharMenu = window.fecharMenuLateral = function(){
    document.body.classList.remove('menu-open');
    const s = sidebar(); if(s){ s.classList.remove('open','mobile-open','sidebar-aberta'); }
    const o = overlay(); if(o){ o.classList.remove('show','active'); }
  };
  document.addEventListener('click', function(e){
    const btn = e.target.closest('.menu-btn, #menuBtn, .hamburger, .btn-menu');
    if(btn){ e.preventDefault(); e.stopPropagation(); window.abrirMenu(); }
    const ov = e.target.closest('.overlay, .sidebar-overlay');
    if(ov){ window.fecharMenu(); }
  }, true);
})();


/* FIX seguro: botão azul abre menu lateral sem esconder páginas */
function fibraSidebar(){
  return document.querySelector(".sidebar") ||
         document.querySelector("aside.sidebar") ||
         document.querySelector("nav.sidebar") ||
         document.querySelector(".menu-lateral");
}

function abrirMenuLateral(){
  const sidebar = fibraSidebar();
  if(sidebar){
    sidebar.classList.add("open");
    sidebar.classList.add("mobile-open");
    sidebar.classList.add("sidebar-aberta");
    sidebar.style.display = "block";
    sidebar.style.visibility = "visible";
    sidebar.style.opacity = "1";
    if(window.innerWidth <= 768){
      sidebar.style.left = "0";
      sidebar.style.transform = "translateX(0)";
    }
  }
  const overlay = document.querySelector(".sidebar-overlay");
  if(overlay){
    overlay.classList.add("show");
    overlay.style.display = "block";
  }
}

function fecharMenuLateral(){
  const sidebar = fibraSidebar();
  if(sidebar){
    sidebar.classList.remove("open");
    sidebar.classList.remove("mobile-open");
    sidebar.classList.remove("sidebar-aberta");
    if(window.innerWidth <= 768){
      sidebar.style.left = "-290px";
      sidebar.style.transform = "translateX(-100%)";
    }
  }
  const overlay = document.querySelector(".sidebar-overlay");
  if(overlay){
    overlay.classList.remove("show");
    overlay.style.display = "none";
  }
}

function abrirMenu(){
  abrirMenuLateral();
}

document.addEventListener("DOMContentLoaded", function(){
  // Garante que nada fique oculto por erro de script anterior.
  document.querySelectorAll("main,.main-content,.content,.container").forEach(function(el){
    el.style.visibility = "visible";
    el.style.opacity = "1";
  });

  document.querySelectorAll(".menu-btn,#menuBtn,.hamburger,.btn-menu").forEach(function(btn){
    btn.onclick = function(e){
      e.preventDefault();
      e.stopPropagation();
      abrirMenuLateral();
      return false;
    };
  });
});



/* REMOVER APENAS ABAS OLT/OLTNET/ADMINISTRATIVO/NOTAS FISCAIS */
document.addEventListener("DOMContentLoaded", function(){
  const nomesRemover = ["OLT", "OLTNET", "ADMINISTRATIVO", "DADOS NOTAS FISCAIS", "NOTAS FISCAIS"];
  document.querySelectorAll("button, a, .tab, .tab-btn, .cadastro-tab").forEach(function(el){
    const txt = (el.textContent || "").replace(/\s+/g, " ").trim().toUpperCase();
    if(nomesRemover.includes(txt)){
      el.remove();
    }
  });

  ["tab-olt","tab-oltnet","tab-administrativo","tab-admin","tab-notas","tab-notas-fiscais","tab-notasfiscais","tab-fiscais","tab-nfe"].forEach(function(id){
    const el = document.getElementById(id);
    if(el) el.remove();
  });
});



/* MENU LATERAL AJUSTE REAL - reforço sem alterar layout interno */
(function(){
  function ajustarMenuLateralReal(){
    if (window.innerWidth <= 900) return;

    var sidebar = document.querySelector('.sidebar');
    var main = document.querySelector('.main');
    var layout = document.querySelector('.layout') || document.querySelector('.app') || document.querySelector('.wrapper');

    if (sidebar){
      sidebar.style.width = '235px';
      sidebar.style.minWidth = '235px';
      sidebar.style.maxWidth = '235px';
      sidebar.style.flexBasis = '235px';
      sidebar.style.boxSizing = 'border-box';
    }

    if (main){
      main.style.marginLeft = '235px';
      main.style.width = 'calc(100vw - 235px)';
      main.style.maxWidth = 'calc(100vw - 235px)';
    }

    if (layout){
      layout.style.gridTemplateColumns = '235px minmax(0, 1fr)';
    }
  }

  document.addEventListener('DOMContentLoaded', ajustarMenuLateralReal);
  window.addEventListener('resize', ajustarMenuLateralReal);
  setTimeout(ajustarMenuLateralReal, 300);
})();



/* ============================================================
   RESUMO LATERAL DIREITA RECEITANET
   Monta o resumo no mesmo padrão visual do ReceitaNet,
   mantendo na lateral direita.
============================================================ */
(function(){
  function qs(sel){ return document.querySelector(sel); }
  function val(selectors, fallback){
    for (var i=0;i<selectors.length;i++){
      var el = qs(selectors[i]);
      if(!el) continue;
      var v = "";
      if ("value" in el) v = el.value;
      else v = el.textContent;
      v = (v || "").trim();
      if(v) return v;
    }
    return fallback || "";
  }

  function clienteLocal(){
    var keys = ["clienteSelecionadoCompleto","clienteCadastroSelecionado","clienteEditar","clienteOnlineSelecionado"];
    for(var i=0;i<keys.length;i++){
      try{
        var raw = localStorage.getItem(keys[i]);
        if(raw){
          var obj = JSON.parse(raw);
          if(obj && typeof obj === "object") return obj;
        }
      }catch(e){}
    }
    return {};
  }

  function pick(obj, names, fallback){
    for(var i=0;i<names.length;i++){
      var v = obj[names[i]];
      if(v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
    }
    return fallback || "";
  }

  function montarResumoReceitaNet(){
    var card = document.querySelector(".cadastro-resumo-card");
    if(!card) return;

    var c = clienteLocal();

    var login = val(["input[name='login']","input[name='cli_login']","#login","#cadLogin"], pick(c,["login","usuario","loginPppoe","pppoe"], "-"));
    var senha = val(["input[name='senha']","input[name='cli_senha']","#senha","#cadSenha"], pick(c,["senha","password"], "0000"));
    var nome = val(["input[name='nome']","input[name='cli_nome']","#nome","#cadNome"], pick(c,["nome","name","cliente"], "-"));
    var cpf = val(["input[name='cpf']","input[name='cpfcnpj']","input[name='cli_cgc']","#cpf","#cpfcnpj"], pick(c,["cpf","cpfcnpj","documento"], "-"));
    var dia = val(["select[name='dia_vencimento']","select[name='cli_diatari']","input[name='dia_vencimento']","#diaVencimento"], pick(c,["diaVencimento","vencimento"], "20"));
    var prox = pick(c,["proximaFatura","proxima_fatura","fatura"], "Nenhuma fatura disponível");
    var servidor = pick(c,["servidor","server"], val(["select[name='servidor'] option:checked","select[name='ip_mk'] option:checked"], "-"));
    var interfaceV = pick(c,["interface","interfaceAtual"], val(["select[name='interface'] option:checked","select[name='interface_id'] option:checked"], "PPPOE"));
    var ip = pick(c,["ip","ipAtual","address"], "100.127.7.218");
    var profile = pick(c,["profile","planoServidor","perfil"], "600-MEGA");
    var servico = pick(c,["servico","service"], "PPP2");
    var tempo = pick(c,["tempo","uptime"], "-");
    var mac = pick(c,["mac","macAddress"], "FC:40:09:D2:B2:1B");
    var mtu = pick(c,["mtu"], "1480");
    var mru = pick(c,["mru"], "1480");
    var endereco = pick(c,["endereco","address"], val(["input[name='endereco']","input[name='cli_endereco']"], "-"));
    var ponto = pick(c,["referencia","pontoReferencia"], val(["input[name='referencia']","input[name='cli_referencia']"], "-"));
    var bairro = pick(c,["bairro"], val(["input[name='bairro']","input[name='cli_bairro']"], "-"));
    var cidade = pick(c,["cidade"], val(["input[name='cidade']","input[name='cli_cidade']"], "-"));
    var estado = pick(c,["estado","uf"], val(["select[name='estado'] option:checked"], "-"));
    var ibge = pick(c,["ibge"], "1302603");
    var tel1 = pick(c,["telefone","tel1","fone"], val(["input[name='telefone']","input[name='cli_fone']"], "-"));
    var tel2 = pick(c,["telefone2","tel2","celular"], val(["input[name='telefone2']","input[name='cli_celular']"], "-"));

    var plano = pick(c,["plano","planoCobranca"], "Plano 600 MB - Fibra+");
    var valor = pick(c,["valor","valorPlano"], "R$ 100,00");

    card.innerHTML = `
      <div class="resumo-receitanet">
        <div class="resumo-header">
          <h2 class="resumo-titulo">Resumo</h2>
          <div class="resumo-help">?</div>
        </div>

        <div class="resumo-grid">
          <div class="resumo-field"><span class="resumo-label">Login</span><span class="resumo-value">✓ ${login}</span></div>
          <div class="resumo-field"><span class="resumo-label">Senha</span><span class="resumo-value">${senha}</span></div>
          <div class="resumo-field"><span class="resumo-label">Nome</span><span class="resumo-value">${nome}</span></div>
          <div class="resumo-field"><span class="resumo-label">CPF/CNPJ</span><span class="resumo-value">${cpf}</span></div>
          <div class="resumo-field"><span class="resumo-label">Dia do Vencimento</span><span class="resumo-value">${dia}</span></div>
          <div class="resumo-field"><span class="resumo-label">Próxima Fatura Aberta</span><span class="resumo-value">${prox}</span></div>
        </div>

        <div class="resumo-section-title">Servidor</div>
        <div class="resumo-grid">
          <div class="resumo-field"><span class="resumo-label">SERVIDOR</span><span class="resumo-value">${servidor}</span></div>
          <div class="resumo-field"><span class="resumo-label">INTERFACE</span><span class="resumo-value">${interfaceV}</span></div>
          <div class="resumo-field"><span class="resumo-label">ELEMENTO DE REDE</span><span class="resumo-value">Conexão<br>PPPOE</span></div>
          <div class="resumo-field"><span class="resumo-label">IP ATUAL</span><span class="resumo-value">Profile<br>${profile}</span></div>
        </div>

        <div class="resumo-oltnet">OLTNET</div>
        <span class="badge-nao-identificado">Não Identificado</span>

        <hr class="resumo-separador">

        <div class="resumo-grid">
          <div class="resumo-field">
            <span class="resumo-value"><b>Status</b><span class="status-dot"></span> Online</span>
            <span class="resumo-value"><b>Serviço:</b> ${servico}</span>
            <span class="resumo-value"><b>IP:</b> ${ip}</span>
            <span class="resumo-value"><b>Profile Servidor:</b> ${profile}</span>
            <span class="resumo-value"><b>MTU:</b> ${mtu}</span>
          </div>
          <div class="resumo-field">
            <span class="resumo-value"><b>Login:</b> ${login}</span>
            <span class="resumo-value"><b>Tempo:</b> ${tempo}</span>
            <span class="resumo-value"><b>MAC:</b> ${mac}</span>
            <span class="resumo-value"><b>Interface:</b> VLAN 102</span>
            <span class="resumo-value"><b>MRU:</b> ${mru}</span>
          </div>
        </div>

        <div class="resumo-btns">
          <a class="resumo-btn btn-remoto" href="#">Configurar Equipamento - Remoto</a>
          <a class="resumo-btn btn-interno" href="#">Configurar Equipamento - Interno&nbsp;&nbsp;&nbsp; HTTPS</a>
          <a class="resumo-btn btn-diagnostico" href="#">Diagnosticar Cliente</a>
          <a class="resumo-btn btn-monitoramento" href="#">Monitoramento em Tempo Real</a>
        </div>

        <hr class="resumo-separador">

        <div class="resumo-section-title">Plano de Cobrança</div>
        <table class="resumo-table">
          <thead><tr><th>PLANO</th><th>VALOR UN</th><th>QTDADE</th></tr></thead>
          <tbody><tr class="destaque"><td>${plano}</td><td>${valor}</td><td>1</td></tr></tbody>
        </table>
        <div class="resumo-total">Total: ${valor}</div>

        <hr class="resumo-separador">

        <div class="resumo-section-title">Estoque</div>
        <table class="resumo-table">
          <thead><tr><th>PRODUTO</th><th>QT.</th><th>UN</th><th>VALOR</th><th>DATA</th></tr></thead>
          <tbody><tr><td>Nenhum Produto</td><td></td><td></td><td></td><td></td></tr></tbody>
        </table>

        <hr class="resumo-separador">

        <div class="resumo-section-title">Dados de Contato</div>
        <div class="resumo-grid">
          <div class="resumo-field">
            <span class="resumo-label">Endereço</span><span class="resumo-value">${endereco}</span>
            <span class="resumo-label">Ponto de Ref.</span><span class="resumo-value">${ponto}</span>
            <span class="resumo-label">Bairro</span><span class="resumo-value">${bairro}</span>
            <span class="resumo-label">Estado</span><span class="resumo-value">${estado}</span>
            <span class="resumo-label">Tel1</span><span class="resumo-value">${tel1}</span>
            <span class="resumo-label">Tel3</span><span class="resumo-value">"</span>
          </div>
          <div class="resumo-field">
            <span class="resumo-label">Compl.</span><span class="resumo-value">"</span>
            <span class="resumo-label">Cidade</span><span class="resumo-value">${cidade}</span>
            <span class="resumo-label">IBGE</span><span class="resumo-value">${ibge}</span>
            <span class="resumo-label">Tel2</span><span class="resumo-value">${tel2}</span>
          </div>
        </div>

        <hr class="resumo-separador">

        <div class="resumo-section-title">Sistema Pai Controle</div>
        <span class="pai-status">Desativado</span>
      </div>
    `;
  }

  document.addEventListener("DOMContentLoaded", function(){
    montarResumoReceitaNet();
    document.querySelectorAll("input, select, textarea").forEach(function(el){
      el.addEventListener("input", montarResumoReceitaNet);
      el.addEventListener("change", montarResumoReceitaNet);
    });
  });
  window.addEventListener("storage", montarResumoReceitaNet);
})();




