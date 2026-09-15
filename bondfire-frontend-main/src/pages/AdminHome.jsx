import React from 'react'
import AppHeader from '../components/AppHeader.jsx'
import { useStore } from '../utils/store.js'

export default function AdminHome(){
  const { people, inventory, needs, pledges } = useStore(s=>({people:s.people, inventory:s.inventory, needs:s.needs, pledges:s.pledges}))
  const kpi = [
    { label:'People', value: people.length },
    { label:'Inventory (public)', value: inventory.filter(i=>i.public).length },
    { label:'Open Needs', value: needs.filter(n=>n.status!=='resolved').length },
    { label:'Pledges', value: pledges.length },
  ]
  return (
    <div>
      <AppHeader />
      <div className="grid cols-4" style={{padding:16}}>
        {kpi.map(x=> (
          <div key={x.label} className="card kpi-card">
            <div className="section-title">{x.label}</div>
            <div style={{fontSize:28, fontWeight:700}}>{x.value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
