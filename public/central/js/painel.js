(function dashboardPage(){
  "use strict";

  const state = {assinante:null, pontos:[], boletos:[], filtro:"todas", view:"visao-geral", nextBillKey:"", nextBill:null};
  const els = {
    logout:document.getElementById("logout-button"),
    refresh:document.getElementById("refresh-button"),
    message:document.getElementById("page-message"),
    name:document.getElementById("subscriber-name"),
    document:document.getElementById("subscriber-document"),
    summaryPoints:document.getElementById("summary-points"),
    summaryNextDue:document.getElementById("summary-next-due"),
    summaryNextDescription:document.getElementById("summary-next-description"),
    nextBillCard:document.getElementById("next-bill-card"),
    summaryStatus:document.getElementById("summary-status"),
    trustCard:document.getElementById("trust-card"),
    trustStatus:document.getElementById("trust-status"),
    trustDescription:document.getElementById("trust-description"),
    trustButton:document.getElementById("trust-button"),
    pointsCounter:document.getElementById("points-counter"),
    pointsGrid:document.getElementById("points-grid"),
    billsList:document.getElementById("bills-list"),
    registrationName:document.getElementById("registration-name"),
    registrationDocument:document.getElementById("registration-document"),
    registrationBirthDate:document.getElementById("registration-birth-date"),
    registrationEmail:document.getElementById("registration-email"),
    registrationPhone1:document.getElementById("registration-phone-1"),
    registrationPhone2:document.getElementById("registration-phone-2"),
    registrationAddress:document.getElementById("registration-address")
  };

  document.getElementById("current-year").textContent = String(new Date().getFullYear());
  bindEvents();
  showView(readViewFromHash(), false);
  loadAll();

  function bindEvents(){
    els.logout.addEventListener("click", async ()=>{
      els.logout.disabled = true;
      try{ await CentralAPI.logout(); }catch(_){ }
      location.replace("index.html");
    });

    els.refresh.addEventListener("click", ()=>loadAll(true));

    els.nextBillCard.addEventListener("click", openNextBillPayment);
    els.nextBillCard.addEventListener("keydown", event=>{
      if(event.key === "Enter" || event.key === " "){
        event.preventDefault();
        openNextBillPayment();
      }
    });

    document.querySelectorAll("[data-target]").forEach(button=>{
      button.addEventListener("click", ()=>showView(button.dataset.target, true));
    });

    window.addEventListener("hashchange", ()=>showView(readViewFromHash(), false));

    document.querySelectorAll("[data-filter]").forEach(button=>{
      button.addEventListener("click", ()=>{
        document.querySelectorAll("[data-filter]").forEach(item=>item.classList.remove("active"));
        button.classList.add("active");
        state.filtro = button.dataset.filter;
        renderBills();
      });
    });

    els.billsList.addEventListener("click", handleBillAction);
    document.addEventListener("click", handleModalCopy);

    els.trustButton.addEventListener("click", async ()=>{
      const id = state.assinante?.id || state.pontos[0]?.id;
      if(!id) return;
      els.trustButton.disabled = true;
      try{
        await CentralAPI.solicitarConfianca(id);
        showMessage("✅ Liberação em Confiança realizada com sucesso! Sua conexão foi liberada por 24 horas.", "success");
        await loadAll(false);
      }catch(e){
        showMessage(e.message || "Não foi possível solicitar a liberação.", "error");
      }finally{ els.trustButton.disabled = false; }
    });
  }

  function readViewFromHash(){
    const candidate = String(location.hash || "").replace(/^#/, "");
    return ["visao-geral", "faturas", "cadastro"].includes(candidate) ? candidate : "visao-geral";
  }

  function showView(view, updateHash){
    const target = ["visao-geral", "faturas", "cadastro"].includes(view) ? view : "visao-geral";
    state.view = target;

    document.querySelectorAll("[data-view]").forEach(section=>{
      const active = section.dataset.view === target;
      section.hidden = !active;
      section.classList.toggle("active", active);
    });

    document.querySelectorAll("[data-target]").forEach(button=>{
      const active = button.dataset.target === target;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });

    const titles = {
      "visao-geral":"Visão geral",
      "faturas":"Faturas",
      "cadastro":"Cadastro"
    };
    document.title = `${titles[target]} | Minha Central Fibra+`;

    if(updateHash && location.hash !== `#${target}`){
      history.pushState(null, "", `#${target}`);
    }
    window.scrollTo({top:0, behavior:updateHash ? "smooth" : "auto"});
  }

  async function loadAll(manual=false){
    setBusy(true);
    if(manual) showMessage("Atualizando dados…", "info");
    try{
      const [profileResult, billsResult] = await Promise.all([CentralAPI.me(), CentralAPI.boletos()]);
      state.assinante = profileResult.assinante;
      state.pontos = profileResult.assinante?.pontos || [];
      state.boletos = billsResult.boletos || [];
      renderAll();
      if(manual) showMessage("Dados atualizados.", "success");
      else hideMessage();
    }catch(error){
      if(error.status === 401){
        location.replace("index.html");
        return;
      }
      showMessage(error.message || "Não foi possível carregar a Central.", "error");
      els.pointsGrid.innerHTML = '<article class="empty-card">Não foi possível carregar os serviços.</article>';
      els.billsList.innerHTML = '<article class="empty-card">Não foi possível carregar as faturas.</article>';
    }finally{
      setBusy(false);
    }
  }

  function renderAll(){
    const first = state.pontos[0] || {};
    els.name.textContent = state.assinante?.nome || first.nome || "cliente";
    els.document.textContent = `${state.assinante?.documento || "Documento protegido"} · dados sincronizados com o Fibra+`;
    els.summaryPoints.textContent = String(state.pontos.length);
    els.pointsCounter.textContent = `${state.pontos.length} ${state.pontos.length === 1 ? "ponto" : "pontos"}`;

    const statuses = state.pontos.map(point=>normalize(point.status));
    const blocked = statuses.some(status=>status.includes("bloque"));
    const inactive = statuses.length > 0 && statuses.every(status=>status.includes("inativ") || status.includes("cancel"));
    els.summaryStatus.textContent = blocked ? "Bloqueado" : inactive ? "Inativo" : "Ativo";

    const firstData = state.pontos[0] || {};
    const statusTexto = normalize(firstData.status || state.assinante?.status || els.summaryStatus.textContent);
    const confiancaAtiva = statusTexto.includes("confianca");
    const clienteAtivo = !blocked && !confiancaAtiva && !inactive;
    // O card de confiança permanece visível para informar o status.
    // Clientes ativos não podem solicitar, por isso exibem apenas Indisponível.
    els.trustCard.hidden = !(blocked || clienteAtivo || confiancaAtiva);
    if(confiancaAtiva){
      els.trustStatus.textContent = "Ativa";
      els.trustDescription.textContent = "Sua liberação em confiança está ativa.";
      els.trustButton.hidden = true;
    }else if(blocked){
      els.trustStatus.textContent = "Disponível";
      els.trustDescription.textContent = "Solicite uma liberação temporária de 24 horas.";
      els.trustButton.hidden = false;
    }else{
      els.trustStatus.textContent = "Indisponível";
      els.trustDescription.textContent = "";
      els.trustButton.hidden = true;
    }

    const openBills = state.boletos.filter(bill=>billGroup(bill) === "abertas");
    const next = [...openBills].filter(bill=>parseDate(bill.vencimento)).sort((a,b)=>parseDate(a.vencimento)-parseDate(b.vencimento))[0];
    state.nextBill = next || null;
    state.nextBillKey = next ? billKey(next) : "";
    els.nextBillCard.classList.toggle("disabled", !next);
    els.nextBillCard.setAttribute("aria-disabled", next ? "false" : "true");
    els.nextBillCard.setAttribute("aria-label", next ? `Abrir fatura com vencimento em ${dateBR(next.vencimento)}` : "Nenhuma fatura pendente");
    els.summaryNextDue.textContent = next ? dateBR(next.vencimento) : "Tudo certo";
    const nextDescription = next ? summaryBillDescription(next.descricao) : "Sem vencimentos pendentes";
    els.summaryNextDescription.textContent = nextDescription;
    els.summaryNextDescription.hidden = !nextDescription;

    const registrationAddress = [first.endereco, first.bairro, first.cidade, first.uf, first.cep].filter(Boolean).join(", ");
    els.registrationName.textContent = state.assinante?.nome || first.nome || "Não informado";
    els.registrationDocument.textContent = state.assinante?.documento || first.documento || "Documento protegido";
    els.registrationBirthDate.textContent = dateBR(first.dataNascimento);
    els.registrationEmail.textContent = first.email || "Não informado";
    els.registrationPhone1.textContent = first.telefone1 || "Não informado";
    els.registrationPhone2.textContent = first.telefone2 || "Não informado";
    els.registrationAddress.textContent = registrationAddress || "Não informado";

    renderPoints();
    renderBills();
  }

  function summaryBillDescription(value){
    const text = String(value || "").trim();
    const normalized = normalize(text);
    if(!text || normalized.includes("boleto importado receitanet") || normalized === "receitanet") return "";
    const match = text.match(/(parcela\s*\d+)/i);
    return match ? match[1].replace(/^./, c => c.toUpperCase()) : text;
  }

  function renderPoints(){
    if(!state.pontos.length){
      els.pointsGrid.innerHTML = '<article class="empty-card"><strong>Nenhum ponto encontrado.</strong><span>Entre em contato com o provedor para revisar o vínculo do CPF.</span></article>';
      return;
    }

    els.pointsGrid.innerHTML = state.pontos.map((point,index)=>{
      const status = statusLabel(point.status);
      const address = [point.endereco, point.bairro, point.cidade, point.uf].filter(Boolean).join(", ");
      return `<article class="point-card">
        <div class="point-card-top">
          <div><small>Ponto ${index+1}</small><h3>${escapeHtml(point.plano || "Plano não informado")}</h3></div>
          <span class="status-pill ${status.className}">${status.label}</span>
        </div>
        <div class="point-price"><strong>${money(point.valorMensal)}</strong><span>/mês</span></div>
        <dl>
          <div><dt>Login PPPoE</dt><dd>${escapeHtml(point.loginPppoe || "Não informado")}</dd></div>
          <div><dt>Vencimento</dt><dd>${point.diaVencimento ? `Dia ${escapeHtml(point.diaVencimento)}` : "Não informado"}</dd></div>
          <div><dt>Tecnologia</dt><dd>${escapeHtml("Fibra Óptica")}</dd></div>
          <div><dt>Endereço</dt><dd>${escapeHtml(address || "Não informado")}</dd></div>
        </dl>
      </article>`;
    }).join("");
  }

  function renderBills(){
    const filtered = state.boletos
      .filter(bill=>state.filtro === "todas" || billGroup(bill) === state.filtro)
      .sort(compareBillsForDisplay);
    if(!filtered.length){
      const text = state.filtro === "todas" ? "Nenhuma fatura vinculada ao seu cadastro." : "Nenhuma fatura neste filtro.";
      els.billsList.innerHTML = `<article class="empty-card"><strong>${text}</strong><span>As novas cobranças aparecerão aqui automaticamente.</span></article>`;
      return;
    }

    els.billsList.innerHTML = filtered.map(bill=>{
      const group = billGroup(bill);
      const overdue = isOverdue(bill);
      const status = group === "pagas" ? {label:"Paga", cls:"paid"} : overdue ? {label:"Vencida", cls:"overdue"} : {label:"Em aberto", cls:"open"};
      const point = identifyBillPoint(bill);
      const key = billKey(bill);
      const actions = [];
      if(bill.pix) actions.push(`<button type="button" class="bill-action" data-pix-modal="${escapeAttr(key)}">PIX</button>`);
      if(bill.linhaDigitavel) actions.push(`<button type="button" class="bill-action" data-copy="${escapeAttr(bill.linhaDigitavel)}">Copiar linha</button>`);
      if(safeLink(bill.linkPdf)) actions.push(`<a class="bill-action primary" href="${escapeAttr(bill.linkPdf)}" target="_blank" rel="noopener">Abrir 2ª via</a>`);
      return `<article class="bill-card" data-bill-key="${escapeAttr(key)}" tabindex="-1">
        <div class="bill-main">
          <div class="bill-icon" aria-hidden="true">▤</div>
          <div class="bill-copy">
            <small>${escapeHtml(bill.categoria || "Mensalidade")}</small>
            <h3>${escapeHtml(bill.descricao || "Fatura")}</h3>
            <div class="bill-point"><strong>${escapeHtml(point.label)}</strong>${point.detail ? `<span>${escapeHtml(point.detail)}</span>` : ""}</div>
            <span>Nº ${escapeHtml(bill.numero || bill.id)}</span>
          </div>
        </div>
        <div class="bill-date"><small>Vencimento</small><strong>${dateBR(bill.vencimento)}</strong></div>
        <div class="bill-value"><small>Valor</small><strong>${money(bill.valor)}</strong></div>
        <span class="bill-status ${status.cls}">${status.label}</span>
        <div class="bill-actions">${actions.length ? actions.join("") : '<span class="no-action">Dados de pagamento indisponíveis</span>'}</div>
      </article>`;
    }).join("");
  }

  function billKey(bill){
    return [
      bill?.id || "",
      bill?.numero || "",
      bill?.vencimento || "",
      bill?.clienteId || "",
      bill?.clienteLogin || ""
    ].map(value=>String(value).trim()).join("|");
  }

  function openNextBillPayment(){
    if(state.nextBill){
      openBillModal(state.nextBill);
      return;
    }
    goToNextBill();
  }

  function openBillModal(bill){
    let modal = document.getElementById("bill-payment-modal");
    if(!modal){
      modal = document.createElement("div");
      modal.id = "bill-payment-modal";
      modal.className = "bill-modal";
      document.body.appendChild(modal);
    }
    const qr = bill.pix ? `<div class="pix-qr-area"><img alt="QR Code PIX" src="https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(bill.pix)}"></div>` : `<div class="pix-qr-area"><p>QR Code PIX indisponível</p></div>`;
    const digitavel = bill.pix ? `<button class="bill-action modal-copy-button" data-copy="${escapeHtml(bill.pix)}">Copiar PIX</button>` : `<button class="bill-action" disabled>PIX indisponível</button>`;
    modal.innerHTML = `<div class="bill-modal-card"><button class="close-modal" onclick="this.closest('.bill-modal').classList.remove('show')">×</button><p>Vencimento: <b>${dateBR(bill.vencimento)}</b></p><p>Valor: <b>${money(bill.valor)}</b></p><div class="pix-box"><h3>Pagamento PIX</h3>${qr}<div class="pix-description">Use o QR Code para pagamento PIX</div>${digitavel}</div></div>`;
    modal.classList.add("show");
    requestAnimationFrame(()=>modal.classList.add("animate-in"));
  }

  function goToNextBill(){
    if(!state.nextBillKey) return;

    state.filtro = "abertas";
    document.querySelectorAll("[data-filter]").forEach(button=>{
      button.classList.toggle("active", button.dataset.filter === "abertas");
    });
    renderBills();
    showView("faturas", true);

    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      const target = [...els.billsList.querySelectorAll("[data-bill-key]")]
        .find(card=>card.dataset.billKey === state.nextBillKey);
      if(!target) return;
      target.classList.add("bill-card-highlight");
      target.scrollIntoView({behavior:"smooth", block:"center"});
      target.focus({preventScroll:true});
      window.setTimeout(()=>target.classList.remove("bill-card-highlight"), 2600);
    }));
  }

  function identifyBillPoint(bill){
    const billClientId = String(bill?.clienteId || "").trim();
    const billLogin = normalizeIdentifier(bill?.clienteLogin);
    let index = -1;

    if(billClientId){
      index = state.pontos.findIndex(point=>String(point?.id || "").trim() === billClientId);
    }
    if(index < 0 && billLogin){
      index = state.pontos.findIndex(point=>normalizeIdentifier(point?.loginPppoe) === billLogin);
    }
    if(index < 0 && state.pontos.length === 1) index = 0;

    if(index < 0){
      return {label:"Ponto não identificado", detail:bill?.clienteLogin || ""};
    }

    const point = state.pontos[index] || {};
    const address = [point.endereco, point.bairro].filter(Boolean).join(", ");
    const reference = point.loginPppoe || address || point.plano || "";
    const plan = point.plano && point.plano !== reference ? point.plano : "";
    return {
      label:`Ponto ${index + 1}`,
      detail:[reference, plan].filter(Boolean).join(" · ")
    };
  }

  function normalizeIdentifier(value){
    return String(value || "").trim().toLowerCase();
  }

  async function handleBillAction(event){
    const pixButton = event.target.closest("[data-pix-modal]");
    if(pixButton){
      const card = pixButton.closest("[data-bill-key]");
      const bill = state.boletos.find(item=>billKey(item) === pixButton.dataset.pixModal || billKey(item) === card?.dataset.billKey);
      if(bill){ openBillModal(bill); }
      return;
    }
    const button = event.target.closest("[data-copy]");
    if(!button) return;
    try{
      await navigator.clipboard.writeText(button.dataset.copy || "");
      const old = button.textContent;
      button.textContent = "Copiado ✓";
      setTimeout(()=>button.textContent=old, 1400);
    }catch(_){
      showMessage("Não foi possível copiar automaticamente. Selecione o código manualmente.", "error");
    }
  }

  async function handleModalCopy(event){
    const button = event.target.closest(".modal-copy-button");
    if(!button) return;
    try{
      await navigator.clipboard.writeText(button.dataset.copy || "");
      const old = button.textContent;
      button.textContent = "PIX Copiado ✓";
      button.classList.add("copied");
      setTimeout(()=>{button.textContent=old;button.classList.remove("copied");},1800);
    }catch(_){ showMessage("Não foi possível copiar automaticamente.", "error"); }
  }

  function setBusy(busy){
    els.refresh.disabled = busy;
    els.refresh.textContent = busy ? "Atualizando…" : "Atualizar dados";
  }

  function showMessage(message,type){
    els.message.textContent = message;
    els.message.className = `page-message ${type || "info"}`;
    els.message.hidden = false;
  }
  function hideMessage(){ els.message.hidden = true; }

  function compareBillsForDisplay(a,b){
    const groupA = billGroup(a);
    const groupB = billGroup(b);

    // Na aba “Todas”, cobranças em aberto sempre aparecem antes das pagas.
    if(state.filtro === "todas" && groupA !== groupB) return groupA === "abertas" ? -1 : 1;

    const dateA = parseDate(a.vencimento);
    const dateB = parseDate(b.vencimento);
    const timeA = dateA ? dateA.getTime() : Number.POSITIVE_INFINITY;
    const timeB = dateB ? dateB.getTime() : Number.POSITIVE_INFINITY;

    // Em aberto: vencimento mais próximo primeiro. Pagas: mais recentes primeiro.
    if(groupA === "pagas" && groupB === "pagas") {
      if(Number.isFinite(timeA) && Number.isFinite(timeB) && timeA !== timeB) return timeB - timeA;
    } else if(Number.isFinite(timeA) && Number.isFinite(timeB) && timeA !== timeB) {
      return timeA - timeB;
    }

    if(Number.isFinite(timeA) !== Number.isFinite(timeB)) return Number.isFinite(timeA) ? -1 : 1;
    return String(a.numero || a.id || "").localeCompare(String(b.numero || b.id || ""), "pt-BR", {numeric:true});
  }

  function billGroup(bill){
    const status = normalize(`${bill.status || ""}`);
    if(["pago","paid","settled","baixado","recebido","liquidado"].some(value=>status.includes(value))) return "pagas";
    if(["cancel","estorn","refund","devolv"].some(value=>status.includes(value))) return "pagas";
    return "abertas";
  }
  function isOverdue(bill){
    const due = parseDate(bill.vencimento);
    if(!due || billGroup(bill) !== "abertas") return false;
    const today = new Date(); today.setHours(0,0,0,0);
    return due < today;
  }
  function statusLabel(value){
    const status = normalize(value);
    if(status.includes("bloque")) return {label:"Bloqueado", className:"blocked"};
    if(status.includes("cancel") || status.includes("inativ")) return {label:"Inativo", className:"inactive"};
    if(status.includes("confianca")) return {label:"Em confiança", className:"trust"};
    return {label:"Ativo", className:"active"};
  }
  function normalize(value){ return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim(); }
  function money(value){ return Number(value || 0).toLocaleString("pt-BR", {style:"currency", currency:"BRL"}); }
  function parseDate(value){
    const text = String(value || "").trim();
    let match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if(match) return new Date(Number(match[1]), Number(match[2])-1, Number(match[3]));
    match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if(match) return new Date(Number(match[3]), Number(match[2])-1, Number(match[1]));
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  function dateBR(value){ const date=parseDate(value); return date ? date.toLocaleDateString("pt-BR") : "Não informado"; }
  function safeLink(value){ return /^(https?:\/\/|\/)/i.test(String(value || "")); }
  function escapeHtml(value){ return String(value ?? "").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char])); }
  function escapeAttr(value){ return escapeHtml(value).replace(/`/g,"&#96;"); }

  // Mantém os dados sincronizados com o Supabase enquanto a Central estiver aberta.
  window.setInterval(()=>{
    if(document.hidden) return;
    loadAll(false);
  }, 30000);
})();


// Suporte WhatsApp Fibra+
function atualizarWhatsAppSuporte(){
  const supportButton = document.getElementById('support-whatsapp');
  if (!supportButton) return;
  const phone = '559281392532';
  const nomeEl = document.getElementById('subscriber-name');
  let name = nomeEl ? nomeEl.textContent.replace(/^Olá,\s*/i,'').replace(/\.$/,'').trim() : '';
  if (!name || name.toLowerCase() === 'cliente') name = 'cliente';
  const message = encodeURIComponent(`Olá, sou ${name}, cliente Fibra+.\nPreciso de atendimento.`);
  supportButton.href = `https://wa.me/${phone}?text=${message}`;
}
window.atualizarWhatsAppSuporte = atualizarWhatsAppSuporte;
atualizarWhatsAppSuporte();
setTimeout(atualizarWhatsAppSuporte, 1000);
setTimeout(atualizarWhatsAppSuporte, 3000);
