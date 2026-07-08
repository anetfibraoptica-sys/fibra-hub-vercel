
(function(){
  let timer = null;
  let estruturaHash = "";
  let renderLiberado = false;

  function paginaPppoe(){
    const page = (location.pathname.split("/").pop() || "").toLowerCase();
    const txt = (document.body.innerText || "").toLowerCase();
  }

  function arrServidores(dados){
    if(Array.isArray(dados)) return dados;
    if(dados && typeof dados === "object"){
      return Object.values(dados).filter(s => s && typeof s === "object" && Array.isArray(s.clientes));
    }
    return [];
  }

  function nomeServidor(s){
    const n = String(s.servidor || s.identity || s.nome || "").toLowerCase();
    if(n.includes("colonia") || n.includes("colônia") || n.includes("coln")) return "COLÔNIA";
    if(n.includes("armando")) return "ARMANDO";
    return String(s.nome || s.identity || s.servidor || "--").toUpperCase();
  }

  function montarClientes(dados){
    const lista = [];
    arrServidores(dados).forEach(s => {
      const servidor = nomeServidor(s);
      (s.clientes || []).forEach(c => {
        lista.push({
          chave: servidor + "|" + (c.nome || c.name || c.cliente || c.ip || c.address || Math.random()),
          cliente: c.nome || c.name || c.cliente || "--",
          servidor: servidor,
          plano: c.plano || c.profile || "PPPoE",
          ip: c.ip || c.address || "--",
          tempo: c.uptime || c.tempo || "--",
          status: "🟢 Online"
        });
      });
    });

    lista.sort((a,b)=>{
      if(a.servidor !== b.servidor) return a.servidor.localeCompare(b.servidor);
      return a.cliente.localeCompare(b.cliente);
    });

    return lista;
  }

  function totalPppoe(dados, clientes){
    return Math.max(total, clientes.length);
  }

  function acharTabela(){
    return document.getElementById("clientesTabela") ||
           document.getElementById("clientesOnlineTabela") ||
           document.getElementById("pppoeTabela") ||
           document.querySelector("table tbody");
  }

  function cabecalho(tbody){
    const table = tbody.closest("table");
    if(!table) return;
    let thead = table.querySelector("thead");
    if(!thead){
      thead = document.createElement("thead");
      table.insertBefore(thead, table.firstChild);
    }
    thead.innerHTML = "<tr><th>Cliente</th><th>Servidor</th><th>Plano</th><th>IP</th><th>Tempo</th><th>Status</th></tr>";
  }

  function atualizarTotal(total){
      const el = document.getElementById(id);
      if(el) el.textContent = total;
    });
  }

  function hashEstrutura(clientes){
    // não usa uptime no hash para evitar redraw/piscar a cada atualização
    return clientes.map(c => c.chave + "|" + c.ip).join(";");
  }

  function criarLinha(c){
    const tr = document.createElement("tr");
    tr.dataset.chave = c.chave;
    tr.innerHTML = "<td></td><td></td><td></td><td></td><td></td><td></td>";
    preencherLinha(tr, c);
    return tr;
  }

  function preencherLinha(tr, c){
    const td = tr.children;
    if(td[0].textContent !== c.cliente) td[0].textContent = c.cliente;
    if(td[1].textContent !== c.servidor) td[1].textContent = c.servidor;
    if(td[2].textContent !== c.plano) td[2].textContent = c.plano;
    if(td[3].textContent !== c.ip) td[3].textContent = c.ip;
    if(td[4].textContent !== c.tempo) td[4].textContent = c.tempo;
    if(td[5].textContent !== c.status) td[5].textContent = c.status;
  }

  function render(dados, forcar){
    const tbody = acharTabela();
    if(!tbody) return;

    const clientes = montarClientes(dados);
    cabecalho(tbody);
    atualizarTotal(totalPppoe(dados, clientes));

    const novoHash = hashEstrutura(clientes);

    // primeira carga ou mudança de clientes: redesenha uma vez
    if(forcar || novoHash !== estruturaHash || tbody.children.length !== clientes.length){
      estruturaHash = novoHash;
      const scrollBox = tbody.closest(".table-wrap") || tbody.closest(".panel") || document.scrollingElement;
      const scrollTop = scrollBox ? scrollBox.scrollTop : 0;

      const frag = document.createDocumentFragment();
      clientes.forEach(c => frag.appendChild(criarLinha(c)));

      renderLiberado = true;
      tbody.replaceChildren(frag);
      renderLiberado = false;

      if(scrollBox) scrollBox.scrollTop = scrollTop;
      return;
    }

    // mesma estrutura: apenas atualiza os campos, sem apagar linhas
    const mapa = new Map(clientes.map(c => [c.chave, c]));
    Array.from(tbody.children).forEach(tr => {
      const c = mapa.get(tr.dataset.chave);
      if(c) preencherLinha(tr, c);
    });
  }

  async function carregar(forcar){
    if(!paginaPppoe()) return;
    try{
      const r = await fetch("/api/servidores?_=" + Date.now());
      const dados = await r.json();
      render(dados, !!forcar);
    }catch(e){
      console.log("PPPoE estável erro:", e);
    }
  }

  // Bloqueia scripts antigos de sobrescreverem o tbody depois que este script assumir.
  (function proteger(){
    if(window.__pppoeStableProtected) return;
    window.__pppoeStableProtected = true;

    const desc = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
    if(!desc || !desc.set) return;

    Object.defineProperty(Element.prototype, "innerHTML", {
      get: desc.get,
      set: function(v){
        const id = this.id || "";
        const isPppoe = id === "clientesTabela" || id === "clientesOnlineTabela" || id === "pppoeTabela";
        if(isPppoe && estruturaHash && !renderLiberado){
          return;
        }
        return desc.set.call(this, v);
      }
    });
  })();

  window.fibraBuscarClientesTodos = function(){ return carregar(false); };
  window.fibraBuscarClientesTodosEstavel = function(f){ return carregar(!!f); };
  window.fibraAtualizarClientesFinal = function(f){ return carregar(!!f); };
  window.fibraAtualizarTabelaClientesTodos = function(dados){ return render(dados, true); };
  window.fibraRenderClientesFinal = function(){};
  window.fibraRenderizarClientesEstavel = function(){};

  document.addEventListener("DOMContentLoaded", function(){
    carregar(true);
    if(timer) clearInterval(timer);
    timer = setInterval(function(){ carregar(false); }, 15000);
  });

  window.addEventListener("load", function(){
    setTimeout(function(){ carregar(true); }, 500);
    setTimeout(function(){ carregar(false); }, 2000);
  });
})();


// Reaplica filtro após atualização da tabela
setInterval(function(){ if(window.filtrarTabelaPppoe) window.filtrarTabelaPppoe(); }, 2000);
