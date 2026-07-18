(function(){
  'use strict';
  function qs(s,r){return (r||document).querySelector(s)}
  function qsa(s,r){return Array.from((r||document).querySelectorAll(s))}

  function openMenu(){
    document.body.classList.add('menu-open');
    const sidebar=qs('.sidebar'); if(sidebar){ sidebar.classList.add('open'); sidebar.setAttribute('aria-hidden','false'); }
    const overlay=qs('.overlay'); if(overlay){overlay.classList.add('show','active','open')}
  }
  function closeMenu(){
    document.body.classList.remove('menu-open');
    const sidebar=qs('.sidebar'); if(sidebar){ sidebar.classList.remove('open','active','show'); sidebar.setAttribute('aria-hidden','true'); }
    const overlay=qs('.overlay'); if(overlay) overlay.classList.remove('show','active','open');
  }
  window.abrirMenuLateral=openMenu;
  window.fecharMenuLateral=closeMenu;
  window.abrirMenu=openMenu;
  window.fecharMenu=closeMenu;
  window.closeMobileMenu=closeMenu;

  function prepareTables(root){
    qsa('.table-wrap table',root||document).forEach(function(table){
      if(table.closest('.keep-scroll')) return;
      const headers=qsa('thead th',table).map(function(th){return th.textContent.trim()});
      if(!headers.length) return;
      table.classList.add('responsive-cards');
      qsa('tbody tr',table).forEach(function(row){
        qsa('td',row).forEach(function(td,i){
          if(!td.hasAttribute('data-label')) td.setAttribute('data-label',headers[i]||'Informação');
        });
      });
    });
  }

  function normalizeButtons(){
    qsa('.menu-btn').forEach(function(btn){
      btn.type='button';
      btn.onclick=function(e){e.preventDefault();openMenu()};
      btn.setAttribute('aria-label','Abrir menu');
    });
    qsa('.overlay,.sidebar-overlay,.mobile-menu-overlay').forEach(function(el){
      el.onclick=closeMenu;
    });
    const sidebar=qs('.sidebar');
    if(sidebar){
      sidebar.style.webkitOverflowScrolling='touch';
      sidebar.addEventListener('touchmove',function(e){ e.stopPropagation(); },{passive:true});
    }
    qsa('.sidebar .nav a').forEach(function(a){
      a.addEventListener('click',function(){if(innerWidth<=900) closeMenu()});
    });
  }

  function init(){
    normalizeButtons();
    prepareTables(document);
    document.addEventListener('keydown',function(e){if(e.key==='Escape') closeMenu()});
    let queued=false;
    const observer=new MutationObserver(function(){
      if(queued) return; queued=true;
      requestAnimationFrame(function(){queued=false;prepareTables(document)});
    });
    observer.observe(document.body,{childList:true,subtree:true});
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init); else init();
})();
