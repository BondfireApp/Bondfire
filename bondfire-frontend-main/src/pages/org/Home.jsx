import React from 'react'
import { getState } from '../../utils_store'
import { Link, useParams } from 'react-router-dom'

export default function OrgHome(){
  const { orgId } = useParams()
  const s = getState()
  const kpis = [
    {label:'People', value:s.people.length},
    {label:'Inventory', value:s.inventory.length},
    {label:'Needs', value:s.needs.length},
    {label:'Meetings', value:s.meetings.length},
  ]
  return (
    <div className="grid">
      <div className="kpis">
        {kpis.map(k=>(<div key={k.label} className="kpi"><div className="tag">{k.label}</div><h2>{k.value}</h2></div>))}
      </div>
      <div className="card actions">
        <Link className="linkbtn" to={`/o/${orgId}/people`}>People</Link>
        <Link className="linkbtn" to={`/o/${orgId}/inventory`}>Inventory</Link>
        <Link className="linkbtn" to={`/o/${orgId}/needs`}>Needs</Link>
        <Link className="linkbtn" to={`/o/${orgId}/meetings`}>Meetings</Link>
        <Link className="linkbtn" to={`/o/${orgId}/settings`}>Settings</Link>
      </div>
    </div>
  )
}
