(function(){
  const state = { preview:null, configurado:false };

  function el(id){ return document.getElementById(id); }
  function esc(v){ return String(v ?? "").replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
  function dinheiro(v){ return Number(v || 0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}); }
  function dataBR(iso){ const m=String(iso||'').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m?`${m[3]}/${m[2]}/${m[1]}`:String(iso||''); }

  function hojeISO(){
    const d = new Date();
    const p = n => String(n).padStart(2,'0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
  }

  function setStatus(texto, tipo){
    const box=el('waCobrancaStatus');
    if(!box) return;
    box.textContent=texto || '';
    box.className='wa-status' + (tipo ? ` ${tipo}` : '');
  }

  function setProvider(texto, ok){
    const box=el('waProviderStatus');
    if(!box) return;
    box.textContent=texto;
    box.className='wa-provider ' + (ok ? 'ok' : 'warn');
  }

  async function carregarStatus(){
    try{
      const resp=await fetch('/api/whatsapp/cobranca/status',{cache:'no-store',credentials:'include'});
      const json=await resp.json();
      if(!resp.ok || !json.ok) throw new Error(json.erro || 'Falha ao consultar WhatsApp.');
      state.configurado=Boolean(json.configurado);
      if(json.configurado){
        setProvider(`🟢 WhatsApp Cloud conectado · template: ${json.template}`, true);
      }else{
        const faltando=(json.faltando||[]).join(', ');
        setProvider(`🟡 Envio automático ainda não configurado${faltando ? ' · faltando: '+faltando : ''}`, false);
      }
      const btn=el('waBtnEnviar');
      if(btn) btn.disabled=!state.configurado || !state.preview || !state.preview.pendentes_envio;
    }catch(e){
      state.configurado=false;
      setProvider('🔴 Não foi possível consultar a configuração do WhatsApp.', false);
    }
  }

  function renderPreview(data){
    state.preview=data;
    const resumo=el('waCobrancaResumo');
    const tabela=el('waCobrancaTabelaBody');
    const ignorados=el('waCobrancaIgnorados');
    const btn=el('waBtnEnviar');

    if(resumo){
      resumo.innerHTML=`
        <div><strong>${Number(data.total_clientes||0)}</strong><span>clientes aptos</span></div>
        <div><strong>${Number(data.pendentes_envio||0)}</strong><span>para enviar agora</span></div>
        <div><strong>${Number(data.ja_enviados_hoje||0)}</strong><span>já enviados hoje</span></div>
        <div><strong>${Number((data.ignorados||[]).length)}</strong><span>ignorados</span></div>`;
    }

    if(tabela){
      const rows=(data.aptos||[]);
      tabela.innerHTML=rows.length ? rows.map(item=>`<tr>
        <td>${esc(item.nome)}</td>
        <td>${esc(item.telefone)}</td>
        <td>${esc(dataBR(item.vencimento))}</td>
        <td>${esc(dinheiro(item.valor))}</td>
        <td>${item.ja_enviado_hoje ? '<span class="wa-pill sent">Enviado hoje</span>' : '<span class="wa-pill pending">Pendente</span>'}</td>
      </tr>`).join('') : '<tr><td colspan="5" class="wa-empty">Nenhum cliente apto para essa data.</td></tr>';
    }

    if(ignorados){
      const itens=(data.ignorados||[]);
      ignorados.innerHTML=itens.length
        ? `<details><summary>${itens.length} registro(s) ignorado(s)</summary><ul>${itens.slice(0,100).map(i=>`<li><strong>${esc(i.nome||'Cliente')}</strong> — ${esc(i.motivo||'Ignorado')}</li>`).join('')}</ul></details>`
        : '';
    }

    if(btn) btn.disabled=!state.configurado || !(data.pendentes_envio>0);
  }

  async function buscar(){
    const data=el('waCobrancaData')?.value || '';
    if(!data){ alert('Selecione a data de vencimento.'); return; }
    setStatus('Buscando clientes e cobranças dessa data…','loading');
    const btn=el('waBtnBuscar');
    if(btn) btn.disabled=true;
    try{
      const resp=await fetch('/api/whatsapp/cobranca/preview?vencimento='+encodeURIComponent(data),{cache:'no-store',credentials:'include'});
      const json=await resp.json();
      if(!resp.ok || !json.ok) throw new Error(json.erro || 'Não foi possível carregar as cobranças.');
      renderPreview(json);
      setStatus(`${json.pendentes_envio || 0} cliente(s) pronto(s) para receber a mensagem de cobrança.`,'ok');
    }catch(e){
      state.preview=null;
      renderPreview({aptos:[],ignorados:[],total_clientes:0,pendentes_envio:0,ja_enviados_hoje:0});
      setStatus('Erro: '+e.message,'error');
    }finally{
      if(btn) btn.disabled=false;
    }
  }

  async function enviar(){
    if(!state.preview || !state.preview.vencimento){ alert('Primeiro clique em “Buscar da data”.'); return; }
    const qtd=Number(state.preview.pendentes_envio||0);
    if(qtd<1){ alert('Não há mensagens pendentes para enviar nessa data.'); return; }
    if(!state.configurado){ alert('Configure a WhatsApp Cloud API antes do envio automático.'); return; }

    const dataBRFmt=dataBR(state.preview.vencimento);
    if(!confirm(`Enviar mensagem de cobrança para ${qtd} cliente(s) com vencimento em ${dataBRFmt}?\n\nNenhum boleto será criado ou alterado.`)) return;

    const btn=el('waBtnEnviar');
    const buscar=el('waBtnBuscar');
    if(btn){ btn.disabled=true; btn.textContent='Enviando…'; }
    if(buscar) buscar.disabled=true;
    setStatus(`Enviando ${qtd} mensagem(ns). Aguarde…`,'loading');

    try{
      const resp=await fetch('/api/whatsapp/cobranca/enviar',{
        method:'POST',
        credentials:'include',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({vencimento:state.preview.vencimento,confirmar:true})
      });
      const json=await resp.json();
      if(!resp.ok) throw new Error(json.erro || 'Falha no envio.');

      const enviados=Number(json.enviados||0);
      const erros=Array.isArray(json.erros)?json.erros:[];
      setStatus(`Concluído: ${enviados} enviada(s)${erros.length ? ` · ${erros.length} erro(s)` : ''}.`, erros.length ? 'warn' : 'ok');
      if(erros.length){
        const detalhe=erros.slice(0,10).map(e=>`${e.nome}: ${e.erro}`).join('\n');
        alert(`Envio concluído com ${erros.length} erro(s).\n\n${detalhe}`);
      }
      await buscar();
    }catch(e){
      setStatus('Erro no envio: '+e.message,'error');
      alert('Não foi possível concluir o envio: '+e.message);
    }finally{
      if(btn){ btn.textContent='Cobrar todos por WhatsApp'; }
      if(buscar) buscar.disabled=false;
      await carregarStatus();
    }
  }

  document.addEventListener('DOMContentLoaded',function(){
    const data=el('waCobrancaData');
    if(data && !data.value) data.value=hojeISO();
    el('waBtnBuscar')?.addEventListener('click',buscar);
    el('waBtnEnviar')?.addEventListener('click',enviar);
    carregarStatus();
  });
})();
