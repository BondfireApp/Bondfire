import { readEmergencyReports } from '../../../_lib/emergency.js';

export async function onRequestGet(ctx) {
  const { orgId } = ctx.params;

  const res = await readEmergencyReports({
    env: ctx.env,
    request: ctx.request,
    orgId,
    limit: 25,
  });

  if (!res.ok) return res.resp;

  return new Response(JSON.stringify({ reports: res.reports || [] }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
