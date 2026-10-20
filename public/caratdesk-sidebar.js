// CaratDesk – collapsible sidebar (desktop icon-only rail).
// Loaded in <head> on every page with #cdSidebar so the saved state applies before first paint.
// A round arrow button on the sidebar's right edge (bottom, by the user card) collapses/expands it on desktop; on mobile
// (≤768px) it is hidden and the page's own ☰ slide-in drawer is untouched. State is remembered across pages.
(function(){
  var KEY='cdSidebarCollapsed', CLS='cd-sb-collapsed', RAIL='64px';
  try{ if(localStorage.getItem(KEY)==='1') document.documentElement.classList.add(CLS); }catch(e){}

  var css =
    '.cd-sb-arrow{display:none}' +
    '@media(min-width:769px){' +
      // Fixed (not inside the sidebar) so the sidebar's overflow can't clip it; straddles the
      // sidebar's right edge, level with the user card at the bottom
      '.cd-sb-arrow{display:flex;position:fixed;bottom:62px;left:248px;z-index:210;width:24px;height:24px;border-radius:50%;' +
        'border:.5px solid var(--border-strong,var(--border));background:var(--surface);color:var(--text-secondary);box-shadow:var(--shadow-sm);' +
        'align-items:center;justify-content:center;cursor:pointer;padding:0;transition:left .2s ease,background .14s,color .14s}' +
      '.cd-sb-arrow:hover{background:var(--nav-hover);color:var(--text-primary)}' +
      '.cd-sb-arrow svg{width:13px;height:13px;stroke:currentColor;fill:none;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;transition:transform .2s ease}' +
      'html.'+CLS+' .cd-sb-arrow{left:52px}' +
      'html.'+CLS+' .cd-sb-arrow svg{transform:rotate(180deg)}' +
      '.cd-sidebar{transition:width .2s ease,transform .3s cubic-bezier(.2,.9,.4,1.1)!important;overflow-x:hidden}' +
      '.cd-main,.cd-footer,.cd-form-footer{transition:margin-left .2s ease,left .2s ease}' +
      'html.'+CLS+' .cd-sidebar{width:'+RAIL+'!important}' +
      'html.'+CLS+' .cd-main{margin-left:'+RAIL+'!important}' +
      'html.'+CLS+' .cd-footer,html.'+CLS+' .cd-form-footer{left:'+RAIL+'!important}' +
      'html.'+CLS+' .cd-sidebar-logo{justify-content:center;padding-left:0!important;padding-right:0!important}' +
      'html.'+CLS+' .cd-sidebar-logo>div{display:none}' +
      'html.'+CLS+' .cd-nav-section{font-size:0!important;padding:0!important;margin:8px 10px!important;height:.5px;background:var(--border)}' +
      'html.'+CLS+' .cd-nav-item{font-size:0!important;justify-content:center;gap:0!important;padding-left:0!important;padding-right:0!important}' +
      'html.'+CLS+' .cd-instance-bar,html.'+CLS+' .cd-user-card>div:not(.cd-avatar){display:none!important}' +
      'html.'+CLS+' .cd-user-card{justify-content:center;padding-left:0!important;padding-right:0!important}' +
      'html.'+CLS+' .cd-logout-btn{font-size:0!important;justify-content:center;gap:0!important}' +
    '}';
  var style=document.createElement('style');
  style.textContent=css;
  document.head.appendChild(style);

  function wire(){
    var sidebar=document.getElementById('cdSidebar');
    if(!sidebar) return;
    // Collapsed rail shows icons only — keep the label as a hover tooltip
    var items=sidebar.querySelectorAll('.cd-nav-item, .cd-logout-btn');
    for(var i=0;i<items.length;i++){ if(!items[i].title) items[i].title=items[i].textContent.trim(); }
    var arrow=document.createElement('button');
    arrow.type='button';
    arrow.className='cd-sb-arrow';
    arrow.innerHTML='<svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>';
    function syncTitle(){ arrow.title=document.documentElement.classList.contains(CLS)?'Expand sidebar':'Collapse sidebar'; }
    syncTitle();
    arrow.addEventListener('click', function(){
      var collapsed=document.documentElement.classList.toggle(CLS);
      try{ localStorage.setItem(KEY, collapsed?'1':'0'); }catch(e){}
      syncTitle();
    });
    document.body.appendChild(arrow);
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
