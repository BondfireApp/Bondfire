import { readPublicDriveShare } from '../_lib/publicDriveShares.js';

export async function onRequestGet({ env, params }) {
  const token = String(params.token || '');
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow', 'referrer-policy': 'no-referrer' };
  const ciphertext = /^[a-f0-9]{64}$/.test(token) ? await readPublicDriveShare(env, token) : null;
  return new Response(ciphertext || JSON.stringify({ error: 'This link is unavailable or sharing has stopped.' }), { status: ciphertext ? 200 : 404, headers });
}
