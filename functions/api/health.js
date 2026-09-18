export async function onRequestGet() {
  return Response.json({
    ok: true,
    service: "bondfire-api",
    ts: Date.now(),
  });
}
