import { readEmergencyStatus } from '../_lib/emergency.js';

export async function onRequestGet(ctx) {
  const res = await readEmergencyStatus({
    env: ctx.env,
    request: ctx.request,
  });

  if (!res.ok) return res.resp;

  return new Response(JSON.stringify(res.status), {
    headers: { 'Content-Type': 'application/json' }
  });
}
