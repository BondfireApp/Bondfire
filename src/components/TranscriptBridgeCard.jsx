export function TranscriptBridgeCard({ draft, setDraft }) {
  return (
    <section className="card" style={{ padding: 12 }}>
      <h3>Transcript</h3>
      <textarea
        value={draft?.fullTranscript || ''}
        onChange={(e) => setDraft?.({ ...(draft || {}), fullTranscript: e.target.value })}
        style={{ width: '100%', minHeight: 100 }}
        placeholder="Transcript text"
      />
    </section>
  )
}
