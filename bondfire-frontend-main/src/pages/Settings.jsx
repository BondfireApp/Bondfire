import { api } from '../utils/api.js';
// src/pages/Settings.jsx
import * as React from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { decryptWithOrgKey, getCachedOrgKey } from "../lib/zk.js";
import Security from "./Security.jsx";
import { isDemoMode } from "../demo/demoMode.js";
import { demoHandle, getDemoSubscribersCsv, ensureDemoOrgList } from "../demo/demoStore.js";
import { AdminPublicConfigCard } from "../components/AdminPublicConfigCard.jsx";
import { PublicDomainCard } from "../components/PublicDomainCard.jsx";
import BuildModules from "../components/BuildModules.jsx";

/* ---------- API helper ---------- */
const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");

function getToken() {
  // Back-compat: older builds stored a JWT in storage.
  // Newer cookie-session builds won\'t have this, and that\'s OK.
  return localStorage.getItem("bf_auth_token") || sessionStorage.getItem("bf_auth_token") || "";
}


function humanizeError(msg) {
  const s = String(msg || "").trim();
  if (!s) return "";
  if (s === "NOT_A_MEMBER") return "You must be a member of this org to do that.";
  if (s === "INSUFFICIENT_ROLE") return "You do not have permission for that action.";
  return s;
}


async function authFetch(path, opts = {}) {
  return api(path, { ...opts, body: opts.body === undefined ? undefined : typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body) });
}

/* ---------- local org settings helpers ---------- */
const orgSettingsKey = (orgId) => `bf_org_settings_${orgId}`;

