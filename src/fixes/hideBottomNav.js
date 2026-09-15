// v4: hide legacy bottom nav app-wide without touching that component
(function(){
  function injectCSS(){
    const css = `.bottomnav{ display: none !important; }`;
    const style = document.createElement('style');
    style.setAttribute('data-hide-bottomnav','true');
    style.textContent = css;
    document.head.appendChild(style);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectCSS);
  } else {
    injectCSS();
  }
})();