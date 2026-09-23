import React, { useState } from 'react';
import { api } from '../../utils/api.js';
import { WORK_ROLES } from '../../../shared/workModel.js';
import { saveWork } from './workClient.js';
import { Field, Select } from './WorkRecordForm.jsx';

export default function WorkSettings({ session, all, module, busy, run, onClose }) {
  const [permissions, setPermissions] = useState(session.context.permissions[module]);
  const settings = (all['case-settings'] || []).find(r => r.id === 'settings' && !r.locked);
  const [types, setTypes] = useState((settings?.caseTypes || []).join('\n')), [statuses, setStatuses] = useState((settings?.caseStatuses || []).join('\n')), [labels, setLabels] = useState((settings?.caseLabels || []).join('\n'));
  const [approvals, setApprovals] = useState(session.context.options.approvalsRequired);
  const [error, setError] = useState('');
  const lines = s => [...new Set(s.split('\n').map(t => t.trim()).filter(Boolean))];
  const base = `/api/orgs/${encodeURIComponent(session.orgId)}/work`;
  async function save(e) {
    e.preventDefault(); setError('');
    try {
      await run(async () => {
        if (module === 'cases') await saveWork(session, all, 'case-settings', settings || { id: 'settings' }, { parts: { content: { title: 'Case settings', caseTypes: lines(types), caseStatuses: lines(statuses), caseLabels: lines(labels) } } });
        if (module === 'treasury' && approvals !== session.context.options.approvalsRequired) await api(base + '/options', { method: 'PUT', body: JSON.stringify({ approvalsRequired: approvals, version: session.context.options.version }) });
        await api(base + '/permissions', { method: 'PUT', body: JSON.stringify({ module, permissions, version: session.context.permissionVersions[module] || 0 }) });
      });
      onClose();
    } catch (e) { setError(e.message); }
  }
  return <form className="card work-editor" onSubmit={save}><h2>Module settings</h2><p className="helper">Each action requires at least the selected organization role. Record and Working Group restrictions still apply. When you expand viewing access, open existing records on a trusted device and refresh their device access.</p>
    <div className="work-form-grid">{Object.entries(permissions).filter(([action]) => module === 'treasury' || !['approve', 'publish'].includes(action)).map(([action, value]) => <Select key={action} label={action === 'close' ? 'Close / archive / restore' : action === 'assign' ? 'Assign work' : action === 'publish' ? 'Publish transparency' : action} value={value} onChange={v => setPermissions({ ...permissions, [action]: v })} options={WORK_ROLES.filter(role => action === 'view' || (['approve', 'publish', 'settings'].includes(action) ? ['admin', 'owner'].includes(role) : role !== 'viewer'))} />)}</div>
    {module === 'cases' && <div className="work-form-grid">{[['Case types — one per line', types, setTypes], ['Additional statuses — one per line', statuses, setStatuses], ['Suggested labels — one per line', labels, setLabels]].map(([label, value, change]) => <Field key={label} label={label}><textarea className="textarea" rows={5} value={value} onChange={e => change(e.target.value)} /></Field>)}</div>}
    {module === 'treasury' && <label><input type="checkbox" checked={approvals} onChange={e => setApprovals(e.target.checked)} /> Require approval for new or edited transactions before they affect balances</label>}
    {error && <p role="alert" className="error">{error}</p>}<div className="work-actions"><button className="btn-red" disabled={busy}>Save settings</button><button className="btn" type="button" onClick={onClose}>Close</button></div>
  </form>;
}