const readJSON = (k, fallback = {}) => {
  try {
    return JSON.parse(localStorage.getItem(k) || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
};

const writeJSON = (k, v) => localStorage.setItem(k, JSON.stringify(v));

function safeMailto(s) {
  return encodeURIComponent(String(s || ""));
}


export default function Settings({ privateMode = false }) {
  const { orgId } = useParams();

  /* ---------- Submenu tabs ---------- */
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = String(searchParams.get("tab") || "org").toLowerCase();

  const setTab = (next) => {
    const n = String(next || "org").toLowerCase();
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.set("tab", n);
        return p;
      },
      { replace: true }
    );
  };

  const tabs = React.useMemo(
    () => [
      ["org", "Organization"],
      ["build", "Build"],
      ["invites", "Invites"],
      ["members", "Members"],
      ["public", "Public page"],
      ["public-inbox", "Public inbox"],
      ["newsletter", "Newsletter"],
      ["pledges", "Pledges"],
      ["security", "Security"],
    ].filter(([key]) => !privateMode || ["security","members","invites","pledges","public","public-inbox","newsletter"].includes(key)),
    [privateMode]
  );

  /* ========== INVITES (backend) ========== */
  const [invites, setInvites] = React.useState([]);
  const [inviteMsg, setInviteMsg] = React.useState("");
  const [inviteBusy, setInviteBusy] = React.useState(false);

  const loadInvites = React.useCallback(async () => {
    if (!orgId) return;
    try {
      const r = await authFetch(`/api/orgs/${encodeURIComponent(orgId)}/invites`, {
        method: "GET",
      });
      setInvites(Array.isArray(r.invites) ? r.invites : []);
      setInviteMsg("");
    } catch (e) {
      setInviteMsg(e.message || "Failed to load invites");
    }
  }, [orgId]);

  const createInvite = async () => {
    if (!orgId) return;
    setInviteBusy(true);
    setInviteMsg("");
    try {
      const r = await authFetch(`/api/orgs/${encodeURIComponent(orgId)}/invites`, {
        method: "POST",
        body: { role: "member", expiresInDays: 14, maxUses: 1 },
      });

      if (r?.invite) {
        setInvites((prev) => [r.invite, ...prev]);
        setInviteMsg(`Invite created: ${r.invite.code}`);
      } else {
        await loadInvites();
        setInviteMsg("Invite created.");
      }
    } catch (e) {
      setInviteMsg(e.message || "Failed to create invite");
    } finally {
      setInviteBusy(false);
    }
  };

  const copyInvite = async (code) => {
    try {
      await navigator.clipboard.writeText(code);
      setInviteMsg("Copied.");
      setTimeout(() => setInviteMsg(""), 900);
    } catch {
      setInviteMsg("Clipboard blocked. Copy it manually.");
    }
  };

  const deleteInvite = async (code) => {
    if (!orgId) return;
    const c = String(code || "").trim().toUpperCase();
    if (!c) return;

    const ok = confirm(`Delete invite ${c}?`);
    if (!ok) return;

    setInviteBusy(true);
    setInviteMsg("");
    try {
      await authFetch(`/api/orgs/${encodeURIComponent(orgId)}/invites`, {
        method: "DELETE",
        body: { code: c },
      });
      setInvites((prev) =>
        prev.filter((x) => String(x.code || "").toUpperCase() !== c)
      );
      setInviteMsg("Deleted.");
      setTimeout(() => setInviteMsg(""), 900);
    } catch (e) {
      setInviteMsg(e.message || "Failed to delete invite");
    } finally {
      setInviteBusy(false);
    }
  };

  const deleteInactiveInvites = async () => {
    if (!orgId) return;

    const now = Date.now();
    const inactive = (invites || []).filter((inv) => {
      const uses = Number(inv.uses || 0);
      const max = Number(inv.max_uses || 0);
      const exp = inv.expires_at ? Number(inv.expires_at) : null;
      const exhausted = max > 0 && uses >= max;
      const expired = exp && now > exp;
      return exhausted || expired;
    });

    if (inactive.length === 0) {
      setInviteMsg("No used or expired invites to delete.");
      setTimeout(() => setInviteMsg(""), 900);
      return;
    }

    const ok = confirm(`Delete ${inactive.length} used or expired invites?`);
    if (!ok) return;

    setInviteBusy(true);
    setInviteMsg("");
    try {
      for (const inv of inactive) {
        const c = String(inv.code || "").trim().toUpperCase();
        if (!c) continue;
        await authFetch(`/api/orgs/${encodeURIComponent(orgId)}/invites`, {
          method: "DELETE",
          body: { code: c },
        });
      }
      await loadInvites();
      setInviteMsg("Deleted used and expired invites.");
      setTimeout(() => setInviteMsg(""), 1200);
    } catch (e) {
      setInviteMsg(e.message || "Cleanup failed");
    } finally {
      setInviteBusy(false);
    }
  };

  /* ========== MEMBERS + ROLES (backend, admin only) ========== */
  const [members, setMembers] = React.useState([]);
  const [membersMsg, setMembersMsg] = React.useState("");
  const [membersAllowed, setMembersAllowed] = React.useState(false);
  const [membersBusy, setMembersBusy] = React.useState(false);

  const loadMembers = React.useCallback(async () => {
    if (!orgId) return;
    setMembersMsg("");
    try {
      // Members is an authenticated admin surface, so show plaintext when it exists.
      // If a row is encrypted-only, we still attempt local decrypt via tryDecryptList().
      const r = await authFetch(`/api/orgs/${encodeURIComponent(orgId)}/members?plaintext=1`, {
        method: "GET",
      });
      const _mem = Array.isArray(r.members) ? r.members : [];
      setMembers(await tryDecryptList(orgId, _mem));
      setMembersAllowed(true);
    } catch (e) {
      const msg = String(e?.message || "");
      if (msg.includes("INSUFFICIENT_ROLE") || msg.includes("NOT_A_MEMBER")) {
        setMembersAllowed(false);
        setMembers([]);
        setMembersMsg("");
      } else {
        setMembersAllowed(false);
        setMembers([]);
        setMembersMsg(msg || "Failed to load members");
      }
    }
  }, [orgId]);

  const setMemberRole = async (userId, nextRole, currentRole, email) => {
    if (!orgId) return;
    if (!userId) return;
    if (nextRole === currentRole) return;

    if (currentRole === "owner" && nextRole !== "owner") {
      const ok = confirm(`Demote owner ${email || userId} to ${nextRole}?`);
      if (!ok) return;
    }
    if (nextRole === "owner") {
      const ok = confirm(`Promote ${email || userId} to owner?`);
      if (!ok) return;
    }

    setMembersBusy(true);
    setMembersMsg("");
    try {
      await authFetch(`/api/orgs/${encodeURIComponent(orgId)}/members`, {
        method: "PUT",
        body: { userId, role: nextRole },
      });
      setMembersMsg("Updated.");
      setTimeout(() => setMembersMsg(""), 900);
      await loadMembers();
    } catch (e) {
      setMembersMsg(e.message || "Failed to update role");
    } finally {
      setMembersBusy(false);
    }
  };

  const removeMember = async (userId, email) => {
    if (!orgId) return;
    if (!userId) return;

    const ok = confirm(`Remove ${email || userId} from this org?`);
    if (!ok) return;

    setMembersBusy(true);
    setMembersMsg("");
    try {
      await authFetch(`/api/orgs/${encodeURIComponent(orgId)}/members`, {
        method: "DELETE",
        body: { userId },
      });
      setMembersMsg("Removed.");
      setTimeout(() => setMembersMsg(""), 900);
      await loadMembers();
    } catch (e) {
      setMembersMsg(e.message || "Failed to remove member");
    } finally {
      setMembersBusy(false);
    }
  };

  React.useEffect(() => {
    loadInvites();
    loadMembers();
  }, [loadInvites, loadMembers]);

  /* ========== ORG BASICS (local) ========== */
  const [orgName, setOrgName] = React.useState("");
  const [logoDataUrl, setLogoDataUrl] = React.useState(null);

  React.useEffect(() => {
    const s = readJSON(orgSettingsKey(orgId));
    if (s.name) setOrgName(s.name);
    if (s.logoDataUrl || s.logoUrl) setLogoDataUrl(s.logoDataUrl || s.logoUrl);
  }, [orgId]);

  const onLogo = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setLogoDataUrl(reader.result);
    reader.readAsDataURL(file);
  };

  const saveBasics = () => {
    const key = orgSettingsKey(orgId);
    const prev = readJSON(key);
    writeJSON(key, { ...prev, name: (orgName || "").trim(), logoDataUrl });
    window.dispatchEvent(
      new CustomEvent("bf:org_settings_changed", { detail: { orgId } })
    );
    alert("Organization settings saved.");
  };

  /* ========== PUBLIC PAGE (backend) ========== */
  const [enabled, setEnabled] = React.useState(false);
  const [publicNewsletterEnabled, setPublicNewsletterEnabled] = React.useState(false);
  const [publicPledgesEnabled, setPublicPledgesEnabled] = React.useState(false);
  const [showActionStrip, setShowActionStrip] = React.useState(true);
  const [showNeeds, setShowNeeds] = React.useState(true);
  const [showMeetings, setShowMeetings] = React.useState(true);
  const [showWhatWeDo, setShowWhatWeDo] = React.useState(true);
  const [showGetInvolved, setShowGetInvolved] = React.useState(false);
  const [showNewsletterCard, setShowNewsletterCard] = React.useState(false);
  const [showWebsiteButton, setShowWebsiteButton] = React.useState(false);
  const [slug, setSlug] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [locationLine, setLocationLine] = React.useState("");
  const [about, setAbout] = React.useState("");
  const [accentColor, setAccentColor] = React.useState("#6d5efc");
  const [themeMode, setThemeMode] = React.useState("light");
  const [websiteLabel, setWebsiteLabel] = React.useState("Website");
  const [websiteUrl, setWebsiteUrl] = React.useState("");
  const [meetingRsvpUrl, setMeetingRsvpUrl] = React.useState("");
  const [whatWeDo, setWhatWeDo] = React.useState("");
  const [primaryActionItems, setPrimaryActionItems] = React.useState([]);
  const [getInvolvedActionItems, setGetInvolvedActionItems] = React.useState([]);
  const [msg, setMsg] = React.useState("");
  const [publicInboxItems, setPublicInboxItems] = React.useState([]);
  const [publicInboxBusy, setPublicInboxBusy] = React.useState(false);
  const [publicInboxMsg, setPublicInboxMsg] = React.useState("");
  const [publicInboxFilter, setPublicInboxFilter] = React.useState("all");

  const actionTypeOptions = React.useMemo(() => ([
    { value: "none", label: "Hide this button" },
    { value: "modal:get_help", label: "Open Get Help form" },
    { value: "modal:volunteer", label: "Open Volunteer form" },
    { value: "modal:offer_resources", label: "Open Offer Resources form" },
    { value: "#newsletter", label: "Jump to newsletter signup" },
    { value: "external", label: "Open a custom link" },
  ]), []);

  const primaryActionDefaults = React.useMemo(() => ([
    { label: "Get Help", kind: "modal:get_help", url: "" },
    { label: "Offer Help", kind: "modal:offer_resources", url: "" },
    { label: "Stay Connected", kind: "#newsletter", url: "" },
  ]), []);

  const getInvolvedDefaults = React.useMemo(() => ([
    { label: "Volunteer", kind: "modal:volunteer", url: "" },
    { label: "Donate Funds", kind: "external", url: "" },
    { label: "Offer Resources", kind: "modal:offer_resources", url: "" },
    { label: "Request Assistance", kind: "modal:get_help", url: "" },
  ]), []);

  const toActionEditorItems = React.useCallback((items, defaults = []) => {
    const src = Array.isArray(items) ? items : [];
    const base = (Array.isArray(defaults) ? defaults : []).map((item) => ({ ...item }));
    return base.map((fallback, index) => {
      const raw = src[index] || {};
      const rawLabel = String(raw?.label || raw?.text || fallback?.label || "").trim();
      const rawUrl = String(raw?.url || "").trim();
      const lowered = rawUrl.toLowerCase();
      let kind = fallback?.kind || "none";
      let url = rawUrl;
      if (!rawUrl) {
        kind = fallback?.kind || "none";
        url = fallback?.kind === "external" ? String(fallback?.url || "") : "";
      } else if (lowered === "newsletter" || lowered === "#newsletter") {
        kind = "#newsletter";
        url = "";
      } else if (lowered in {"modal:get_help":1, "modal:volunteer":1, "modal:offer_resources":1}) {
        kind = lowered;
        url = "";
      } else {
        kind = "external";
      }
      return {
        label: rawLabel || fallback?.label || "",
        kind,
        url: kind === "external" ? url : "",
      };
    });
  }, []);

  const fromActionEditorItems = React.useCallback((items, limit = 4) => {
    return (Array.isArray(items) ? items : [])
      .slice(0, limit)
      .map((item) => {
        const label = String(item?.label || "").trim();
        const kind = String(item?.kind || "none").trim();
        const customUrl = String(item?.url || "").trim();
        if (!label || kind === "none") return null;
        if (kind === "external") {
          if (!customUrl) return null;
          return { label, url: customUrl };
        }
        return { label, url: kind === "#newsletter" ? "#newsletter" : kind };
      })
      .filter(Boolean);
  }, []);

  const updateActionItem = React.useCallback((setter, index, patch) => {
    setter((prev) => (Array.isArray(prev) ? prev : []).map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }, []);

  const toggleActionItemEnabled = React.useCallback((setter, items, defaults, index, enabled) => {
    const current = (Array.isArray(items) ? items : [])[index] || {};
    const fallback = (Array.isArray(defaults) ? defaults : [])[index] || {};
    if (!enabled) {
      updateActionItem(setter, index, {
        _savedKind: current.kind && current.kind !== "none" ? current.kind : (current._savedKind || fallback.kind || "external"),
        _savedUrl: typeof current.url === "string" ? current.url : (current._savedUrl || fallback.url || ""),
        kind: "none",
      });
      return;
    }
    const restoredKind = current._savedKind || fallback.kind || "external";
    const restoredUrl = restoredKind === "external"
      ? (current.url || current._savedUrl || fallback.url || "")
      : "";
    updateActionItem(setter, index, {
      kind: restoredKind,
      url: restoredUrl,
    });
  }, [updateActionItem]);

  const parseLinkLines = React.useCallback((value) => {
    return String(value || "")
      .split("\n")
      .map((line) => {
        const [label, url] = line.split("|").map((s) => (s || "").trim());
        return url ? { label: label || url, url } : null;
      })
      .filter(Boolean);
  }, []);

  const formatLinkLines = React.useCallback((items) => {
    return Array.isArray(items)
      ? items.map((item) => `${item?.label || item?.text || item?.url || ""} | ${item?.url || ""}`.trim()).filter(Boolean).join("\n")
      : "";
  }, []);

  const genSlug = async () => {
    setMsg("");
    try {
      const r = await authFetch(
        `/api/orgs/${encodeURIComponent(orgId)}/public/generate`,
        { method: "POST" }
      );
      setSlug(r.public?.slug || "");
      setMsg("Generated new link.");
      setTimeout(() => setMsg(""), 1200);
    } catch (e) {
      setMsg(e.message);
    }
  };

const loadPublic = React.useCallback(async () => {
  if (!orgId) return;
  setMsg("");
  try {
    const r = await authFetch(`/api/orgs/${encodeURIComponent(orgId)}/public/get`, {
      method: "GET",
    });

    const pub = r.public || {};
    setEnabled(!!pub.enabled);
    setPublicNewsletterEnabled(!!pub.newsletter_enabled);
    setPublicPledgesEnabled(pub.pledges_enabled !== false);
    setShowActionStrip(pub.show_action_strip !== false);
    setShowNeeds(pub.show_needs !== false);
    setShowMeetings(pub.show_meetings !== false);
    setShowWhatWeDo(pub.show_what_we_do !== false);
    setShowGetInvolved(!!pub.show_get_involved);
    setShowNewsletterCard(!!pub.show_newsletter_card);
    setShowWebsiteButton(!!pub.show_website_button);
    setSlug(String(pub.slug || ""));
    setTitle(String(pub.title || ""));
    setLocationLine(String(pub.location || ""));
    setAbout(String(pub.about || ""));
    setAccentColor(String(pub.accent_color || "#6d5efc"));
    setThemeMode(String(pub.theme_mode || "light"));
    setWebsiteLabel(String(pub.website_link?.label || pub.website_link?.text || "Website"));
    setWebsiteUrl(String(pub.website_link?.url || ""));
    setMeetingRsvpUrl(String(pub.meeting_rsvp_url || ""));
    setWhatWeDo(Array.isArray(pub.what_we_do) ? pub.what_we_do.join("\n") : Array.isArray(pub.features) ? pub.features.join("\n") : "");
    setPrimaryActionItems(toActionEditorItems(pub.primary_actions, primaryActionDefaults));
    setGetInvolvedActionItems(toActionEditorItems(pub.get_involved_links, getInvolvedDefaults));
  } catch (e) {
    setMsg(e.message || "Failed to load public settings");
  }
}, [orgId, primaryActionDefaults, getInvolvedDefaults, toActionEditorItems]);

  const loadPublicInbox = React.useCallback(async () => {
    if (!orgId) return;
    setPublicInboxBusy(true);
    setPublicInboxMsg("");
    try {
      const r = await authFetch(`/api/orgs/${encodeURIComponent(orgId)}/public/inbox`, { method: "GET" });
      setPublicInboxItems(Array.isArray(r.items) ? r.items : []);
    } catch (e) {
      setPublicInboxMsg(e.message || "Failed to load public inbox");
    } finally {
      setPublicInboxBusy(false);
    }
  }, [orgId]);

  const savePublicInboxItem = async (item, review_status, admin_note) => {
    if (!orgId || !item?.id) return;
    setPublicInboxBusy(true);
    setPublicInboxMsg("");
    try {
      const r = await authFetch(`/api/orgs/${encodeURIComponent(orgId)}/public/inbox`, {
        method: "PUT",
        body: {
          id: item.id,
          type: item.type,
          review_status,
          admin_note,
        },
      });
      setPublicInboxItems(Array.isArray(r.items) ? r.items : []);
      setPublicInboxMsg("Saved.");
      setTimeout(() => setPublicInboxMsg(""), 1200);
    } catch (e) {
      setPublicInboxMsg(e.message || "Failed to save public inbox item");
    } finally {
      setPublicInboxBusy(false);
    }
  };

React.useEffect(() => {
  if (tab === "public") {
    loadPublic();
  }
  if (tab === "public-inbox") {
    loadPublicInbox();
  }
}, [tab, loadPublic, loadPublicInbox]);


React.useEffect(() => {
  if (!primaryActionItems.length) setPrimaryActionItems(primaryActionDefaults);
  if (!getInvolvedActionItems.length) setGetInvolvedActionItems(getInvolvedDefaults);
}, [primaryActionDefaults, getInvolvedDefaults, primaryActionItems.length, getInvolvedActionItems.length]);


  const savePublic = async (e) => {
    e?.preventDefault();
    setMsg("");
    try {
      const payload = {
        enabled,
        newsletter_enabled: !!publicNewsletterEnabled,
        pledges_enabled: !!publicPledgesEnabled,
        show_action_strip: !!showActionStrip,
        show_needs: !!showNeeds,
        show_meetings: !!showMeetings,
        show_what_we_do: !!showWhatWeDo,
        show_get_involved: !!showGetInvolved,
        show_newsletter_card: !!showNewsletterCard,
        show_website_button: !!showWebsiteButton,
        slug: (slug || "").trim(),
        title: (title || "").trim(),
        location: (locationLine || "").trim(),
        about: (about || "").trim(),
        accent_color: (accentColor || "#6d5efc").trim(),
        theme_mode: (themeMode || "light").trim(),
        website_link: websiteUrl ? { label: (websiteLabel || "Website").trim(), url: (websiteUrl || "").trim() } : null,
        meeting_rsvp_url: (meetingRsvpUrl || "").trim(),
        what_we_do: (whatWeDo || "").split("\n").map((s) => s.trim()).filter(Boolean),
        primary_actions: fromActionEditorItems(primaryActionItems, 3),
        get_involved_links: fromActionEditorItems(getInvolvedActionItems, 4),
      };

      const r = await authFetch(
        `/api/orgs/${encodeURIComponent(orgId)}/public/save`,
        { method: "POST", body: payload }
      );

      const pub = r.public || payload;
      setSlug(pub.slug || payload.slug);
      setTitle(pub.title ?? payload.title);
      setLocationLine(pub.location ?? payload.location);
      setAbout(pub.about ?? payload.about);
      setAccentColor(pub.accent_color ?? payload.accent_color);
      setThemeMode(pub.theme_mode ?? payload.theme_mode);
      setWebsiteLabel(pub.website_link?.label || payload.website_link?.label || "Website");
      setWebsiteUrl(pub.website_link?.url || payload.website_link?.url || "");
      setMeetingRsvpUrl(pub.meeting_rsvp_url ?? payload.meeting_rsvp_url);
      setWhatWeDo(Array.isArray(pub.what_we_do) ? pub.what_we_do.join("\n") : whatWeDo);
      setPrimaryActionItems(toActionEditorItems(pub.primary_actions || payload.primary_actions, primaryActionDefaults));
      setGetInvolvedActionItems(toActionEditorItems(pub.get_involved_links || payload.get_involved_links, getInvolvedDefaults));
      setEnabled(!!pub.enabled);
      setPublicNewsletterEnabled(!!pub.newsletter_enabled);
      setPublicPledgesEnabled(pub.pledges_enabled !== false);
      setShowActionStrip(pub.show_action_strip !== false);
      setShowNeeds(pub.show_needs !== false);
      setShowMeetings(pub.show_meetings !== false);
      setShowWhatWeDo(pub.show_what_we_do !== false);
      setShowGetInvolved(!!pub.show_get_involved);
      setShowNewsletterCard(!!pub.show_newsletter_card);
      setShowWebsiteButton(!!pub.show_website_button);
      setMsg("Saved.");
      setTimeout(() => setMsg(""), 1200);
    } catch (e) {
      setMsg(e.message);
    }
  };

  const publicUrl = slug ? `${location.origin}/#/p/${slug}` : "";

  const filteredPublicInboxItems = React.useMemo(() => {
    if (publicInboxFilter === "all") return publicInboxItems;
    if (publicInboxFilter === "intake") return publicInboxItems.filter((item) => item.type === "intake");
    if (publicInboxFilter === "rsvp") return publicInboxItems.filter((item) => item.type === "rsvp");
    return publicInboxItems.filter((item) => String(item.review_status || "new") === publicInboxFilter);
  }, [publicInboxItems, publicInboxFilter]);

  /* ========== NEWSLETTER (backend, Riseup sends) ========== */
  const [nlEnabled, setNlEnabled] = React.useState(false);
  const [nlListAddress, setNlListAddress] = React.useState("");
  const [nlBlurb, setNlBlurb] = React.useState("");
  const [nlMsg, setNlMsg] = React.useState("");
  const [nlBusy, setNlBusy] = React.useState(false);
  const [subscribers, setSubscribers] = React.useState([]);
  const exportSubscribersCsv = async () => {
    if (!orgId) return;

    setNlMsg("");
    setNlBusy(true);

    try {
      if (isDemoMode() || privateMode) {
        const rows=privateMode?(await authFetch(`/api/orgs/${encodeURIComponent(orgId)}/newsletter/subscribers`)).subscribers:[];
        const quote=value=>'"'+String(value??'').replaceAll('"','""')+'"';
        const csv=privateMode?['name,email',...rows.map(row=>[quote(row.name),quote(row.email)].join(','))].join('\r\n'):getDemoSubscribersCsv();
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `subscribers-${orgId}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        setNlMsg("Exported.");
        setTimeout(() => setNlMsg(""), 1200);
        return;
      }

      const token = getToken();
      const path = `/api/orgs/${encodeURIComponent(orgId)}/newsletter/subscribers?format=csv`;

      const headers = {};
      if (token) headers.Authorization = `Bearer ${token}`;

      // Same origin first (Pages Functions), then API_BASE
      let res = await fetch(path, { method: "GET", headers });
      if (!res.ok && API_BASE) {
        res = await fetch(`${API_BASE}${path}`, { method: "GET", headers });
      }

      if (!res.ok) {
        // backend might return JSON errors sometimes
        const ct = res.headers.get("content-type") || "";
        if (ct.includes("application/json")) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || j.message || `HTTP ${res.status}`);
        }
        const t = await res.text().catch(() => "");
        throw new Error(t || `HTTP ${res.status}`);
      }

      const blob = await res.blob();

      // Try to use server filename if present
      const dispo = res.headers.get("content-disposition") || "";
      const m = dispo.match(/filename="([^"]+)"/i);
      const filename = m?.[1] || `subscribers-${orgId}.csv`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setNlMsg("Exported.");
      setTimeout(() => setNlMsg(""), 1200);
    } catch (e) {
      setNlMsg(e?.message || "Export failed");
    } finally {
      setNlBusy(false);
    }
  };

  const loadNewsletter = React.useCallback(async () => {
    if (!orgId) return;
    setNlMsg("");
    setNlBusy(true);
    try {
      const r = await authFetch(`/api/orgs/${encodeURIComponent(orgId)}/newsletter`, {
        method: "GET",
      });
      const cfg = r?.newsletter || r?.settings || r || {};
      setNlListAddress(String(cfg.list_address || cfg.listAddress || ""));
      setNlBlurb(String(cfg.blurb || ""));
    } catch (e) {
      setNlMsg(e.message || "Failed to load newsletter settings");
    } finally {
      setNlBusy(false);
    }
  }, [orgId]);

  const loadSubscribers = React.useCallback(async () => {
    if (!orgId) return;
    setNlMsg("");
    setNlBusy(true);
    try {
      const r = await authFetch(
        `/api/orgs/${encodeURIComponent(orgId)}/newsletter/subscribers`,
        { method: "GET" }
      );
      const _subs = Array.isArray(r.subscribers) ? r.subscribers : [];
      setSubscribers(await tryDecryptList(orgId, _subs));
    } catch (e) {
      setSubscribers([]);
      setNlMsg(e.message || "Failed to load subscribers");
    } finally {
      setNlBusy(false);
    }
  }, [orgId]);

  const saveNewsletter = async () => {
    if (!orgId) return;
    setNlMsg("");
    setNlBusy(true);
    try {
      await authFetch(`/api/orgs/${encodeURIComponent(orgId)}/newsletter`, {
        method: "PUT", body: {list_address:nlListAddress,blurb:nlBlurb},
      });
      setNlMsg("Saved.");
      setTimeout(() => setNlMsg(""), 1200);
    } catch (e) {
      setNlMsg(e.message || "Failed to save newsletter settings");
    } finally {
      setNlBusy(false);
    }
  };

  React.useEffect(() => {
    if (tab === "newsletter") {
      loadNewsletter();
      loadSubscribers();
    }
  }, [tab, loadNewsletter, loadSubscribers]);

  const csvHref = orgId
    ? `/#/org/${encodeURIComponent(orgId)}/settings?tab=newsletter`
    : "";

  const csvDownloadUrl = orgId
    ? `/api/orgs/${encodeURIComponent(orgId)}/newsletter/subscribers?format=csv`
    : "";

  const openRiseupDraft = () => {
    const to = (nlListAddress || "").trim();
    if (!to) {
      setNlMsg("Set a Riseup list address first.");
      setTimeout(() => setNlMsg(""), 1400);
      return;
    }
    const subject = `${orgName || "Bondfire"} newsletter`;
    const body =
      (nlBlurb ? `${nlBlurb}\n\n` : "") +
      `Hello,\n\n` +
      `Here is the latest update.\n\n` +
      `Needs:\n- \n\n` +
      `Pledges:\n- \n\n` +
      `Thanks,\n${orgName || ""}`;

    const href = `mailto:${safeMailto(to)}?subject=${safeMailto(subject)}&body=${safeMailto(
      body
    )}`;
    window.location.href = href;
  };

  /* ========== PLEDGES (backend) ========== */
  const [pledges, setPledges] = React.useState([]);
  const [pledgesMsg, setPledgesMsg] = React.useState("");
  const [pledgesBusy, setPledgesBusy] = React.useState(false);

  const [needs, setNeeds] = React.useState([]);

  const loadNeedsForPledges = React.useCallback(async () => {
    if (!orgId) return;
    try {
      const r = await authFetch(`/api/orgs/${encodeURIComponent(orgId)}/needs`, {
        method: "GET",
      });
      setNeeds(await tryDecryptList(orgId, Array.isArray(r.needs) ? r.needs : []));
    } catch {
      setNeeds([]);
    }
  }, [orgId]);

  const loadPledges = React.useCallback(async () => {
    if (!orgId) return;
    setPledgesMsg("");
    setPledgesBusy(true);
    try {
      const r = await authFetch(`/api/orgs/${encodeURIComponent(orgId)}/pledges`, {
        method: "GET",
      });
      setPledges(Array.isArray(r.pledges) ? r.pledges : []);
    } catch (e) {
      setPledges([]);
      setPledgesMsg(e.message || "Failed to load pledges");
    } finally {
      setPledgesBusy(false);
    }
  }, [orgId]);

  React.useEffect(() => {
    if (tab === "pledges") {
      loadNeedsForPledges();
      loadPledges();
    }
  }, [tab, loadNeedsForPledges, loadPledges]);

  const upsertPledge = async (id, patch) => {
    if (!orgId) return;
    setPledgesMsg("");
    setPledgesBusy(true);
    try {
      await authFetch(`/api/orgs/${encodeURIComponent(orgId)}/pledges`, {
        method: "PUT",
        body: { id, ...patch },
      });
      await loadPledges();
      setPledgesMsg("Saved.");
      setTimeout(() => setPledgesMsg(""), 900);
    } catch (e) {
      setPledgesMsg(e.message || "Failed to save pledge");
    } finally {
      setPledgesBusy(false);
    }
  };

  const deletePledge = async (id) => {
    if (!orgId) return;
    const ok = confirm("Delete this pledge?");
    if (!ok) return;
    setPledgesMsg("");
    setPledgesBusy(true);
    try {
      await authFetch(`/api/orgs/${encodeURIComponent(orgId)}/pledges`, {
        method: "DELETE",
        body: { id },
      });
      await loadPledges();
      setPledgesMsg("Deleted.");
      setTimeout(() => setPledgesMsg(""), 900);
    } catch (e) {
      setPledgesMsg(e.message || "Failed to delete pledge");
    } finally {
      setPledgesBusy(false);
    }
  };

  const onAddPledge = async (e) => {
    e.preventDefault();
    if (!orgId) return;

    const form = e.currentTarget;
    const f = new FormData(form);

    const payload = {
      pledger_name: String(f.get("pledger_name") || "").trim(),
      pledger_email: String(f.get("pledger_email") || "").trim(),
      type: String(f.get("type") || "").trim(),
      amount: String(f.get("amount") || "").trim(),
      unit: String(f.get("unit") || "").trim(),
      note: String(f.get("note") || "").trim(),
      status: String(f.get("status") || "offered").trim(),
      need_id: String(f.get("need_id") || "").trim() || null,
      is_public: String(f.get("is_public") || "") === "on",
    };

    setPledgesMsg("");
    setPledgesBusy(true);
    try {
      await authFetch(`/api/orgs/${encodeURIComponent(orgId)}/pledges`, {
        method: "POST",
        body: payload,
      });
      form?.reset?.();
      await loadPledges();
      setPledgesMsg("Added.");
      setTimeout(() => setPledgesMsg(""), 900);
    } catch (err) {
      setPledgesMsg(err.message || "Failed to add pledge");
    } finally {
      setPledgesBusy(false);
    }
  };

  const needTitleById = React.useMemo(() => {
    const m = new Map();
    for (const n of needs) m.set(String(n.id), String(n.title || ""));
    return m;
  }, [needs]);

  return (
    <div className="grid" style={{ gap: 16, padding: 16 }}>
      {/* Submenu */}
      <div className="card" style={{ padding: 12 }}>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          {tabs.map(([key, label]) => {
            const active = tab === key;
            return (
              <button
                key={key}
                type="button"
                className={active ? "btn-red" : "btn"}
                onClick={() => setTab(key)}
                style={{ padding: "8px 12px" }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Build */}
      {tab === "build" && <BuildModules />}

      {/* Security */}
      {tab === "security" && (
        <div className="card" style={{ padding: 16 }}>
          <h2 style={{ marginTop: 0 }}>Security</h2>
          <p className="helper">Account security is global, but lives here so you can actually find it.</p>
          <Security />
        </div>
      )}

      {/* Organization */}
      {tab === "org" && (
        <div className="card" style={{ padding: 16 }}>
          <h2 style={{ marginTop: 0 }}>Organization</h2>
          <div className="grid" style={{ gap: 10 }}>
            <label className="grid" style={{ gap: 6 }}>
              <span className="helper">Name</span>
              <input
                className="input"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="Your org name"
              />
            </label>

            <label className="grid" style={{ gap: 6 }}>
              <span className="helper">Logo</span>
              <input className="input" type="file" accept="image/*" onChange={onLogo} />
              {logoDataUrl && (
                <img
                  src={logoDataUrl}
                  alt="Logo preview"
                  style={{
                    width: 96,
                    height: 96,
                    borderRadius: 12,
                    objectFit: "cover",
                    marginTop: 8,
                  }}
                />
              )}
            </label>

            <div>
              <button className="btn-red" onClick={saveBasics}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Invites */}
      {tab === "invites" && (
        <div className="card" style={{ padding: 16 }}>
          <h2 style={{ marginTop: 0 }}>Invites</h2>
          <p className="helper">Generate invite codes so someone can join this org.</p>

          <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button className="btn-red" onClick={createInvite} disabled={inviteBusy}>
              {inviteBusy ? "Generating…" : "Generate invite"}
            </button>
            <button className="btn" type="button" onClick={loadInvites}>
              Refresh
            </button>
            <button className="btn" type="button" onClick={deleteInactiveInvites} disabled={inviteBusy}>
              Delete used and expired
            </button>

            {inviteMsg && (
              <span
                className={
                  inviteMsg.toLowerCase().includes("fail") ||
                  inviteMsg.toLowerCase().includes("http")
                    ? "error"
                    : "helper"
                }
              >
                {inviteMsg}
              </span>
            )}
          </div>

          <div style={{ marginTop: 12 }}>
            {invites.length === 0 ? (
              <div className="helper">No invites yet</div>
            ) : (
              <div className="grid" style={{ gap: 10 }}>
                {invites.map((inv) => (
                  <div key={inv.code} className="card" style={{ padding: 12, border: "1px solid #222" }}>
                    <div className="row" style={{ gap: 8, alignItems: "center" }}>
                      <code style={{ fontSize: 16 }}>{inv.code}</code>
                      <button className="btn" onClick={() => copyInvite(inv.code)}>
                        Copy
                      </button>
                      <button className="btn" type="button" onClick={() => deleteInvite(inv.code)} disabled={inviteBusy}>
                        Delete
                      </button>

                      <div className="helper" style={{ marginLeft: "auto" }}>
                        role: {inv.role || "member"} · uses: {inv.uses || 0}/{inv.max_uses || 1}
                        {inv.expires_at ? ` · expires: ${new Date(inv.expires_at).toLocaleDateString()}` : ""}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Members */}
      {tab === "members" && (
        <div className="card" style={{ padding: 16 }}>
          <h2 style={{ marginTop: 0 }}>Members and Roles</h2>

          {!membersAllowed ? (
            <div className="helper">
              Admins and owners can manage membership roles.
              {membersMsg ? (
                <div className="error" style={{ marginTop: 8 }}>
                  {membersMsg}
                </div>
              ) : null}
            </div>
          ) : (
            <>
              <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <button className="btn" type="button" onClick={loadMembers} disabled={membersBusy}>
                  {membersBusy ? "Refreshing…" : "Refresh"}
                </button>
                {membersMsg ? (
                  <span className={membersMsg.toLowerCase().includes("fail") ? "error" : "helper"}>
                    {membersMsg}
                  </span>
                ) : null}
              </div>

              <div style={{ marginTop: 12 }}>
                {members.length === 0 ? (
                  <div className="helper">No members found.</div>
                ) : (
                  <><div className="bf-table-desktop">
                        <table className="table">
                          <thead>
                            <tr>
                              <th>Email</th>
                              <th>Name</th>
                              <th>Role</th>
                              <th>Remove</th>
                            </tr>
                          </thead>
                          <tbody>
                            {members.map((m) => (
                              <tr key={m.userId}>
                                <td>
                                  <code>{m.email || m.userId}</code>
                                </td>
                                <td>{m.name || ""}</td>
                                <td>
                                  <select
                                    className="input"
                                    value={m.role || "member"}
                                    onChange={(e) => setMemberRole(m.userId, e.target.value, m.role, m.email)}
                                    disabled={membersBusy}
                                  >
                                    <option value="viewer">viewer</option>
                                    <option value="member">member</option>
                                    <option value="admin">admin</option>
                                    <option value="owner">owner</option>
                                  </select>
                                </td>
                                <td style={{ whiteSpace: "nowrap" }}>
                                  {m.role === "owner" ? (
                                    <span className="helper">owner</span>
                                  ) : (
                                    <button className="btn" type="button" onClick={() => removeMember(m.userId, m.email)} disabled={membersBusy}>
                                      Remove
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div><div className="bf-cards-mobile" style={{ marginTop: 12 }}>
                          {members.map((m) => (
                            <div key={m.userId || m.email} className="bf-rowcard">
                              <div className="bf-rowcard-top">
                                <div className="bf-rowcard-title">{m.name || m.email || "member"}</div>
                                <button
                                  className="btn"
                                  type="button"
                                  onClick={() => removeMember(m.userId, m.email)}
                                  disabled={membersBusy || m.role === "owner"}
                                >
                                  Remove
                                </button>
                              </div>

                              <div className="bf-two">
                                <div className="bf-field">
                                  <div className="bf-field-label">name</div>
                                  <div>{m.name || ""}</div>
                                </div>
                                <div className="bf-field">
                                  <div className="bf-field-label">email</div>
                                  <div style={{ overflowWrap: "anywhere" }}>{m.email || ""}</div>
                                </div>
                              </div>

                              <div className="bf-field">
                                <div className="bf-field-label">role</div>
                                <div>{m.role || "member"}</div>
                              </div>
                            </div>
                          ))}
                        </div></>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Public Page */}
      {tab === "public" && (
        <div className="card" style={{ padding: 16 }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div>
              <h2 style={{ marginTop: 0, marginBottom: 6 }}>Public Page</h2>
              <p className="helper" style={{ margin: 0 }}>Set up the public-facing page visitors will see. Turn sections on or off, choose the theme, and decide what each button does.</p>
            </div>
            <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              {enabled && slug ? (
                <a className="btn" data-tour="settings-live-preview" href={`/#/p/${encodeURIComponent(slug)}`} target="_blank" rel="noreferrer">Open live preview</a>
              ) : null}
              <button className="btn-red" type="submit" form="public-page-settings-form">Save</button>
            </div>
          </div>

          <form id="public-page-settings-form" onSubmit={savePublic} className="grid" style={{ gap: 12, marginTop: 12 }}>
            <AdminPublicConfigCard />
            <PublicDomainCard slug={slug} />

            <label className="row" style={{ gap: 8, alignItems: "center" }}>
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
              <span>Enable public page</span>
            </label>

            <div className="bf-two">
              <label className="grid" style={{ gap: 6 }}>
                <span className="helper">Share URL (slug)</span>
                <div className="row" style={{ gap: 8 }}>
                  <input className="input" style={{ flex: 1 }} value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="e.g. chehalis-river-mutual-aid" />
                  <button type="button" className="btn" onClick={genSlug}>Generate</button>
                </div>
                {slug ? <a className="helper" href={`/#/p/${encodeURIComponent(slug)}`} target="_blank" rel="noreferrer">{publicUrl}</a> : null}
              </label>

              <label className="grid" style={{ gap: 6 }}>
                <span className="helper">Theme mode</span>
                <select className="input" value={themeMode} onChange={(e) => setThemeMode(e.target.value)}>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </label>
            </div>

            <div className="bf-two">
              <label className="grid" style={{ gap: 6 }}>
                <span className="helper">Title</span>
                <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Chehalis River Mutual Aid Network" />
              </label>

              <label className="grid" style={{ gap: 6 }}>
                <span className="helper">Location line</span>
                <input className="input" value={locationLine} onChange={(e) => setLocationLine(e.target.value)} placeholder="Aberdeen, WA" />
              </label>
            </div>

            <label className="grid" style={{ gap: 6 }}>
              <span className="helper">Tagline / subtitle</span>
              <input className="input" value={about} onChange={(e) => setAbout(e.target.value)} placeholder="Mutual aid, community meals, outreach" />
            </label>

            <div className="card" style={{ padding: 12 }}>
              <h3 style={{ marginTop: 0, marginBottom: 8 }}>Basics</h3>
              <p className="helper" style={{ marginTop: 0 }}>Start with the name, link, and color. This is the minimum needed to get the page live.</p>

              <div className="bf-two">
                <label className="grid" style={{ gap: 6 }}>
                  <span className="helper">Accent color</span>
                  <input className="input" type="color" value={accentColor} onChange={(e) => setAccentColor(e.target.value)} />
                </label>
                <div className="card" style={{ padding: 12, background: "rgba(255,255,255,0.02)" }}>
                  <strong style={{ display: "block", marginBottom: 6 }}>How this works</strong>
                  <div className="helper">1. Turn the public page on.</div>
                  <div className="helper">2. Choose which sections visitors should see.</div>
                  <div className="helper">3. Save, then open the live preview.</div>
                </div>
              </div>

              <div className="bf-two" style={{ marginTop: 12 }}>
                <label className="grid" style={{ gap: 6 }}>
                  <span className="helper">Website button label</span>
                  <input className="input" value={websiteLabel} onChange={(e) => setWebsiteLabel(e.target.value)} placeholder="Website" />
                </label>
                <label className="grid" style={{ gap: 6 }}>
                  <span className="helper">Website button URL</span>
                  <input className="input" value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} placeholder="https://example.org" />
                </label>
              </div>
            </div>

            <div className="card" style={{ padding: 12 }}>
              <h3 style={{ marginTop: 0, marginBottom: 8 }}>Sections</h3>
              <p className="helper" style={{ marginTop: 0 }}>Choose which blocks appear on the public page. You can hide anything that does not apply to this org.</p>
              <h4 style={{ marginTop: 0 }}>What should appear on the public page?</h4>
              <div className="bf-two">
                <label className="row" style={{ gap: 8, alignItems: "center" }}><input type="checkbox" checked={showWebsiteButton} onChange={(e) => setShowWebsiteButton(e.target.checked)} /><span>Show the Website button in the header</span></label>
                <label className="row" style={{ gap: 8, alignItems: "center" }}><input type="checkbox" checked={showActionStrip} onChange={(e) => setShowActionStrip(e.target.checked)} /><span>Show the main action buttons row</span></label>
                <label className="row" style={{ gap: 8, alignItems: "center" }}><input type="checkbox" checked={showNeeds} onChange={(e) => setShowNeeds(e.target.checked)} /><span>Show the Current Needs section</span></label>
                <label className="row" style={{ gap: 8, alignItems: "center" }}><input type="checkbox" checked={showMeetings} onChange={(e) => setShowMeetings(e.target.checked)} /><span>Show the Public Meetings section</span></label>
                <label className="row" style={{ gap: 8, alignItems: "center" }}><input type="checkbox" checked={showWhatWeDo} onChange={(e) => setShowWhatWeDo(e.target.checked)} /><span>Show the What We Do section</span></label>
                <label className="row" style={{ gap: 8, alignItems: "center" }}><input type="checkbox" checked={showGetInvolved} onChange={(e) => setShowGetInvolved(e.target.checked)} /><span>Show the Get Involved buttons</span></label>
              </div>

              <div className="card" style={{ padding: 12, marginTop: 12, background: "rgba(255,255,255,0.02)" }}>
                <strong>Stay Connected / Newsletter</strong>
                <div className="grid" style={{ gap: 8, marginTop: 10 }}>
                  <label className="row" style={{ gap: 8, alignItems: "center" }}>
                    <input type="checkbox" checked={showNewsletterCard} onChange={(e) => setShowNewsletterCard(e.target.checked)} />
                    <span>Show the Stay Connected card on the public page</span>
                  </label>
                  <label className="row" style={{ gap: 8, alignItems: "center", opacity: showNewsletterCard ? 1 : 0.65 }}>
                    <input type="checkbox" checked={publicNewsletterEnabled} onChange={(e) => setPublicNewsletterEnabled(e.target.checked)} disabled={!showNewsletterCard} />
                    <span>Let visitors submit the email signup form</span>
                  </label>
                </div>
              </div>

              <div style={{ marginTop: 12 }}>
                <label className="row" style={{ gap: 8, alignItems: "center" }}>
                  <input type="checkbox" checked={publicPledgesEnabled} onChange={(e) => setPublicPledgesEnabled(e.target.checked)} />
                  <span>Let visitors pledge support on public needs</span>
                </label>
              </div>
            </div>

            <div className="card" style={{ padding: 12 }}>
              <h3 style={{ marginTop: 0, marginBottom: 8 }}>What We Do</h3>
              <p className="helper" style={{ marginTop: 0 }}>Add a short list of what the org does. Use one line per item.</p>
              <label className="grid" style={{ gap: 6 }}>
                <span className="helper">What we do (one item per line)</span>
              <textarea className="textarea" rows={4} value={whatWeDo} onChange={(e) => setWhatWeDo(e.target.value)} placeholder={`Free Store
Community Meals
Outreach`} />
              </label>
            </div>

            <div className="card" style={{ padding: 12 }}>
              <h3 style={{ marginTop: 0, marginBottom: 8 }}>Main action buttons</h3>
              <p className="helper" style={{ marginTop: 0 }}>These are the big buttons near the top of the public page.</p>
              <div className="grid" style={{ gap: 10 }}>
                {primaryActionItems.map((item, index) => {
                  const isEnabled = item.kind !== "none";
                  return (
                  <div key={`primary-action-${index}`} className="card" style={{ padding: 12, border: "1px solid #222" }}>
                    <div className="grid" style={{ gap: 8 }}>
                      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <strong>Button {index + 1}</strong>
                        <label className="row" style={{ gap: 8, alignItems: "center" }}>
                          <input
                            type="checkbox"
                            checked={isEnabled}
                            onChange={(e) => toggleActionItemEnabled(setPrimaryActionItems, primaryActionItems, primaryActionDefaults, index, e.target.checked)}
                          />
                          <span>Show this button</span>
                        </label>
                      </div>
                      <label className="grid" style={{ gap: 6 }}>
                        <span className="helper">Button label</span>
                        <input className="input" value={item.label} onChange={(e) => updateActionItem(setPrimaryActionItems, index, { label: e.target.value })} placeholder={`Button ${index + 1}`} />
                      </label>
                      <label className="grid" style={{ gap: 6 }}>
                        <span className="helper">When someone clicks it</span>
                        <select className="input" value={item.kind} onChange={(e) => updateActionItem(setPrimaryActionItems, index, { kind: e.target.value, url: e.target.value === "external" ? item.url : "" })}>
                          {actionTypeOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                        </select>
                      </label>
                      {item.kind === "external" ? (
                        <label className="grid" style={{ gap: 6 }}>
                          <span className="helper">Link to open</span>
                          <input className="input" value={item.url} onChange={(e) => updateActionItem(setPrimaryActionItems, index, { url: e.target.value })} placeholder="https://example.org/form" />
                        </label>
                      ) : null}
                    </div>
                  </div>
                );})}
              </div>
            </div>

            <div className="card" style={{ padding: 12 }}>
              <h3 style={{ marginTop: 0, marginBottom: 8 }}>Get Involved buttons</h3>
              <p className="helper" style={{ marginTop: 0 }}>These are the optional buttons lower on the page. You can hide any of them.</p>
              <div className="grid" style={{ gap: 10 }}>
                {getInvolvedActionItems.map((item, index) => {
                  const isEnabled = item.kind !== "none";
                  return (
                  <div key={`involved-action-${index}`} className="card" style={{ padding: 12, border: "1px solid #222" }}>
                    <div className="grid" style={{ gap: 8 }}>
                      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <strong>Button {index + 1}</strong>
                        <label className="row" style={{ gap: 8, alignItems: "center" }}>
                          <input
                            type="checkbox"
                            checked={isEnabled}
                            onChange={(e) => toggleActionItemEnabled(setGetInvolvedActionItems, getInvolvedActionItems, getInvolvedDefaults, index, e.target.checked)}
                          />
                          <span>Show this button</span>
                        </label>
                      </div>
                      <label className="grid" style={{ gap: 6 }}>
                        <span className="helper">Button label</span>
                        <input className="input" value={item.label} onChange={(e) => updateActionItem(setGetInvolvedActionItems, index, { label: e.target.value })} placeholder={`Button ${index + 1}`} />
                      </label>
                      <label className="grid" style={{ gap: 6 }}>
                        <span className="helper">When someone clicks it</span>
                        <select className="input" value={item.kind} onChange={(e) => updateActionItem(setGetInvolvedActionItems, index, { kind: e.target.value, url: e.target.value === "external" ? item.url : "" })}>
                          {actionTypeOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                        </select>
                      </label>
                      {item.kind === "external" ? (
                        <label className="grid" style={{ gap: 6 }}>
                          <span className="helper">Link to open</span>
                          <input className="input" value={item.url} onChange={(e) => updateActionItem(setGetInvolvedActionItems, index, { url: e.target.value })} placeholder="https://example.org/form" />
                        </label>
                      ) : null}
                    </div>
                  </div>
                );})}
              </div>
            </div>
            <div className="row" style={{ gap: 8, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
              <div>
                {msg && <span className={msg.includes("Saved") ? "success" : "error"}>{msg}</span>}
              </div>
              <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {enabled && slug ? (
                  <a className="btn" href={`/#/p/${encodeURIComponent(slug)}`} target="_blank" rel="noreferrer">Open live preview</a>
                ) : null}
                <button className="btn-red" type="submit">Save</button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Public Inbox */}
      {tab === "public-inbox" && (
        <div className="card" style={{ padding: 16 }}>
          <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <h2 style={{ margin: 0 }}>Public Inbox</h2>
            <button className="btn" type="button" onClick={loadPublicInbox} disabled={publicInboxBusy}>
              {publicInboxBusy ? "Refreshing…" : "Refresh"}
            </button>
            <select className="input" value={publicInboxFilter} onChange={(e) => setPublicInboxFilter(e.target.value)} style={{ maxWidth: 180 }}>
              <option value="all">All</option>
              <option value="intake">Intakes only</option>
              <option value="rsvp">RSVPs only</option>
              <option value="new">Status: new</option>
              <option value="reviewed">Status: reviewed</option>
              <option value="contacted">Status: contacted</option>
              <option value="closed">Status: closed</option>
            </select>
            {publicInboxMsg ? <span className={publicInboxMsg.includes("Saved") ? "success" : "helper"}>{publicInboxMsg}</span> : null}
          </div>

          <p className="helper" style={{ marginTop: 8 }}>Review public help requests, volunteer offers, resource offers, and per-meeting RSVPs from the refreshed public page.</p>

          <div style={{ marginTop: 12 }}>
            {filteredPublicInboxItems.length === 0 ? (
              <div className="helper">No public submissions yet.</div>
            ) : (
              <div className="grid" style={{ gap: 12 }}>
                {filteredPublicInboxItems.map((item) => (
                  <div key={`${item.type}:${item.id}`} className="card" style={{ padding: 12, border: "1px solid #222" }}>
                    <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <strong>{item.title || (item.type === "rsvp" ? "Meeting RSVP" : "Public intake")}</strong>
                      <span className="helper">{item.type === "rsvp" ? "RSVP" : (item.source_kind || "intake").replaceAll("_", " ")}</span>
                      <span className="helper">{item.created_at ? new Date(item.created_at).toLocaleString() : ""}</span>
                    </div>

                    <div className="bf-two" style={{ marginTop: 10 }}>
                      <div className="grid" style={{ gap: 8 }}>
                        <div><div className="helper">Name</div><div>{item.name || ""}</div></div>
                        <div><div className="helper">Contact</div><div style={{ overflowWrap: "anywhere" }}>{item.contact || ""}</div></div>
                        {item.type === "rsvp" ? (
                          <>
                            <div><div className="helper">Attendance</div><div>{item.attendee_status || "yes"}</div></div>
                            <div><div className="helper">Meeting</div><div>{item.meeting_title || "Public meeting"}{item.starts_at ? ` · ${new Date(item.starts_at).toLocaleString()}` : ""}</div></div>
                            {item.location ? <div><div className="helper">Location</div><div>{item.location}</div></div> : null}
                          </>
                        ) : null}
                      </div>

                      <div className="grid" style={{ gap: 8 }}>
                        <label className="grid" style={{ gap: 6 }}>
                          <span className="helper">Admin status</span>
                          <select
                            className="input"
                            data-public-inbox-status={`${item.type}:${item.id}`}
                            defaultValue={item.review_status || "new"}
                            onChange={(e) => {
                              const note = document.getElementById(`public-inbox-note-${item.type}-${item.id}`)?.value || "";
                              savePublicInboxItem(item, e.target.value, note);
                            }}
                            disabled={publicInboxBusy}
                          >
                            <option value="new">new</option>
                            <option value="reviewed">reviewed</option>
                            <option value="contacted">contacted</option>
                            <option value="closed">closed</option>
                          </select>
                        </label>

                        <label className="grid" style={{ gap: 6 }}>
                          <span className="helper">Admin note</span>
                          <textarea
                            id={`public-inbox-note-${item.type}-${item.id}`}
                            className="textarea"
                            rows={4}
                            defaultValue={item.admin_note || ""}
                            placeholder="Internal note for org admins"
                          />
                        </label>

                        <button
                          className="btn-red"
                          type="button"
                          disabled={publicInboxBusy}
                          onClick={() => {
                            const status = document.querySelector(`select[data-public-inbox-status="${item.type}:${item.id}"]`)?.value || item.review_status || "new";
                            const note = document.getElementById(`public-inbox-note-${item.type}-${item.id}`)?.value || "";
                            savePublicInboxItem(item, status, note);
                          }}
                        >
                          Save
                        </button>
                      </div>
                    </div>

                    {item.details ? (
                      <div style={{ marginTop: 10 }}>
                        <div className="helper">Details</div>
                        <div style={{ whiteSpace: "pre-wrap" }}>{item.details}</div>
                      </div>
                    ) : null}

                    {item.extra ? (
                      <div style={{ marginTop: 10 }}>
                        <div className="helper">Extra</div>
                        <div style={{ whiteSpace: "pre-wrap" }}>{item.extra}</div>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Newsletter */}
      {tab === "newsletter" && (
        <div className="card" style={{ padding: 16 }}>
          <h2 style={{ marginTop: 0 }}>Newsletter</h2>
          <div className="helper">
            Bondfire stores subscribers. Riseup sends the newsletter.
          </div>

          <div className="grid" style={{ gap: 10, marginTop: 10 }}>

            <label className="grid" style={{ gap: 6 }}>
              <span className="helper">Riseup list address</span>
              <input
                className="input"
                value={nlListAddress}
                onChange={(e) => setNlListAddress(e.target.value)}
                placeholder="example-list@riseup.net"
              />
            </label>

            <label className="grid" style={{ gap: 6 }}>
              <span className="helper">Default blurb</span>
              <textarea
                className="textarea"
                rows={3}
                value={nlBlurb}
                onChange={(e) => setNlBlurb(e.target.value)}
                placeholder="One paragraph you usually include at the top."
              />
            </label>

            <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <button className="btn-red" type="button" onClick={saveNewsletter} disabled={nlBusy}>
                {nlBusy ? "Saving…" : "Save"}
              </button>
              <button className="btn" type="button" onClick={openRiseupDraft}>
                Open email draft
              </button>
              <button className="btn" type="button" onClick={() => loadSubscribers()} disabled={nlBusy}>
                Refresh subscribers
              </button>

              <button className="btn" type="button" onClick={() => exportSubscribersCsv().catch(console.error)} disabled={nlBusy}>
                Export CSV
              </button>





              {nlMsg && <span className={nlMsg.toLowerCase().includes("fail") ? "error" : "helper"}>{nlMsg}</span>}
            </div>

            <div className="card" style={{ padding: 12, border: "1px solid #222" }}>
              <h3 style={{ marginTop: 0 }}>Subscribers</h3>
              {subscribers.length === 0 ? (
                <div className="helper">No subscribers yet.</div>
              ) : (
                <><div className="bf-table-desktop">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Email</th>
                          <th>Name</th>
                          <th>Joined</th>
                        </tr>
                      </thead>
                      <tbody>
                        {subscribers.slice(0, 200).map((s) => (
                          <tr key={s.id || s.email}>
                            <td>
                              <code>{s.email}</code>
                            </td>
                            <td>{s.name || ""}</td>
                            <td>{s.created_at ? new Date(s.created_at).toLocaleString() : ""}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div><div className="bf-cards-mobile" style={{ marginTop: 12 }}>
                    {subscribers.slice(0, 200).map((s) => (
                      <div key={s.id || s.email} className="bf-rowcard">
                        <div className="bf-rowcard-top">
                          <div className="bf-rowcard-title">{s.name || s.email || "subscriber"}</div>
                        </div>

                        <div className="bf-two">
                          <div className="bf-field">
                            <div className="bf-field-label">name</div>
                            <div style={{ overflowWrap: "anywhere" }}>{s.name || ""}</div>
                          </div>
                          <div className="bf-field">
                            <div className="bf-field-label">email</div>
                            <div style={{ overflowWrap: "anywhere" }}>{s.email || ""}</div>
                          </div>
                        </div>

                        <div className="bf-field">
                          <div className="bf-field-label">joined</div>
                          <div style={{ opacity: 0.85 }}>
                            {s.created_at ? new Date(s.created_at).toLocaleString() : ""}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div></>
              )}
              {subscribers.length > 200 ? (
                <div className="helper" style={{ marginTop: 8 }}>
                  Showing first 200. Use Export CSV for the full list.
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* Pledges */}
      {tab === "pledges" && (
        <div className="card" style={{ padding: 16 }}>
          <h2 style={{ marginTop: 0 }}>Pledges</h2>

          <div className="helper" style={{ marginTop: 6 }}>
            Pledges can be linked to a Need for tracking.
          </div>

          <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
            <button className="btn" type="button" onClick={() => loadPledges()} disabled={pledgesBusy}>
              {pledgesBusy ? "Loading…" : "Refresh"}
            </button>
            <Link className="btn" to={`/org/${encodeURIComponent(orgId)}/needs`}>
              Go to Needs
            </Link>
            {pledgesMsg && <span className={pledgesMsg.toLowerCase().includes("fail") ? "error" : "helper"}>{pledgesMsg}</span>}
          </div>

          <div style={{ marginTop: 12 }}>
            {pledges.length === 0 ? (
              <div className="helper">No pledges yet.</div>
            ) : (
              <><div className="bf-table-desktop" style={{ overflowX: "auto" }}>
                  <table className="table pledges-table">
                    <thead>
                      <tr>
                        <th>Pledger</th>
                        <th>Email</th>
                        <th>Need</th>
                        <th>Type</th>
                        <th>Amount</th>
                        <th>Unit</th>
                        <th>Status</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {pledges.map((p) => (
                        <tr key={p.id}>
                          <td>{p.pledger_name || ""}</td>
                          <td>
                            <code>{p.pledger_email || ""}</code>
                          </td>
                          <td>
                            <select
                              className="input"
                              value={p.need_id || ""}
                              onChange={(e) => upsertPledge(p.id, { need_id: e.target.value || null })}
                              disabled={pledgesBusy}
                            >
                              <option value="">unassigned</option>
                              {needs.map((n) => (
                                <option key={n.id} value={n.id}>
                                  {n.title || n.id}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <input
                              className="input"
                              defaultValue={p.type || ""}
                              onBlur={(e) => {
                                const v = String(e.target.value || "");
                                if (v !== String(p.type || "")) upsertPledge(p.id, { type: v });
                              } }
                              disabled={pledgesBusy} />
                          </td>
                          <td>
                            <input
                              className="input"
                              defaultValue={p.amount || ""}
                              onBlur={(e) => {
                                const v = String(e.target.value || "");
                                if (v !== String(p.amount || "")) upsertPledge(p.id, { amount: v });
                              } }
                              disabled={pledgesBusy} />
                          </td>
                          <td>
                            <input
                              className="input"
                              defaultValue={p.unit || ""}
                              onBlur={(e) => {
                                const v = String(e.target.value || "");
                                if (v !== String(p.unit || "")) upsertPledge(p.id, { unit: v });
                              } }
                              disabled={pledgesBusy} />
                          </td>
                          <td>
                            <select
                              className="input"
                              value={p.status || "offered"}
                              onChange={(e) => upsertPledge(p.id, { status: e.target.value })}
                              disabled={pledgesBusy}
                            >
                              <option value="offered">offered</option>
                              <option value="accepted">accepted</option>
                              <option value="fulfilled">fulfilled</option>
                              <option value="cancelled">cancelled</option>
                            </select>
                          </td>
                          <td style={{ whiteSpace: "nowrap" }}>
                            <button className="btn" type="button" onClick={() => deletePledge(p.id)} disabled={pledgesBusy}>
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div><div className="bf-cards-mobile" style={{ marginTop: 12 }}>
                    {pledges.map((p) => (
                      <div key={p.id} className="bf-rowcard">
                        <div className="bf-rowcard-top">
                          <div className="bf-rowcard-title">{p.pledger || "unknown"}</div>
                          <button className="btn" onClick={() => deletePledge(p.id)} disabled={pledgesBusy}>
                            Delete
                          </button>
                        </div>

                        <div className="bf-field">
                          <div className="bf-field-label">email</div>
                          <div style={{ overflowWrap: "anywhere" }}>{p.email || ""}</div>
                        </div>

                        <div className="bf-field">
                          <div className="bf-field-label">need</div>
                          <div style={{ opacity: 0.9 }}>
                            {p.need_id ? (needTitleById.get(String(p.need_id)) || "") : ""}
                          </div>
                        </div>

                        <div className="bf-two">
                          <div className="bf-field">
                            <div className="bf-field-label">type</div>
                            <div>{p.type || ""}</div>
                          </div>
                          <div className="bf-field">
                            <div className="bf-field-label">status</div>
                            <select
                              className="input"
                              value={p.status || "offered"}
                              onChange={(e) => upsertPledge(p.id, { status: e.target.value })}
                              disabled={pledgesBusy}
                            >
                              <option value="offered">offered</option>
                              <option value="accepted">accepted</option>
                              <option value="fulfilled">fulfilled</option>
                              <option value="cancelled">cancelled</option>
                            </select>

                          </div>
                        </div>

                        <div className="bf-two">
                          <div className="bf-field">
                            <div className="bf-field-label">amount</div>
                            <input
                              className="input"
                              value={p.amount ?? ""}
                              onChange={(e) => upsertPledge(p.id, { amount: e.target.value })}
                              disabled={pledgesBusy} />
                          </div>
                          <div className="bf-field">
                            <div className="bf-field-label">unit</div>
                            <input
                              className="input"
                              value={p.unit || ""}
                              onChange={(e) => upsertPledge(p.id, { unit: e.target.value })}
                              disabled={pledgesBusy} />
                          </div>
                        </div>
                      </div>
                    ))}

                    {pledges.length === 0 ? <div style={{ opacity: 0.7 }}>No pledges yet.</div> : null}
                  </div></>
            )}
          </div>

          <div className="card" style={{ padding: 12, border: "1px solid #222", marginTop: 14 }}>
            <h3 style={{ marginTop: 0 }}>Add pledge</h3>
            <form onSubmit={onAddPledge} className="grid" style={{ gap: 10 }}>
              <div className="grid cols-2" style={{ gap: 10 }}>
                <input className="input" name="pledger_name" placeholder="Pledger name" />
                <input className="input" name="pledger_email" placeholder="Pledger email" />
              </div>

              <select className="input" name="need_id" defaultValue="">
                <option value="">Link to need (optional)</option>
                {needs.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.title || n.id}
                  </option>
                ))}
              </select>

              <div className="grid cols-3" style={{ gap: 10 }}>
                <input className="input" name="type" placeholder="Type (money, food, labor)" />
                <input className="input" name="amount" placeholder="Amount" />
                <input className="input" name="unit" placeholder="Unit (USD, hours, boxes)" />
              </div>

              <textarea className="textarea" name="note" rows={2} placeholder="Note" />

              <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <select className="input" name="status" defaultValue="offered">
                  <option value="offered">offered</option>
                  <option value="accepted">accepted</option>
                  <option value="fulfilled">fulfilled</option>
                  <option value="cancelled">cancelled</option>
                </select>

                <button className="btn-red" type="submit" disabled={pledgesBusy}>
                  {pledgesBusy ? "Saving…" : "Add"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- ZK decrypt helper ---------- */
async function tryDecryptList(orgId, rows, blobField = "encrypted_blob") {
  const list = Array.isArray(rows) ? rows : [];
  if (!orgId || list.length === 0) return list;
  let keyBytes = null;
  try {
    keyBytes = await getCachedOrgKey(orgId);
  } catch {
    keyBytes = null;
  }
  if (!keyBytes) return list;

  const out = [];
  for (const row of list) {
    const r = { ...(row || {}) };
    // Some endpoints use different blob field names.
    // Accept the caller's hint first, then try common alternatives.
    const blob =
      r?.[blobField] ||
      r?.encrypted_blob ||
      r?.encryptedBlob ||
      r?.encrypted_profile ||
      r?.encryptedProfile ||
      r?.encrypted_payload ||
      r?.encryptedPayload;
    if (!blob) {
      out.push(r);
      continue;
    }
    try {
      const decRaw = await decryptWithOrgKey(keyBytes, blob);
      let dec = decRaw;
      if (typeof decRaw === "string") {
        try { dec = JSON.parse(decRaw); } catch { dec = null; }
      }
      if (dec && typeof dec === "object") {
        for (const [k, v] of Object.entries(dec)) {
          // Only fill placeholders; never overwrite real server fields.
          const cur = r[k];
          const isPlaceholder =
            cur == null ||
            cur === "" ||
            cur === "__encrypted__" ||
            cur === "_encrypted_" ||
            cur === "encrypted";
          if (isPlaceholder) r[k] = v;
        }
        r.__decrypted__ = true;
      }
    } catch {
      // keep original row
    }
    out.push(r);
  }
  return out;
}
