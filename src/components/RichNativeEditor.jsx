export function RichNativeEditor({ value = [], onChange, mediaAssetsSlot }) {
  const text = Array.isArray(value) ? value.map((block) => block?.text || '').join('\n\n') : String(value || '')
  return (
    <section className="card" style={{ padding: 12 }}>
      <label className="archive-control">
        <span>rich body</span>
        <textarea
          value={text}
          onChange={(e) => onChange?.([{ type: 'text', text: e.target.value }])}
          style={{ width: '100%', minHeight: 140 }}
        />
      </label>
      {typeof mediaAssetsSlot === 'function' ? mediaAssetsSlot({ onPick: () => {} }) : null}
    </section>
  )
}
