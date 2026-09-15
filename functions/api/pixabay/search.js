export async function onRequestGet(context) {
  const { request, env } = context;
  const apiKey = env.PIXABAY_API_KEY || env.VITE_PIXABAY_API_KEY;
  if (!apiKey) {
    return json({ error: "Missing PIXABAY_API_KEY on server" }, 500);
  }

  const incoming = new URL(request.url);
  const query = incoming.searchParams.get("q") || "community";

  const url = new URL("https://pixabay.com/api/");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("q", query);
  url.searchParams.set("image_type", "photo");
  url.searchParams.set("safesearch", "true");
  url.searchParams.set("per_page", "24");

  const response = await fetch(url.toString(), {
    headers: { "Accept": "application/json" },
  });

  if (!response.ok) {
    return json({ error: `Pixabay request failed (${response.status})` }, response.status);
  }

  const data = await response.json();
  const results = Array.isArray(data?.hits)
    ? data.hits.map((item) => ({
        id: String(item.id),
        name: item.tags || `Pixabay ${item.id}`,
        previewUrl: item.webformatURL || item.previewURL,
        fullUrl: item.largeImageURL || item.webformatURL || item.previewURL,
        width: item.imageWidth || 1600,
        height: item.imageHeight || 900,
        tags: item.tags || "",
      }))
    : [];

  return json({ results });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
