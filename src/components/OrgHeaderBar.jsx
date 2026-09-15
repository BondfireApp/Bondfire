// src/components/OrgHeaderBar.jsx
import React from 'react';
import { Link, useParams } from 'react-router-dom';

function useOrgInfo(orgId) {
  try {
    const orgs = JSON.parse(localStorage.getItem('bf_orgs') || '[]');
    const o = orgs.find(x => x.id === orgId);
    return { name: o?.name || 'Org', logo: o?.logoDataUrl || null };
  } catch {
    return { name: 'Org', logo: null };
  }
}

export default function OrgHeaderBar() {
  const { orgId } = useParams();
  const { name, logo } = useOrgInfo(orgId);

  return (
    <div className="row" style={{ alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid #ddd' }}>
      {/* Bondfire logo + link back to Org Dashboard */}
      <Link to="/app/#/orgs" className="row" style={{ alignItems: 'center', textDecoration: 'none', marginRight: 16 }}>
        <img src="/logo192.png" alt="Bondfire" style={{ width: 28, height: 28, marginRight: 8 }} />
        <strong style={{ color: 'black' }}>Bondfire</strong>
      </Link>

      {/* Current org logo + name */}
      {logo && (
        <img
          src={logo}
          alt={`${name} logo`}
          style={{ width: 28, height: 28, borderRadius: '50%', marginRight: 8 }}
        />
      )}
      <h3 style={{ margin: 0 }}>{name}</h3>
    </div>
  );
}
