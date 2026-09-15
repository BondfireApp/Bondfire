// fixes/brandBarMount.js — ES5 + runtime controls for logo size & colors
(function(){
  function parseQuery(){
    var href = String(window.location.href || '');
    var qStart = href.indexOf('?');
    var hStart = href.indexOf('#');
    if (qStart === -1) return {};
    var q = href.slice(qStart + 1, hStart === -1 ? href.length : hStart);
    var out = {};
    var parts = q.split('&');
    for (var i=0;i<parts.length;i++){
      var kv = parts[i].split('=');
      if (!kv[0]) continue;
      out[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
    }
    return out;
  }

  // CSS (ASCII-only)
  function injectCSS(){
    var css = ''
      + 'html, body { margin:0 !important; }\n'
      + ':root{ --bf-topfill:#0f0f0f; --bf-brandbar:#0f0f0f; --bf-logo-size:24px; }\n'
      + '.bf-topfill{ position:fixed; top:0; left:0; right:0; height:76px; background:var(--bf-topfill); z-index:900; pointer-events:none; }\n'
      + '.bf-brandbar{ position:relative; z-index:950; width:100%; background:var(--bf-brandbar); border-bottom:1px solid #2a2a2a; box-shadow:0 4px 20px rgba(0,0,0,0.25); }\n'
      + '.bf-brandbar__inner{ max-width:1100px; margin:0 auto; padding:6px 12px; display:flex; align-items:center; gap:8px; }\n'
      + '.bf-brandbar__brand{ display:flex; align-items:center; gap:8px; color:#fff; text-decoration:none; }\n'
      + '.bf-brandbar__logo{ width:var(--bf-logo-size); height:var(--bf-logo-size); display:inline-block; }\n'
      + '.bf-brandbar__text{ font-weight:800; font-size:17px; letter-spacing:.2px; color:#fff; }\n'
      + '@media (max-width:720px){ .bf-topfill{height:70px} .bf-brandbar__inner{padding:4px 10px} .bf-brandbar__text{font-size:16px} }\n';
    var style = document.createElement('style');
    style.setAttribute('data-brandbar','true');
    style.appendChild(document.createTextNode(css));
    document.head.appendChild(style);
  }

  var fillEl = null, barEl = null, logoEl = null;
  function ensureElements(){
    fillEl = document.querySelector('.bf-topfill');
    if (!fillEl){
      fillEl = document.createElement('div');
      fillEl.className = 'bf-topfill';
      document.body.insertBefore(fillEl, document.body.firstChild);
    }
    barEl = document.querySelector('.bf-brandbar');
    if (!barEl){
      barEl = document.createElement('header');
      barEl.className = 'bf-brandbar';
      var inner = document.createElement('div');
      inner.className = 'bf-brandbar__inner';
      barEl.appendChild(inner);
      var a = document.createElement('a');
      a.href = '#/public';
      a.className = 'bf-brandbar__brand';
      a.setAttribute('aria-label', 'Bondfire Home');
      inner.appendChild(a);
      logoEl = document.createElement('img');
      logoEl.src = '/logo-bondfire.png';
      logoEl.alt = '';
      logoEl.className = 'bf-brandbar__logo';
      logoEl.onerror = function(){ logoEl.style.display = 'none'; };
      a.appendChild(logoEl);
      var span = document.createElement('span');
      span.className = 'bf-brandbar__text';
      span.appendChild(document.createTextNode('Bondfire'));
      a.appendChild(span);

      var fillNext = fillEl.nextSibling;
      if (fillNext){
        document.body.insertBefore(barEl, fillNext);
      } else {
        document.body.appendChild(barEl);
      }
    } else {
      logoEl = barEl.querySelector('.bf-brandbar__logo');
    }
  }

  // Runtime controls
  function setColors(tf, bb){
    var root = document.documentElement;
    if (tf){ root.style.setProperty('--bf-topfill', tf); try{ localStorage.setItem('bf_topfill', tf); }catch(e){} }
    if (bb){ root.style.setProperty('--bf-brandbar', bb); try{ localStorage.setItem('bf_brandbar', bb); }catch(e){} }
  }
  function setLogoSize(px){
    var root = document.documentElement;
    if (!px) return;
    var val = String(px);
    if (val.indexOf('px') === -1 && val.indexOf('%') === -1 && val.indexOf('rem') === -1) {
      val = val + 'px';
    }
    root.style.setProperty('--bf-logo-size', val);
    try{ localStorage.setItem('bf_logo_px', val); }catch(e){}
  }

  function loadFromStorage(){
    try{
      var tf = localStorage.getItem('bf_topfill');
      var bb = localStorage.getItem('bf_brandbar');
      var ls = localStorage.getItem('bf_logo_px');
      if (tf) document.documentElement.style.setProperty('--bf-topfill', tf);
      if (bb) document.documentElement.style.setProperty('--bf-brandbar', bb);
      if (ls) document.documentElement.style.setProperty('--bf-logo-size', ls);
    }catch(e){}
  }

  function loadFromQuery(){
    var q = parseQuery();
    if (q.topfill) setColors(q.topfill, null);
    if (q.brandbar) setColors(null, q.brandbar);
    if (q.logosize) setLogoSize(q.logosize);
  }

  // Expose helpers
  window.bfSetBrandColors = function(topfill, brandbar){ setColors(topfill, brandbar); };
  window.bfSetLogoSize = function(size){ setLogoSize(size); };

  function init(){
    injectCSS();
    ensureElements();
    loadFromStorage();
    loadFromQuery();
  }
  if (document.readyState === 'loading'){ document.addEventListener('DOMContentLoaded', init); }
  else { init(); }
})();