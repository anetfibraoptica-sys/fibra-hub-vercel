/* Fibra+ Hub - Etapa 1: clientes com Supabase como fonte única */
(function(){
  "use strict";
  const api = async (url, options={}) => {
    const r=await fetch(url,{cache:"no-store",...options});
    const j=await r.json().catch(()=>({}));
    if(!r.ok || j.ok===false) throw new Error(j.erro || `Falha HTTP ${r.status}`);
    return j;
  };
  async function listar(){
    const j=await api('/api/clientes');
    const lista=Array.isArray(j.clientes)?j.clientes:[];
    window.__fibraClientesSupabase=lista;
    window.__clientesReceitaNet=lista; // compatibilidade visual, sem persistência
    return lista;
  }
  async function buscar(chave){
    const j=await api('/api/clientes/buscar?chave='+encodeURIComponent(chave));
    return j.cliente;
  }
  async function salvar(cliente){
    const j=await api('/api/clientes/salvar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(cliente||{})});
    return j.cliente;
  }
  function chave(c={}){ return c.id || ''; }
  function abrir(c){ const v=(typeof c==='object'?(c.id||''):c); location.href='cadastro.html?id='+encodeURIComponent(v); }
  window.FibraClientesStage1={listar,buscar,salvar,abrir};
  window.abrirClienteCadastro=abrir;

  async function atualizarLista(){
    if(!/clientes\.html$/i.test(location.pathname)) return;
    const lista=await listar();
    if(typeof atualizarContadores==='function') atualizarContadores(lista);
    if(typeof renderizarClientesReceitaNet==='function') renderizarClientesReceitaNet(lista);
    else if(typeof renderizarClientes==='function') renderizarClientes(lista);
    else if(typeof renderClientes==='function') renderClientes(lista);
  }
  function texto(v){
    if(v === undefined || v === null) return "";
    if(typeof v === "object") return "";
    return String(v).trim();
  }

  function primeiro(obj, nomes){
    const fontes=[obj, obj && obj.dados, obj && obj.cliente, obj && obj.cadastro].filter(x=>x && typeof x==='object');
    for(const fonte of fontes){
      for(const nome of nomes){
        const v=fonte[nome];
        if(v !== undefined && v !== null && texto(v) !== "") return v;
      }
    }
    return "";
  }

  function dataISO(v){
    const s=texto(v);
    if(!s) return "";
    let m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if(m) return `${m[1]}-${m[2]}-${m[3]}`;
    m=s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if(m) return `${m[3]}-${m[2]}-${m[1]}`;
    return s;
  }

  function booleano(v){
    if(typeof v === 'boolean') return v;
    return ['1','true','sim','yes','on','s'].includes(texto(v).toLowerCase());
  }

  function setCampo(id, valor, opcoes={}){
    const el=document.getElementById(id);
    if(!el) return false;
    if(el.type==='checkbox'){
      el.checked=booleano(valor);
    }else if(el.type==='date'){
      el.value=dataISO(valor);
    }else if(el.tagName==='SELECT'){
      const alvo=texto(valor);
      if(!alvo){ el.value=''; }
      else {
        const normal=s=>texto(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
        const opt=Array.from(el.options).find(o=>normal(o.value)===normal(alvo) || normal(o.textContent)===normal(alvo));
        if(opt) el.value=opt.value;
        else if(opcoes.criarOpcao){
          const nova=new Option(alvo,alvo,true,true);
          el.add(nova);
        }
      }
    }else{
      el.value=texto(valor);
    }
    el.dispatchEvent(new Event('input',{bubbles:true}));
    el.dispatchEvent(new Event('change',{bubbles:true}));
    return true;
  }

  function preencherCadastroCompleto(c){
    if(!c || typeof c!=='object') return;
    const mapa={
      cadLogin:['cadLogin','loginPppoe','login_pppoe','login','usuario','user','pppoe','clienteLogin'],
      cadSenha:['cadSenha','senhaPppoe','senha_pppoe','senha','password','pass'],
      cadNome:['cadNome','nome','cliente','nomeCliente','razaoSocial','razao_social','name'],
      cadCpf:['cadCpf','cpfCnpj','cpf_cnpj','cpf','cnpj','documento','doc'],
      cadNascimento:['cadNascimento','dataNascimento','data_nascimento','nascimento','dtNascimento'],
      cadRg:['cadRg','rgIe','rg_ie','rg','ie','inscricaoEstadual','inscricao_estadual'],
      cadIndicadorIe:['cadIndicadorIe','indicadorIe','indicador_ie','contribuinteIcms'],
      cadEmail:['cadEmail','email','e_mail','mail'],
      cadCep:['cadCep','cep','codigoPostal','codigo_postal'],
      cadEndereco:['cadEndereco','endereco','logradouro','rua','address'],
      cadReferencia:['cadReferencia','referencia','pontoReferencia','ponto_referencia'],
      cadComplemento:['cadComplemento','complemento'],
      cadBairro:['cadBairro','bairro'],
      cadCidade:['cadCidade','cidade','localidade','municipio'],
      cadUf:['cadUf','uf','estado'],
      cadClasse:['cadClasse','classe','tipoCliente','tipo_cliente'],
      cadSetor:['cadSetor','setor'],
      cadSetorResponsavel:['cadSetorResponsavel','setorResponsavel','setor_responsavel'],
      cadTelefone1:['cadTelefone1','telefone1','telefone','celular','whatsapp','fone'],
      cadTelefone2:['cadTelefone2','telefone2','celular2','fone2'],
      cadTelefone3:['cadTelefone3','telefone3','celular3','fone3'],
      cadVencimento:['cadVencimento','diaVencimento','dia_vencimento','vencimento'],
      cadInicioCobranca:['cadInicioCobranca','inicioCobranca','inicio_cobranca','dataInicioCobranca'],
      cadLiberacaoConfianca:['cadLiberacaoConfianca','liberacaoConfianca','liberacao_confianca'],
      cadBloqueio:['cadBloqueio','dataBloqueio','data_bloqueio','bloqueio'],
      cadCancelamento:['cadCancelamento','dataCancelamento','data_cancelamento','cancelamento'],
      cadStatusCobranca:['cadStatusCobranca','statusCobranca','status_cobranca'],
      cadContrato:['cadContrato','contrato','tipoContrato','tipo_contrato'],
      cadNumeroContrato:['cadNumeroContrato','numeroContrato','numero_contrato','contratoNumero'],
      cadSituacao:['cadSituacao','situacao','statusCliente','status_cliente','status'],
      cadDescontoAteVenc:['cadDescontoAteVenc','descontoAteVenc','desconto_ate_vencimento'],
      cadDesconto:['cadDesconto','desconto','valorDesconto','valor_desconto'],
      cadContaBancaria:['cadContaBancaria','contaBancaria','conta_bancaria','efiContaNome','efi_conta_nome'],
      cadBaseReferencia:['cadBaseReferencia','baseReferencia','base_referencia'],
      cadPop:['cadPop','popServidor','pop_servidor','servidor','servidorReceita','pop'],
      cadInterface:['cadInterface','interface','interfaceServidor','interface_servidor'],
      cadConexao:['cadConexao','conexao','tipoConexao','tipo_conexao'],
      cadProfile:['cadProfile','profile','perfil','plano','planoVelocidade','velocidade'],
      cadSinal:['cadSinal','sinal','sinalOnu','sinal_onu','rxPower'],
      cadElementoRede:['cadElementoRede','elementoRede','elemento_rede','olt','onu','caixa'],
      cadIpTipo:['cadIpTipo','ipTipo','ip_tipo','tipoIp','tipo_ip'],
      cadMac:['cadMac','mac','macAddress','mac_address','callerId','caller-id'],
      cadIp:['cadIp','ip','ipAddress','ip_address','address'],
      cadSerialOnu:['cadSerialOnu','serialOnu','serial_onu','serial','onuSerial'],
      cadTecnologia:['cadTecnologia','tecnologia','tipoTecnologia','tipo_tecnologia'],
      cadPortaAcesso:['cadPortaAcesso','portaAcesso','porta_acesso','porta','pon'],
      cadDhcp:['cadDhcp','dhcp'],
      cadNaoAmarrarMac:['cadNaoAmarrarMac','naoAmarrarMac','nao_amarrar_mac'],
      cadObservacao:['cadObservacao','observacao','observacoes','obs'],
    };

    // O POP precisa ser preenchido primeiro para que as listas dependentes sejam montadas.
    setCampo('cadPop', primeiro(c,mapa.cadPop), {criarOpcao:true});
    if(typeof atualizarInterfaceServidor==='function') atualizarInterfaceServidor();
    if(typeof atualizarConexaoServidor==='function') atualizarConexaoServidor();

    for(const [id,aliases] of Object.entries(mapa)){
      if(id==='cadPop' || id==='cadInterface' || id==='cadConexao') continue;
      setCampo(id, primeiro(c,aliases), {criarOpcao:true});
    }

    const cpfCampo=document.getElementById('cadCpf');
    if(cpfCampo && typeof window.mascararCpfCadastro==='function') window.mascararCpfCadastro(cpfCampo);

    const profileCampo=document.getElementById('cadProfile');
    const profileNormal=texto(primeiro(c,['profileNormal','profile_normal','perfilNormal','perfil_normal']));
    if(profileCampo && profileNormal) profileCampo.dataset.profileNormal=profileNormal;

    // Aguarda a montagem das opções dependentes do servidor.
    setTimeout(()=>{
      setCampo('cadInterface', primeiro(c,mapa.cadInterface), {criarOpcao:true});
      setCampo('cadConexao', primeiro(c,mapa.cadConexao), {criarOpcao:true});
      if(typeof atualizarResumoCadastro==='function') atualizarResumoCadastro();
      document.dispatchEvent(new CustomEvent('fibra:resumo-pronto',{detail:c}));
    },120);

    const ident=document.getElementById('cadIdentificador');
    if(ident) ident.textContent='Identificador: '+texto(primeiro(c,['id','identificador','clienteId','cliente_id']) || '--');
    const h=document.querySelector('.topbar h1, h1');
    if(h) h.textContent='Cadastro de Cliente - Editando';
    window.__fibraClienteSelecionado=c;
    window.__fibraClienteCadastro=c;
    if(typeof atualizarResumoCadastro==='function') atualizarResumoCadastro();
    requestAnimationFrame(()=>setTimeout(()=>{
      if(typeof atualizarResumoCadastro==='function') atualizarResumoCadastro();
    },0));
  }
  window.preencherCadastroCompletoSupabase=preencherCadastroCompleto;

  async function carregarCadastroURL(){
    if(!/cadastro\.html$/i.test(location.pathname)) return null;

    const params=new URLSearchParams(location.search);
    const novo=params.get('novo');
    if(novo==='1' || novo==='true') return null;

    const valor=
      params.get('id') ||
      params.get('cliente') ||
      params.get('login') ||
      params.get('editar') ||
      params.get('edit');

    if(!valor) return null;

    const c=await buscar(valor);
    preencherCadastroCompleto(c);
    document.dispatchEvent(new CustomEvent('fibra:cliente-carregado',{detail:c}));
    return c;
  }

  // Compatibilidade com o onload existente do cadastro.html.
  // A função é global e segura tanto para novo cadastro quanto para edição.
  window.carregarCadastroClienteHub=function(){
    return carregarCadastroURL().catch(function(e){
      console.error('Cadastro Supabase:',e);
      return null;
    });
  };
  document.addEventListener('DOMContentLoaded',()=>{
    atualizarLista().catch(e=>console.error('Clientes Supabase:',e));
    if(!/cadastro\.html$/i.test(location.pathname)) carregarCadastroURL().catch(e=>console.error('Cadastro Supabase:',e));
  });
  window.addEventListener('pageshow',()=>atualizarLista().catch(()=>{}));
})();
