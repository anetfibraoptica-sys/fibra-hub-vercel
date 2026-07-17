/* Fibra+ Hub - utilitários de status financeiro (Etapa 1)
   Nesta etapa este arquivo apenas calcula status. Ele não grava clientes
   em localStorage e não altera o MikroTik automaticamente. */
(function(){
  "use strict";
  const DEFAULT_DIAS_BLOQUEIO = 4;
  const norm = v => String(v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  const doc = v => String(v || "").replace(/\D/g, "");
  function parseData(v){
    if(!v) return null;
    const s=String(v).trim();
    let m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if(m) return new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00`);
    m=s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if(m) return new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00`);
    const d=new Date(s); return Number.isNaN(d.getTime()) ? null : d;
  }
  function diasAtraso(v){
    const d=parseData(v); if(!d) return 0;
    const hoje=new Date(); hoje.setHours(0,0,0,0); d.setHours(0,0,0,0);
    return Math.max(0, Math.floor((hoje-d)/86400000));
  }
  function boletoQuitado(b={}){
    const s=norm(b.statusOriginal || b.statusReceitaNet || b.status || b.situacao || b.estado);
    return ["pago","baixado","receb","cancel","estornado"].some(x=>s.includes(x));
  }
  function mesmoCliente(c={},b={}){
    const a=norm(c.loginPppoe || c.login || c.usuario), z=norm(b.login || b.loginPppoe || b.clienteLogin || b.cliente_login);
    if(a && z && a===z) return true;
    const ad=doc(c.cpfCnpj || c.cpf_cnpj || c.cpf || c.cnpj), zd=doc(b.cpfCnpj || b.cpf_cnpj || b.cpf || b.cnpj);
    if(ad && zd && ad===zd) return true;
    const an=norm(c.nome), zn=norm(b.nome || b.cliente || b.cliente_nome);
    return Boolean(an && zn && (an===zn || an.includes(zn) || zn.includes(an)));
  }
  window.FibraBloqueio = {
    DEFAULT_DIAS_BLOQUEIO, norm, doc, parseData, diasAtraso, boletoQuitado, mesmoCliente,
    boletoVencido(b={}, limite=DEFAULT_DIAS_BLOQUEIO){ return !boletoQuitado(b) && diasAtraso(b.vencimento)>=Number(limite || DEFAULT_DIAS_BLOQUEIO); }
  };
})();
