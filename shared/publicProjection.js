// Publication is an explicit copy of selected public fields. Never spread a
// private record into a public response: later-added notes must stay private.
export const PUBLIC_FIELDS = Object.freeze({
  needs: ['title','description','urgency','priority','status','is_public'],
  meetings: ['title','starts_at','ends_at','location','agenda','is_public'],
  inventory: ['name','qty','unit','category','is_public'],
  events: ['title','description','starts_at','ends_at','location','tags','visibility'],
  witness: ['title','summary','happened_at','tags','visibility'],
  'public/config': ['enabled','newsletter_enabled','pledges_enabled','show_action_strip','show_needs','show_meetings','show_what_we_do','show_get_involved','show_newsletter_card','show_website_button','title','location','about','accent_color','theme_mode','website_link','meeting_rsvp_url','what_we_do','primary_actions','get_involved_links','slug'],
});
export function selectPublicFields(kind, record) {
  const fields=PUBLIC_FIELDS[kind];
  if(!fields)throw new Error('This record has no public publication contract.');
  const selected={};
  for(const field of fields)if(Object.hasOwn(record,field))selected[field]=record[field];
  return selected;
}
export function validPublicFields(kind,record) {
  if(!record||Array.isArray(record)||typeof record!=='object'||!PUBLIC_FIELDS[kind])return false;
  const link=v=>v===null||(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>['label','url'].includes(k))&&typeof v.label==='string'&&typeof v.url==='string');
  for(const [field,value]of Object.entries(record)) {
    if(!PUBLIC_FIELDS[kind].includes(field))return false;
    if(field==='website_link'){if(!link(value))return false;continue;}
    if(['primary_actions','get_involved_links'].includes(field)){if(!Array.isArray(value)||!value.every(link))return false;continue;}
    if(['tags','what_we_do'].includes(field)){if(!Array.isArray(value)||!value.every(v=>typeof v==='string'))return false;continue;}
    if(value!==null&&!['string','number','boolean'].includes(typeof value))return false;
  }
  return true;
}
export function wantsPublication(kind,record) {
  if(kind==='public/config')return record.enabled===true;
  if(['events','witness'].includes(kind))return record.visibility==='public';
  return record.is_public===true||record.is_public===1;
}
