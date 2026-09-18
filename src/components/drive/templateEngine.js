function pad(value) { return String(value).padStart(2, "0"); }
function isoWeek(date) {
  const target = new Date(date.valueOf());
  const dayNr = (date.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setMonth(0, 1);
  if (target.getDay() !== 4) target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
  const week = 1 + Math.ceil((firstThursday - target) / 604800000);
  return String(week).padStart(2, "0");
}
function formatDate(date, fmt) {
  const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return String(fmt || "").replace(/\[W\]WW/g, `W${isoWeek(date)}`).replace(/dddd/g, weekdays[date.getDay()]).replace(/YYYY/g, String(date.getFullYear())).replace(/MM/g, pad(date.getMonth() + 1)).replace(/DD/g, pad(date.getDate())).replace(/HH/g, pad(date.getHours())).replace(/mm/g, pad(date.getMinutes())).replace(/ss/g, pad(date.getSeconds()));
}
export function renderTemplate(raw, context = {}) {
  let out = String(raw || "");
  const now = new Date();
  out = out.replace(/<%\s*tp\.date\.now\(\s*["']([^"']+)["']\s*\)\s*%>/g, (_m, fmt) => formatDate(now, fmt));
  out = out.replace(/<%\s*tp\.date\.now\(\s*\)\s*%>/g, formatDate(now, "YYYY-MM-DD"));
  out = out.replace(/<%\s*tp\.file\.title\s*%>/g, String(context.title || ""));
  out = out.replace(/{{date:([^}]+)}}/g, (_m, fmt) => formatDate(now, fmt));
  out = out.replace(/{{title}}/g, String(context.title || ""));
  return out;
}
export const templateDocs = `supported template tokens

<% tp.date.now("YYYY-MM-DD") %>
<% tp.date.now("HH:mm") %>
<% tp.date.now("dddd") %>
<% tp.date.now("YYYY-[W]WW") %>
<% tp.file.title %>

alternate short syntax

{{date:YYYY-MM-DD}}
{{date:HH:mm}}
{{date:dddd}}
{{title}}

templates can now:
- create a brand new note
- insert into the current note
- be edited in app
- contain full markdown, frontmatter, lists, timestamps, and reusable structures.`;
