// kill duplicate subheaders rendered by older page templates
function nuke() {
  try {
    const header = document.querySelector('[data-app-header]')
    const candidates = Array.from(document.querySelectorAll('.brand, .section-brand, .org-brand-row'))
    candidates.forEach(el => {
      // if it's inside the real header, keep it
      if (header && header.contains(el)) return
      // otherwise hide any brandy-looking rows that are within 120px of the top
      const rect = el.getBoundingClientRect()
      if (rect.top < 160) {
        const container = el.closest('.brand-row, .section-brand, header, .card, .kpi-header') || el
        container.style.display = 'none'
        container.setAttribute('data-nuked-subheader','true')
      }
    })
  } catch (e) {}
}

const ro = new MutationObserver(() => nuke())
ro.observe(document.documentElement, { subtree: true, childList: true })
window.addEventListener('hashchange', nuke)
window.addEventListener('load', nuke)
setTimeout(nuke, 0)
