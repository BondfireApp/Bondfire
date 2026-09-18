// v4: Map legacy hash routes like #/dashboard to org-scoped routes.
(function(){
  const map = (hash, currentOrg) => {
    if (!hash || hash === '#/' || hash === '#') return '#/public';
    if (hash === '#/dashboard') return `#/o/${currentOrg}/home`;
    if (hash === '#/people') return `#/o/${currentOrg}/people`;
    if (hash === '#/inventory') return `#/o/${currentOrg}/inventory`;
    if (hash === '#/needs') return `#/o/${currentOrg}/needs`;
    if (hash === '#/meetings') return `#/o/${currentOrg}/meetings`;
    if (hash === '#/settings') return `#/o/${currentOrg}/settings`;
    return hash;
  };

  function currentOrgId(){
    try{
      const raw = localStorage.getItem('bf_store_v2');
      const s = raw ? JSON.parse(raw) : {};
      return s.currentOrgId || (s.orgs && s.orgs[0]?.id) || 'crman';
    }catch{ return 'crman'; }
  }

  function rewriteIfNeeded(){
    const target = map(window.location.hash, currentOrgId());
    if (target !== window.location.hash) {
      window.location.hash = target;
    }
  }

  window.addEventListener('hashchange', rewriteIfNeeded);
  window.addEventListener('load', rewriteIfNeeded);
  setTimeout(rewriteIfNeeded, 0);
})();