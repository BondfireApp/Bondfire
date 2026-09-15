import { AdminPublicConfigCard } from './AdminPublicConfigCard'
import { PublicDomainCard } from './PublicDomainCard'

export function AdminPage() {
  return (
    <main className="page admin-page">
      <section className="admin-shell">
        <header className="admin-shell__header">
          <div>
            <h1>Admin</h1>
            <p>Public site content and domain plumbing only. No private-system nonsense in here.</p>
          </div>
        </header>

        <div className="admin-shell__body">
          <AdminPublicConfigCard />
          <PublicDomainCard />
        </div>
      </section>
    </main>
  )
}
