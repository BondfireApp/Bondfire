const PROBE = "bondfire-functions-probe-2026-09-20-v1";

export async function onRequestGet({ request }) {
  let hostname = "";
  try {
    hostname = new URL(request.url).hostname;
  } catch {}

  return new Response(JSON.stringify({
    ok: true,
    probe: PROBE,
    hostname,
  }), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
