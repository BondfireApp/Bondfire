export async function searchPixabayImages(query) {
  const url = new URL("/api/pixabay/search", window.location.origin);
  url.searchParams.set("q", query || "community");
  const res = await fetch(url.toString(), {
    credentials: "same-origin",
  });
  if (!res.ok) {
    let message = `Pixabay request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data?.error) message = String(data.error);
    } catch {}
    throw new Error(message);
  }
  const data = await res.json();
  return Array.isArray(data?.results) ? data.results : [];
}
