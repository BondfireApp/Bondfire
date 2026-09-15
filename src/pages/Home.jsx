import React, { useMemo, useState } from 'react';
import { getState } from '../utils_store';
import { useAuth } from '../context/AuthContext';
import { Link } from 'react-router-dom';

function Stat({label, value}){
  return (
    <div className="card">
      <div style={{fontSize:12, color:'var(--muted)'}}>{label}</div>
      <div style={{fontSize:28, fontWeight:700, marginTop:6}}>{value}</div>
    </div>
  );
}

function LoginCard(){
  const { login } = useAuth();
  const [form, setForm] = useState({ email:'', password:'' });
  const onSubmit = (e) => {
    e.preventDefault();
    if(!form.email || !form.password) return alert('Enter email & password');
    login({ id: crypto.randomUUID(), name: form.email.split('@')[0] || 'Member', email: form.email, role: 'admin' });
  };
  return (
    <div className="card">
      <h2>Log in</h2>
      <form onSubmit={onSubmit} className="grid" style={{gap:8}}>
        <input placeholder="email" value={form.email} onChange={e=>setForm({...form, email:e.target.value})} />
        <input placeholder="password" type="password" value={form.password} onChange={e=>setForm({...form, password:e.target.value})} />
        <button type="submit">Log in</button>
      </form>
      <p style={{marginTop:10, color:'var(--muted)', fontSize:12}}>Want real JWT? Point me at <code>/api/auth/login</code> and I'll POST the credentials and store the token.</p>
    </div>
  );
}

function CreateAccountCard(){
  const { register } = useAuth();
  const [form, setForm] = useState({ name:'', email:'', password:'' });
  const onSubmit = (e) => {
    e.preventDefault();
    if(!form.name || !form.email || !form.password) return alert('Fill all fields');
    register({ id: crypto.randomUUID(), name: form.name, email: form.email, role: 'admin' });
  };
  return (
    <div className="card">
      <h2>Create account</h2>
      <form onSubmit={onSubmit} className="grid" style={{gap:8}}>
        <input placeholder="name" value={form.name} onChange={e=>setForm({...form, name:e.target.value})} />
        <input placeholder="email" value={form.email} onChange={e=>setForm({...form, email:e.target.value})} />
        <input placeholder="password" type="password" value={form.password} onChange={e=>setForm({...form, password:e.target.value})} />
        <button type="submit">Create account</button>
      </form>
      <p style={{marginTop:10, color:'var(--muted)', fontSize:12}}>No email is sent in demo mode; we just store a user locally.</p>
    </div>
  );
}

export default function Home(){
  const s = getState();
  const stats = useMemo(()=>{
    const pubInv = s.inventory.filter(i=>i.public);
    const openNeeds = s.needs.filter(n=>n.status==='open');
    return {
      orgs: s.orgs?.length || 0,
      people: s.people?.length || 0,
      items: s.inventory?.length || 0,
      publicItems: pubInv.length,
      openNeeds: openNeeds.length,
      meetings: s.meetings?.length || 0
    };
  }, [s]);

  return (
    <div className="grid" style={{gap:12}}>
      <div className="card">
        <h1 style={{margin:'4px 0 8px'}}>Bondfire</h1>
        <p style={{color:'var(--muted)'}}>Mutual aid ops in one place. Keep people, inventory, needs, and meetings tight—then share only what you want on your org’s public page.</p>
      </div>

      <div className="grid cols-3">
        <Stat label="Orgs" value={stats.orgs} />
        <Stat label="People" value={stats.people} />
        <Stat label="Inventory items" value={stats.items} />
        <Stat label="Public items" value={stats.publicItems} />
        <Stat label="Open needs" value={stats.openNeeds} />
        <Stat label="Meetings" value={stats.meetings} />
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h2>Why join</h2>
          <ul style={{lineHeight:1.6, marginTop:8}}>
            <li>Track people, roles, and skills</li>
            <li>Inventory with low-stock alerts</li>
            <li>Post needs and close them out</li>
            <li>Public org page for sharing needs & offerings</li>
          </ul>
        </div>
        <div className="card">
          <h2>Features</h2>
          <ul style={{lineHeight:1.6, marginTop:8}}>
            <li>Org-scoped data and permissions</li>
            <li>CSV export for public inventory</li>
            <li>Fast local-first demo mode</li>
            <li>JWT-ready hooks for real auth</li>
          </ul>
        </div>
      </div>

      <div className="grid cols-2">
        <CreateAccountCard/>
        <LoginCard/>
      </div>

      <div className="card">
        <h3>Already have an org?</h3>
        <div className="row" style={{gap:8, flexWrap:'wrap'}}>
          {s.orgs.map(o => (
            <a key={o.id} className="linkbtn" href={`#/o/${o.id}/public`}>Visit {o.name} public page</a>
          ))}
        </div>
      </div>
    </div>
  );
}
