(function loginPage(){
  "use strict";

  const form = document.getElementById("login-form");
  const documentInput = document.getElementById("document");
  const rememberInput = document.getElementById("remember-document");
  const submitButton = document.getElementById("submit-button");
  const formMessage = document.getElementById("form-message");
  const yearElement = document.getElementById("current-year");
  const documentError = document.getElementById("document-error");
  const documentWrap = document.getElementById("document-wrap");

  const supabaseStatus = document.getElementById("supabase-status");

  yearElement.textContent = String(new Date().getFullYear());
  restoreSavedCpf();
  checkSupabaseConnection();
  checkExistingSession();

  documentInput.addEventListener("input", ()=>{
    documentInput.value = formatCpf(documentInput.value);
    clearFieldError();
    hideMessage();
  });

  form.addEventListener("submit", async event=>{
    event.preventDefault();
    hideMessage();
    clearFieldError();

    const cpf = onlyDigits(documentInput.value);
    if(!isValidCpf(cpf)){
      setFieldError("Informe um CPF válido.");
      return;
    }

    setLoading(true);
    try{
      await CentralAPI.login(cpf, rememberInput.checked);
      showMessage("Cliente localizado no Supabase. Abrindo sua central…", "success");
      window.setTimeout(()=>location.replace(`painel.html#cpf=${encodeURIComponent(cpf)}`), 250);
    }catch(error){
      showMessage(error.message || "Não foi possível localizar este CPF no Supabase.", "error");
      documentInput.select();
    }finally{
      setLoading(false);
    }
  });

  async function checkSupabaseConnection(){
    if(!supabaseStatus) return;
    try{
      const status = await CentralAPI.status();
      if(!status.conectado || !status.tabelas?.clientes) throw new Error("Tabela clientes indisponível");
      supabaseStatus.className = "connection-status connected";
      supabaseStatus.innerHTML = "<span></span>Banco de Dados conectado";
    }catch(_){
      supabaseStatus.className = "connection-status disconnected";
      supabaseStatus.innerHTML = "<span></span>Não foi possível conectar ao Supabase";
    }
  }

  async function checkExistingSession(){
    try{
      await CentralAPI.me();
      const cpf = CentralAPI.documentoAtual();
      location.replace(cpf ? `painel.html#cpf=${encodeURIComponent(cpf)}` : "painel.html");
    }catch(_){ }
  }

  function restoreSavedCpf(){
    const saved ="" || localStorage.getItem("fibra_plus_saved_document");
    if(!saved) return;
    documentInput.value = formatCpf(saved);
    rememberInput.checked = true;
  }

  function setLoading(loading){
    submitButton.disabled = loading;
    submitButton.classList.toggle("is-loading", loading);
    submitButton.setAttribute("aria-busy", String(loading));
  }

  function setFieldError(message){
    documentError.textContent = message;
    documentWrap.classList.add("is-invalid");
    documentInput.setAttribute("aria-invalid", "true");
    documentInput.focus();
  }

  function clearFieldError(){
    documentError.textContent = "";
    documentWrap.classList.remove("is-invalid");
    documentInput.removeAttribute("aria-invalid");
  }

  function showMessage(message, type){
    formMessage.textContent = message;
    formMessage.classList.toggle("success", type === "success");
    formMessage.hidden = false;
  }

  function hideMessage(){
    formMessage.hidden = true;
    formMessage.textContent = "";
    formMessage.classList.remove("success");
  }

  function onlyDigits(value){ return String(value || "").replace(/\D/g, ""); }

  function formatCpf(value){
    const digits = onlyDigits(value).slice(0, 11);
    return digits
      .replace(/^(\d{3})(\d)/, "$1.$2")
      .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/\.(\d{3})(\d)/, ".$1-$2");
  }

  function isValidCpf(cpf){
    if(!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
    let sum = 0;
    for(let i=0;i<9;i+=1) sum += Number(cpf[i]) * (10-i);
    let digit = (sum*10)%11;
    if(digit===10) digit=0;
    if(digit!==Number(cpf[9])) return false;
    sum=0;
    for(let i=0;i<10;i+=1) sum += Number(cpf[i]) * (11-i);
    digit=(sum*10)%11;
    if(digit===10) digit=0;
    return digit===Number(cpf[10]);
  }
})();
