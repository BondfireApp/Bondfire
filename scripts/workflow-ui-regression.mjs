// DOM interaction test with real WebCrypto, IndexedDB and API handlers.
// Requires happy-dom and fake-indexeddb, or absolute module paths in the environment.
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '');
const {Window}=await import(process.env.HAPPY_DOM_MODULE || 'happy-dom');
const idb=await import(process.env.FAKE_INDEXEDDB_MODULE || 'fake-indexeddb');
const win=new Window({url:'http://localhost:5174/#/org/qa/tasks'});
for(const name of ['window','document','navigator','HTMLElement','HTMLInputElement','HTMLTextAreaElement','Event','MouseEvent','CustomEvent','localStorage','sessionStorage'])Object.defineProperty(globalThis,name,{value:name==='window'?win:win[name],configurable:true});
globalThis.indexedDB=idb.indexedDB;globalThis.IDBKeyRange=idb.IDBKeyRange;
Object.defineProperty(globalThis,'crypto',{value:webcrypto,configurable:true});
const {createServer}=await import(root+'/node_modules/vite/dist/node/index.js');
const vite=await createServer({root,configFile:false,plugins:[{name:'qa-env',enforce:'pre',transform(code){return code.replaceAll('import.meta?.env?.','import.meta.env.')}}],define:{'import.meta.env.VITE_API_BASE':'""','import.meta.env.VITE_API_BASE_URL':'""'},server:{middlewareMode:true},appType:'custom'});
const React=await import(root+'/node_modules/react/index.js');
const {createRoot}=await import(root+'/node_modules/react-dom/client.js');
const {HashRouter,Routes,Route}=await import(root+'/node_modules/react-router-dom/dist/index.mjs');
const {default:WorkPage}=await vite.ssrLoadModule('/src/modules/work/WorkPage.jsx');
const {workEndpoint,ensureWorkSchema,publicTreasury}=await import(root+'/functions/api/_lib/workStore.js');
const {signJwt}=await import(root+'/functions/api/_lib/jwt.js');
const {registerDeviceKey}=await import(root+'/functions/api/_lib/deviceKeys.js');
const sql=new DatabaseSync(':memory:');
const db={prepare(q){const s=sql.prepare(q);let v=[];return{bind(...a){v=a;return this},async first(){return s.get(...v)||null},async all(){return{results:s.all(...v)}},async run(){return{meta:s.run(...v)}}}},async batch(ss){sql.exec('BEGIN');try{const r=[];for(const s of ss)r.push(await s.run());sql.exec('COMMIT');return r}catch(e){sql.exec('ROLLBACK');throw e}}};
sql.exec("CREATE TABLE users(id TEXT PRIMARY KEY);INSERT INTO users VALUES('owner');CREATE TABLE org_memberships(org_id TEXT,user_id TEXT,role TEXT,created_at INTEGER,PRIMARY KEY(org_id,user_id));INSERT INTO org_memberships VALUES('qa','owner','owner',0);");
const kv=new Map([['slug:qa','qa'],['org:qa',JSON.stringify({enabled:true,slug:'qa'})]]);const env={BF_DB:db,JWT_SECRET:'test',BF_PUBLIC:{get:async k=>kv.get(k)||null}};
await ensureWorkSchema(db);sql.prepare('INSERT INTO org_private_mode VALUES(?,?,0,0,?)').run('qa','enabled','');
sql.exec('CREATE TABLE org_module_configs(org_id TEXT PRIMARY KEY,enabled_modules_json TEXT,version INTEGER,module_schema_version INTEGER,updated_at INTEGER,updated_by TEXT)');
const enabled=['public-site','tasks','working-groups','decisions','cases','treasury'];sql.prepare('INSERT INTO org_module_configs VALUES(?,?,1,2,0,NULL)').run('qa',JSON.stringify(enabled));
const token=await signJwt(env.JWT_SECRET,{sub:'owner'},3600);let wrapped;const errors=[];
globalThis.fetch=async(path,opts={})=>{const url=new URL(path,win.location.origin),p=url.pathname;let data={};
try{
if(p.includes('/work/')){const resp=await workEndpoint({env,orgId:'qa',path:p.split('/work/')[1],request:new Request(url,{...opts,headers:{...Object.fromEntries(new Headers(opts.headers)),authorization:'Bearer '+token}})});if(resp.status>=400)errors.push(await resp.clone().text());return resp}
if(p.endsWith('/privacy/keys'))data={epoch:0,keys:[]};else if(p.endsWith('/privacy'))data={state:'enabled',role:'owner',userId:'owner'};else if(p.endsWith('/crypto'))data={wrapped_key:wrapped};else if(p.endsWith('/modules'))data={enabled_modules:enabled};else if(p.endsWith('/members'))data={members:[{userId:'owner',is_self:true,role:'owner'}]};else if(p.endsWith('/public/get'))data={public:{slug:'qa'}};return Response.json(data);
}catch(e){errors.push(e.stack);throw e}};
const zk=await vite.ssrLoadModule('/src/lib/zk.js');const pair=await zk.ensureDeviceKeypair({register:false});wrapped=await zk.wrapForMember(zk.randomOrgKey(),pair.pubJwk);await registerDeviceKey(db,'owner',pair.pubJwk);
const el=React.createElement,container=document.createElement('div');document.body.append(container);const app=createRoot(container);
app.render(el(HashRouter,null,el(Routes,null,...['tasks','working-groups','decisions','cases','treasury'].map(page=>el(Route,{key:page,path:'/org/:orgId/'+page,element:el(WorkPage,{page})})))));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(fn,label){for(let i=0;i<200;i++){const result=fn();if(result)return result;await sleep(15)}throw new Error('Timed out '+label+'\n'+document.body.textContent.slice(-5000)+'\n'+errors.join('\n'))}
const button=name=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===name);
async function click(name){const b=await wait(()=>button(name)&&!button(name).disabled&&button(name),name);const before=win.location.href;b.click();if(win.location.href!==before)win.dispatchEvent(new win.PopStateEvent('popstate'));await sleep(30)}
function input(label,value){const l=[...document.querySelectorAll('label')].find(l=>l.querySelector('span')?.textContent===label||l.textContent.trim().startsWith(label));assert(l,'label '+label);const i=l.querySelector('input,textarea,select');assert(i,'input '+label);const setter=Object.getOwnPropertyDescriptor(i.tagName==='TEXTAREA'?win.HTMLTextAreaElement.prototype:i.tagName==='SELECT'?win.HTMLSelectElement.prototype:win.HTMLInputElement.prototype,'value').set;setter.call(i,value);i.dispatchEvent(new win.Event(i.tagName==='SELECT'?'change':'input',{bubbles:true}));}
async function submit(){const form=document.querySelector('form.work-editor');assert(form);form.dispatchEvent(new win.Event('submit',{bubbles:true,cancelable:true}));await sleep(30)}
async function navigate(path){win.location.hash='#/org/qa/'+path;win.dispatchEvent(new win.PopStateEvent('popstate'));await sleep(50)}
try{
 await click('New task');input('Title','A real encrypted task');input('Description / context','Details');await submit();await wait(()=>document.querySelector('.work-detail h2')?.textContent==='A real encrypted task','created task');console.log('Task creation passed');
 await click('Edit details');input('Title','Updated task');await submit();await wait(()=>document.querySelector('.work-detail h2')?.textContent==='Updated task','edit task');console.log('Task editing passed');
 await navigate('working-groups');await click('New Working Group');input('Name','Organizing');await submit();await wait(()=>document.querySelector('.work-detail h2')?.textContent==='Organizing','group');console.log('Group creation passed');
 await click('Create Task');await wait(()=>document.querySelector('form.work-editor'),'related task form');input('Title','Group task');await submit();await wait(()=>document.querySelector('.work-detail h2')?.textContent==='Group task','group task');console.log('Group to task passed');
 await navigate('decisions');await click('New decision');input('Title','Assembly');input('Proposal / question','Meet');await submit();await wait(()=>document.querySelector('.work-detail h2')?.textContent==='Assembly','decision');console.log('Decision creation passed');
 await navigate('cases');await click('New case');input('Title','Organizing request');input('Case type','Custom');await submit();await wait(()=>document.querySelector('.work-detail h2')?.textContent==='Organizing request','case');console.log('Case creation passed');
 await navigate('treasury?type=funds');await click('New fund');input('Name','User chosen fund');input('Starting balance','100');await submit();await wait(()=>document.querySelector('.work-detail h2')?.textContent==='User chosen fund','fund');console.log('Fund creation passed');
 await click('Transactions');await click('New transaction');input('Title','Printing');input('Amount','12.34');const fundId=sql.prepare("SELECT id FROM org_work_access WHERE type='funds'").get().id;
 const fundLabel=[...document.querySelectorAll('form.work-editor label')].find(l=>l.querySelector('span')?.textContent==='Fund');const sel=fundLabel.querySelector('select');sel.value=fundId;sel.dispatchEvent(new win.Event('change',{bubbles:true}));await submit();await wait(()=>document.querySelector('.work-detail h2')?.textContent==='Printing','transaction');console.log('Transaction creation passed');
 await click('Funds');await wait(()=>document.body.textContent.includes('$87.66'),'financial balance');console.log('Financial balance passed');
 await click('Public transparency');await wait(()=>document.body.textContent.includes('Off. No Treasury'),'publication settings');
 const checks=[...document.querySelectorAll('label')];for(const name of ['Publish fund name','Balance']){const l=checks.find(l=>l.textContent.trim()===name);assert(l,name);l.querySelector('input').click()}await sleep(20);
 await click('Preview selected information');await click('Publish this preview');await wait(()=>document.body.textContent.includes('Open public transparency page'),'published snapshot');
 const publicResponse=await publicTreasury({env,request:new Request('https://example.test/api/p/qa/treasury'),slug:'qa'});const published=await publicResponse.json();assert.equal(published.public.funds[0].balance,8766);assert.equal(published.public.transactions.length,0);console.log('Explicit field-selected public snapshot passed');
 assert.deepEqual(errors,[]);console.log('DOM/WebCrypto/API integration passed for all five modules.');
}catch(e){console.error(e);process.exitCode=1}finally{app.unmount();await vite.close();win.happyDOM.abort();}
