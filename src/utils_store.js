/**
 * Super-light data layer backed by localStorage.
 * Everything lives under key 'bf_store_v2'.
 */
const KEY = 'bf_store_v2'

const defaultState = () => ({
  orgs: [
    { id: 'crman', name: 'Chehalis River Mutual Aid Network', slug:'crman', color:'#8a1111', logoDataUrl:null },
    { id: 'bondfire', name: 'Bondfire', slug:'bondfire', color:'#8a1111', logoDataUrl:null }
  ],
  currentOrgId: 'crman',
  people: [],
  inventory: [],
  needs: [],
  meetings: [],
  pledges: [],
  newsletters: [],
  requests: [],
  files: {} // {fileId: {name, dataUrl, mime, size}}
})

function save(state){ localStorage.setItem(KEY, JSON.stringify(state)); return state }
function load(){
  try { return JSON.parse(localStorage.getItem(KEY)) || save(defaultState()) }
  catch(e){ return save(defaultState()) }
}

let state = load()

export function getState(){ return state }
export function setState(next){ state = save(next) }
export function currentOrg(){ return state.orgs.find(o => o.id===state.currentOrgId) }

export function switchOrg(id){
  if(state.orgs.some(o => o.id===id)){
    state.currentOrgId = id;
    save(state)
  }
}

export function upsertOrg(partial){
  const idx = state.orgs.findIndex(o => o.id===partial.id)
  if(idx>=0){ state.orgs[idx] = {...state.orgs[idx], ...partial} }
  else { state.orgs.push({ id: crypto.randomUUID(), name:'New Org', slug:'new', color:'#8a1111', logoDataUrl:null, ...partial }) }
  save(state)
}

export function seedDemo(){
  const now = Date.now()
  state.people = [
    {id:'p1', org:'crman', name:'Alex Stone', role:'Volunteer', phone:'555-0101', skills:'logistics'},
    {id:'p2', org:'crman', name:'J Rivera', role:'Cook', phone:'555-0102', skills:'kitchen'},
  ]
  state.inventory = [
    {id:'i1', org:'crman', name:'Rice', qty:200, unit:'lb', category:'Food', location:'Warehouse', public:true, low:50},
    {id:'i2', org:'crman', name:'Blankets', qty:40, unit:'ea', category:'Shelter', location:'Unit A', public:true, low:20},
    {id:'i3', org:'crman', name:'Water jugs', qty:80, unit:'ea', category:'Water', location:'Unit B', public:false, low:30},
  ]
  state.needs = [
    {id:'n1', org:'crman', title:'Propane for camp stoves', status:'open', notes:'2 tanks', created:now},
    {id:'n2', org:'crman', title:'Diapers size 4', status:'open', notes:'Urgent', created:now},
  ]
  state.meetings = [
    {id:'m1', org:'crman', title:'Kitchen crew planning', notes:'Bring menus.', created:now, files:[]},
  ]
  state.pledges = []
  state.requests = []
  state.newsletters = []
  save(state)
}

export function csv(rows){
  if(!rows || !rows.length) return ''
  const headers = Object.keys(rows[0])
  const esc = v => (v==null?'':String(v).replaceAll('"','""'))
  const body = rows.map(r=>headers.map(h=>`"${esc(r[h])}"`).join(',')).join('\n')
  return [headers.join(','), body].join('\n')
}

export function download(filename, text){
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], {type:'text/plain'}))
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

export async function fileToDataUrl(file){
  return new Promise((res, rej)=>{
    const fr = new FileReader()
    fr.onload = () => res(fr.result)
    fr.onerror = rej
    fr.readAsDataURL(file)
  })
}
