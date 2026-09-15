// src/hooks/useCollection.js
import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * useCollection("/api/inventory")
 * - loads once on mount
 * - addItem(body) posts and optimistically inserts into state
 * - reload() refetches from server
 */
export default function useCollection(endpoint, { map = (x) => x } = {}) {
  const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");
  const url = useMemo(() => {
    const clean = endpoint.replace(/\/+$/, "");
    if (/^https?:\/\//i.test(clean)) return clean;
    if (!API_BASE) return clean;
    return `${API_BASE}${clean.startsWith("/") ? "" : "/"}${clean}`;
  }, [endpoint, API_BASE]);

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await fetch(url, { credentials: "include" });
      if (!r.ok) throw new Error(`GET ${url} -> ${r.status}`);
      const data = await r.json();
      const arr = Array.isArray(data) ? data : (data.items || []);
      setItems(arr.map(map));
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [url, map]);

  useEffect(() => { reload(); }, [reload]);

  const addItem = useCallback(async (body) => {
    // optimistic: create temp row
    const tempId = `tmp_${Date.now()}`;
    const optimistic = { id: body.id ?? tempId, ...body };
    setItems((prev) => [optimistic, ...prev]);

    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`POST ${url} -> ${r.status}`);
      const saved = await r.json().catch(() => null);
      // replace temp with saved (if API returns object/id)
      if (saved && (saved.id || saved._id)) {
        setItems((prev) =>
          prev.map((x) => (x.id === tempId ? { ...optimistic, ...saved } : x))
        );
      } else {
        // fall back: hard reload to be safe
        reload();
      }
      return { ok: true, data: saved };
    } catch (e) {
      // rollback optimistic
      setItems((prev) => prev.filter((x) => x.id !== tempId));
      setError(e?.message || String(e));
      return { ok: false, error: e };
    }
  }, [url, reload]);

  return { items, setItems, loading, error, addItem, reload };
}
