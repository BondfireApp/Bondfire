import { PromoteToCase } from "../modules/work/WorkIntegrations.jsx";
import { api } from '../utils/api.js';
// src/pages/Settings.jsx
import * as React from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { decryptWithOrgKey, encryptWithOrgKey, getCachedOrgKey } from "../lib/zk.js";
import { loadScopedKeys } from "../lib/privateKeyScopes.js";
import { openSubmission } from "../../shared/privateSubmission.js";
import Security from "./Security.jsx";
import { isDemoMode } from "../demo/demoMode.js";
import { demoHandle, getDemoSubscribersCsv, ensureDemoOrgList } from "../demo/demoStore.js";
import { AdminPublicConfigCard } from "../components/AdminPublicConfigCard.jsx";
import { PublicDomainCard } from "../components/PublicDomainCard.jsx";
import BuildModules from "../components/BuildModules.jsx";
import { cacheOrgName, loadOrgIdentity } from "../lib/orgIdentity.js";

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

function defaultNewsletterBody(blurb, orgName) {
  return [
    String(blurb || "").trim(),
    "Hello,",
    "",
    "Here is the latest update.",
    "",
    "News",
    "• ",
    "",
    "Upcoming",
    "• ",
    "",
    "Solidarity",
    "• ",
    "",
    `In solidarity,`,
    String(orgName || "").trim(),
  ].filter((line, index, all) => !(line === "" && index > 0 && all[index - 1] === "")).join("\n");
}

function profileText(value) {
  const text = String(value || "").trim();
  if (!text || ["__encrypted__", "_encrypted_", "encrypted"].includes(text.toLowerCase())) return "";
  return text;
}

function shortMemberId(value) {
  const text = String(value || "").trim();
  return text ? text.slice(0, 8) : "unknown";
}

function memberDisplayName(member) {
  return profileText(member?.name) || profileText(member?.email) || `Member · ${shortMemberId(member?.userId || member?.user_id)}`;
}

function memberContact(member) {
  return profileText(member?.contact) || profileText(member?.email);
}


export default function Settings({ privateMode: privateModeProp }) {
  const { orgId } = useParams();
  const [detectedPrivateMode, setDetectedPrivateMode] = React.useState(null);

  // Settings is mounted directly from the router, so no parent currently supplies
  // a privateMode prop. Resolve the organization's real privacy state here.
  // Until that check finishes, default to the safer private-mode behavior so
  // Settings never probes plaintext-only endpoints for an encrypted org.
  const privateMode =
    typeof privateModeProp === "boolean"
      ? privateModeProp
      : detectedPrivateMode !== false;

  React.useEffect(() => {
    let cancelled = false;

    if (!orgId) {
      setDetectedPrivateMode(false);
      return () => {
        cancelled = true;
      };
    }

    if (typeof privateModeProp === "boolean") {
      setDetectedPrivateMode(privateModeProp);
      return () => {
        cancelled = true;
      };
    }

    setDetectedPrivateMode(null);
    authFetch(`/api/orgs/${encodeURIComponent(orgId)}/privacy`, { method: "GET" })
      .then((privacy) => {
        if (cancelled) return;
        setDetectedPrivateMode(!!privacy && String(privacy.state || "off") !== "off");
      })
      .catch(() => {
        if (cancelled) return;
        // Fail closed. A temporary privacy-status error must not cause Settings
        // to fall back to readable server-side routes.
        setDetectedPrivateMode(true);
      });

    return () => {
      cancelled = true;
    };
  }, [orgId, privateModeProp]);

  /* ---------- Section + submenu tabs ---------- */
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = String(searchParams.get("tab") || "org").toLowerCase();
  const requestedSection = String(searchParams.get("section") || "").toLowerCase();
  const securityTabKeys = ["invites", "members", "profile", "security"];
  const activeSection =
    requestedSection ||
    (securityTabKeys.includes(tab) ? "security" : tab === "newsletter" ? "newsletter" : "settings");

  const setTab = (next) => {
    const n = String(next || "org").toLowerCase();
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.set("tab", n);
        if (securityTabKeys.includes(n)) p.set("section", "security");
        else if (n === "newsletter") p.set("section", "newsletter");
        else p.set("section", "settings");
        return p;
      },
      { replace: true }
    );
  };

  const tabs = React.useMemo(() => {
    if (activeSection === "newsletter") return [];

    if (activeSection === "security") {
      return [
        ["invites", "Invites"],
        ["members", "Members"],
        ["profile", "Member profile"],
        ["security", "Security"],
      ];
    }

    return [
      ["org", "Organization"],
      ["build", "Build"],
      ["public", "Public page"],
      ["public-inbox", "Public inbox"],
      ["pledges", "Pledges"],
    ].filter(([key]) => !privateMode || ["pledges", "public", "public-inbox"].includes(key));
  }, [activeSection, privateMode]);

  /* ========== INVITES (backend) ========== */
  const [invites, setInvites] = React.useState([]);
  const [inviteMsg, setInviteMsg] = React.useState("");
  const [inviteBusy, setInviteBusy] = React.useState(false);
  const [inviteRole, setInviteRole] = React.useState("member");

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
        body: { role: inviteRole, expiresInDays: 14, maxUses: 1 },
      });

      if (r?.invite) {
        setInvites((prev) => [r.invite, ...prev]);
        setInviteMsg(`Invite created: ${r.invite.code} · role: ${r.invite.role || inviteRole}`);
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
  const [membersMeUserId, setMembersMeUserId] = React.useState("");
  const [profileDraft, setProfileDraft] = React.useState({ name: "", pronouns: "", contact: "", bio: "" });
  const [profileMsg, setProfileMsg] = React.useState("");
  const [profileBusy, setProfileBusy] = React.useState(false);

  const loadMembers = React.useCallback(async () => {
    if (!orgId) return;
    setMembersMsg("");
    try {
      // Member-only organizations must never request readable membership PII from the server.
      // Legacy organizations may still use the plaintext admin view until they are converted.
      const privacy = await authFetch(`/api/orgs/${encodeURIComponent(orgId)}/privacy`, { method: "GET" }).catch(() => null);
      const privateActive = privacy && privacy.state !== "off";
      const memberPath = `/api/orgs/${encodeURIComponent(orgId)}/members${privateActive ? "" : "?plaintext=1"}`;
      const r = await authFetch(memberPath, { method: "GET" });
      const _mem = Array.isArray(r.members) ? r.members : [];
      const decryptedMembers = await tryDecryptList(orgId, _mem);
      setMembers(decryptedMembers);
      setMembersMeUserId(String(r.meUserId || decryptedMembers.find((member) => member?.is_self)?.userId || ""));
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

  const meMember = React.useMemo(
    () => members.find((member) => String(member?.userId || member?.user_id || "") === String(membersMeUserId || "")) || null,
    [members, membersMeUserId]
  );
  const canManageMembers = ["admin", "owner"].includes(String(meMember?.role || ""));

  React.useEffect(() => {
    if (!meMember) return;
    setProfileDraft({
      name: profileText(meMember.name),
      pronouns: profileText(meMember.pronouns),
      contact: profileText(meMember.contact),
      bio: profileText(meMember.bio),
    });
  }, [meMember]);

  const saveMemberProfile = async (event) => {
    event?.preventDefault?.();
    if (!orgId || !membersMeUserId) {
      setProfileMsg("Could not identify your membership.");
      return;
    }

    const name = String(profileDraft.name || "").trim();
    if (!name) {
      setProfileMsg("Display name is required.");
      return;
    }

    const orgKey = getCachedOrgKey(orgId);
    if (!orgKey) {
      setProfileMsg("This device does not have the organization encryption key loaded.");
      return;
    }

    setProfileBusy(true);
    setProfileMsg("");
    try {
      const encryptedBlob = await encryptWithOrgKey(orgKey, JSON.stringify({
        email: profileText(meMember?.email),
        name,
        pronouns: String(profileDraft.pronouns || "").trim(),
        contact: String(profileDraft.contact || "").trim(),
        bio: String(profileDraft.bio || "").trim(),
      }));

      await authFetch(`/api/orgs/${encodeURIComponent(orgId)}/members`, {
        method: "PUT",
        body: { userId: membersMeUserId, encrypted_blob: encryptedBlob },
      });

      await loadMembers();
      setProfileMsg("Profile saved. Organization members with the org key can read it; it is not published publicly.");
    } catch (e) {
      setProfileMsg(e.message || "Failed to save profile");
    } finally {
      setProfileBusy(false);
    }
  };

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
    let alive = true;
    const s = readJSON(orgSettingsKey(orgId));
    if (s.name) setOrgName(s.name);
    if (s.logoDataUrl || s.logoUrl) setLogoDataUrl(s.logoDataUrl || s.logoUrl);
    if (orgId) {
      loadOrgIdentity(orgId)
        .then((identity) => {
          if (alive && identity?.name) setOrgName(identity.name);
        })
        .catch(() => {});
    }
    return () => { alive = false; };
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
    const nextName = (orgName || "").trim();
    writeJSON(key, { ...prev, name: nextName, logoDataUrl });
    if (nextName) cacheOrgName(orgId, nextName);
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
  const publicConfigRef = React.useRef(null);

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
    setNlBlurb(String(pub.newsletter_blurb || ""));
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
  if (tab === "public" || tab === "newsletter") {
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
      await publicConfigRef.current?.saveSiteContent?.();

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

  /* ========== NEWSLETTER (backend + delivery) ========== */
  const [nlEnabled, setNlEnabled] = React.useState(false);
  const [nlListAddress, setNlListAddress] = React.useState("");
  const [nlBlurb, setNlBlurb] = React.useState("");
  const [nlSenderName, setNlSenderName] = React.useState("");
  const [nlSenderEmail, setNlSenderEmail] = React.useState("");
  const [nlReplyTo, setNlReplyTo] = React.useState("");
  const [nlEffectiveFrom, setNlEffectiveFrom] = React.useState("");
  const [nlResendConfigured, setNlResendConfigured] = React.useState(false);
  const [nlDeliveryStatus, setNlDeliveryStatus] = React.useState("loading");
  const [nlRuntime, setNlRuntime] = React.useState(null);
  const [nlSubject, setNlSubject] = React.useState("");
  const [nlDraft, setNlDraft] = React.useState("");
  const [nlMsg, setNlMsg] = React.useState("");
  const [nlBusy, setNlBusy] = React.useState(false);
  const [subscribers, setSubscribers] = React.useState([]);
  const [newsletterPrivateMode, setNewsletterPrivateMode] = React.useState(false);
  const exportSubscribersCsv = async () => {
    if (!orgId) return;
    setNlMsg("");
    setNlBusy(true);
    try {
      const rows = isDemoMode()
        ? []
        : subscribers.filter((row) => String(row?.email || "").trim() && row.email !== "__encrypted__");

      if (isDemoMode()) {
        const blob = new Blob([getDemoSubscribersCsv()], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `subscribers-${orgId}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } else {
        const quote = (value) => '"' + String(value ?? "").replaceAll('"', '""') + '"';
        const csv = [
          "name,email,joined",
          ...rows.map((row) => [
            quote(row.name),
            quote(row.email),
            quote(row.created_at ? new Date(row.created_at).toISOString() : ""),
          ].join(",")),
        ].join("\r\n");

        const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `subscribers-${orgId}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }

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
    setNlDeliveryStatus("loading");

    try {
      const [deliverySettled, publicSettled] = await Promise.allSettled([
        authFetch(`/api/orgs/${encodeURIComponent(orgId)}/newsletter/delivery`, { method: "GET" }),
        authFetch(`/api/orgs/${encodeURIComponent(orgId)}/public/get`, { method: "GET" }),
      ]);

      let delivery = {};
      if (deliverySettled.status === "fulfilled") {
        delivery = deliverySettled.value?.delivery || {};
        const configured = !!delivery.resend_configured;
        setNlResendConfigured(configured);
        setNlDeliveryStatus(configured ? "ready" : "not-configured");
        setNlSenderName(String(delivery.sender_name || ""));
        setNlSenderEmail(String(delivery.sender_email || ""));
        setNlReplyTo(String(delivery.reply_to || ""));
        setNlEffectiveFrom(String(delivery.effective_from || ""));
        setNlRuntime(delivery.runtime && typeof delivery.runtime === "object" ? delivery.runtime : null);
      } else {
        setNlResendConfigured(false);
        setNlDeliveryStatus("error");
        setNlRuntime(null);
      }

      let pub = {};
      if (publicSettled.status === "fulfilled") {
        pub = publicSettled.value?.public || {};
        setNlEnabled(!!pub.newsletter_enabled);
      }

      let nextBlurb = String(pub.newsletter_blurb || delivery.public_blurb || "");
      let legacy = null;

      if (!privateMode) {
        const legacyResult = await authFetch(`/api/orgs/${encodeURIComponent(orgId)}/newsletter`, {
          method: "GET",
        }).catch(() => null);
        legacy = legacyResult?.newsletter || legacyResult?.settings || null;
        if (!nextBlurb) nextBlurb = String(legacy?.blurb || "");
      }

      setNlListAddress(String(legacy?.list_address || legacy?.listAddress || ""));
      setNlBlurb(nextBlurb);
      setNlSubject((current) => current || `${orgName || "Organization"} update`);
      setNlDraft((current) => current || defaultNewsletterBody(nextBlurb, orgName || "Organization"));

      const errors = [];
      if (deliverySettled.status === "rejected") {
        errors.push(`Delivery status unavailable: ${deliverySettled.reason?.message || "request failed"}`);
      }
      if (publicSettled.status === "rejected") {
        errors.push(`Public signup settings unavailable: ${publicSettled.reason?.message || "request failed"}`);
      }
      if (errors.length) setNlMsg(errors.join(" "));
    } finally {
      setNlBusy(false);
    }
  }, [orgId, orgName, privateMode]);

  const loadSubscribers = React.useCallback(async () => {
    if (!orgId) return;
    setNlMsg("");
    setNlBusy(true);
    try {
      // Never fall back to a plaintext subscriber endpoint when privacy status
      // cannot be determined. Private mode is anything other than an explicit
      // "off" state.
      const privacy = await authFetch(`/api/orgs/${encodeURIComponent(orgId)}/privacy`, { method: "GET" });
      const privateActive = String(privacy?.state || "off") !== "off";

      if (privateActive) {
        setNewsletterPrivateMode(true);

        if (privacy?.state !== "enabled") {
          setSubscribers([]);
          setNlMsg("Encrypted organization setup is not complete yet. Newsletter subscribers will stay unavailable until private storage is ready.");
          return;
        }

        const scoped = await loadScopedKeys(orgId, authFetch);
        const adminScope = scoped?.key?.scopes?.admin;
        const inbox = await authFetch(`/api/orgs/${encodeURIComponent(orgId)}/privacy/submissions`, { method: "GET" });
        const rows = Array.isArray(inbox?.submissions) ? inbox.submissions.filter((row) => row?.type === "newsletter") : [];
        const clear = [];

        for (const row of rows) {
          try {
            const privateKey = adminScope?.submissions?.[row.epoch];
            if (!privateKey) continue;
            const opened = await openSubmission(orgId, row, privateKey);
            clear.push({
              id: row.id,
              email: String(opened?.email || "").trim(),
              name: String(opened?.name || "").trim(),
              created_at: row.created_at ?? null,
              encrypted: true,
            });
          } catch {
            // Keep unreadable encrypted submissions out of the plaintext UI.
          }
        }

        setSubscribers(clear);
        return;
      }

      setNewsletterPrivateMode(false);
      const r = await authFetch(
        `/api/orgs/${encodeURIComponent(orgId)}/newsletter/subscribers`,
        { method: "GET" }
      );
      const _subs = Array.isArray(r.subscribers) ? r.subscribers : [];
      setSubscribers(await tryDecryptList(orgId, _subs));
    } catch (e) {
      setSubscribers([]);
      setNewsletterPrivateMode(true);
      setNlMsg(e.message || "Failed to determine newsletter subscriber storage mode.");
    } finally {
      setNlBusy(false);
    }
  }, [orgId]);

  const saveNewsletter = async () => {
    if (!orgId) return;
    setNlMsg("");
    setNlBusy(true);
    try {
      const deliverySave = await authFetch(
        `/api/orgs/${encodeURIComponent(orgId)}/newsletter/delivery`,
        {
          method: "PUT",
          body: {
            sender_name: nlSenderName,
            sender_email: nlSenderEmail,
            reply_to: nlReplyTo,
          },
        }
      );
      const savedDelivery = deliverySave?.delivery || {};
      setNlEffectiveFrom(String(savedDelivery.effective_from || ""));
      setNlResendConfigured(!!savedDelivery.resend_configured);
      setNlDeliveryStatus(savedDelivery.resend_configured ? "ready" : "not-configured");
      setNlRuntime(savedDelivery.runtime && typeof savedDelivery.runtime === "object" ? savedDelivery.runtime : null);

      if (!privateMode) {
        await authFetch(`/api/orgs/${encodeURIComponent(orgId)}/newsletter`, {
          method: "PUT",
          body: {
            enabled: !!publicNewsletterEnabled,
            list_address: nlListAddress,
            blurb: nlBlurb,
          },
        });
      }

      await authFetch(`/api/orgs/${encodeURIComponent(orgId)}/public/save`, {
        method: "POST",
        body: {
          newsletter_enabled: !!publicNewsletterEnabled,
          newsletter_blurb: nlBlurb,
          show_newsletter_card: !!publicNewsletterEnabled && !!showNewsletterCard,
        },
      });
      setNlMsg("Newsletter settings saved.");
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

  React.useEffect(() => {
    if (tab !== "newsletter" || !orgId) return;
    try {
      const raw = sessionStorage.getItem("bf_newsletter_handoff_v1");
      if (!raw) return;
      const handoff = JSON.parse(raw);
      if (String(handoff?.orgId || "") !== String(orgId)) return;
      if (Date.now() - Number(handoff?.createdAt || 0) > 30 * 60 * 1000) {
        sessionStorage.removeItem("bf_newsletter_handoff_v1");
        return;
      }

      const postTitle = String(handoff?.title || "New article").trim();
      const postUrl = String(handoff?.url || "").trim();
      setNlSubject(postTitle);
      setNlDraft([
        String(nlBlurb || "").trim(),
        postTitle,
        "",
        postUrl ? `Read the full article:\n${postUrl}` : "",
        "",
        "In solidarity,",
        String(orgName || "").trim(),
      ].filter(Boolean).join("\n\n"));
      setNlMsg(`Newsletter draft prepared from “${postTitle}”. Review it before sending.`);
      sessionStorage.removeItem("bf_newsletter_handoff_v1");
    } catch {
      sessionStorage.removeItem("bf_newsletter_handoff_v1");
    }
  }, [tab, orgId, orgName, nlBlurb]);

  const csvHref = orgId
    ? `/#/org/${encodeURIComponent(orgId)}/settings?tab=newsletter`
    : "";

  const csvDownloadUrl = orgId
    ? `/api/orgs/${encodeURIComponent(orgId)}/newsletter/subscribers?format=csv`
    : "";

  const sendNewsletter = async () => {
    if (!orgId) return;

    const subject = String(nlSubject || "").trim();
    const body = String(nlDraft || "").trim();
    const recipients = subscribers
      .map((subscriber) => ({
        id: String(subscriber?.id || "").trim(),
        email: String(subscriber?.email || "").trim(),
      }))
      .filter((recipient) => recipient.id && recipient.email && recipient.email !== "__encrypted__");

    const recipientCount = new Set(recipients.map((recipient) => recipient.email.toLowerCase())).size;

    if (!subject) {
      setNlMsg("Add a subject before sending.");
      return;
    }
    if (!body) {
      setNlMsg("Write the newsletter before sending.");
      return;
    }
    if (!recipientCount) {
      setNlMsg("There are no readable subscriber addresses to send to.");
      return;
    }

    const confirmed = window.confirm(
      `Send this newsletter from ${nlEffectiveFrom || nlSenderEmail || "the configured sender"} to ${recipientCount} subscriber${recipientCount === 1 ? "" : "s"}?`
    );
    if (!confirmed) return;

    setNlBusy(true);
    setNlMsg("");
    try {
      const result = await authFetch(
        `/api/orgs/${encodeURIComponent(orgId)}/newsletter/send`,
        {
          method: "POST",
          body: {
            subject,
            body,
            recipients,
            campaignId: crypto.randomUUID(),
          },
        }
      );

      const sent = Number(result?.sent || 0);
      const suppressed = Number(result?.suppressed || 0);
      if (sent === 0 && suppressed > 0) {
        setNlMsg(`No email sent. ${suppressed} unsubscribed address${suppressed === 1 ? " was" : "es were"} suppressed.`);
      } else {
        setNlMsg(
          `Sent to ${sent} subscriber${sent === 1 ? "" : "s"} through Resend.` +
          (suppressed ? ` ${suppressed} unsubscribed address${suppressed === 1 ? " was" : "es were"} skipped.` : "")
        );
      }
    } catch (error) {
      const code = String(error?.message || "");
      if (code.includes("RESEND_NOT_CONFIGURED")) {
        setNlMsg("Resend is not configured on the server.");
      } else if (code.includes("validation_error") || code.includes("restricted_api_key")) {
        setNlMsg("Resend rejected the send. Check the verified sender domain and API key permissions.");
      } else {
        setNlMsg(code || "Newsletter send failed.");
      }
    } finally {
      setNlBusy(false);
    }
  };

  const copyNewsletterDraft = async () => {
    const subject = String(nlSubject || "").trim();
    const body = String(nlDraft || "").trim();
    const text = [subject ? `Subject: ${subject}` : "", body].filter(Boolean).join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      setNlMsg("Draft copied.");
    } catch {
      setNlMsg("Could not copy the draft. Select the text manually instead.");
    }
  };

  const copySubscriberEmails = async () => {
    const emails = subscribers
      .map((subscriber) => String(subscriber?.email || "").trim())
      .filter((email) => email && email !== "__encrypted__");
    if (!emails.length) {
      setNlMsg("There are no subscriber addresses to copy.");
      return;
    }
    try {
      await navigator.clipboard.writeText(emails.join("\n"));
      setNlMsg(`Copied ${emails.length} subscriber address${emails.length === 1 ? "" : "es"}.`);
    } catch {
      setNlMsg("Could not copy subscriber addresses.");
    }
  };

  const removeSubscriber = async (subscriber) => {
    const id = String(subscriber?.id || "").trim();
    if (!id || !orgId) return;
    if (!window.confirm(`Remove ${subscriber?.email || "this subscriber"} from Bondfire's website signup list?`)) return;
    setNlBusy(true);
    setNlMsg("");
    try {
      await authFetch(
        newsletterPrivateMode
          ? `/api/orgs/${encodeURIComponent(orgId)}/privacy/submissions`
          : `/api/orgs/${encodeURIComponent(orgId)}/newsletter/subscribers`,
        {
          method: "DELETE",
          body: { id },
        }
      );
      await loadSubscribers();
      setNlMsg("Subscriber removed from Bondfire.");
    } catch (error) {
      setNlMsg(error?.message || "Could not remove subscriber.");
    } finally {
      setNlBusy(false);
    }
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
      {/* Section submenu. Newsletter is intentionally standalone in the global drawer. */}
      {tabs.length > 0 ? (
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
      ) : null}

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

          <div className="row" style={{ gap: 8, alignItems: "end", flexWrap: "wrap" }}>
            <label className="grid" style={{ gap: 6, minWidth: 180 }}>
              <span className="helper">Role for this invite</span>
              <select className="input" value={inviteRole} onChange={(event) => setInviteRole(event.target.value)} disabled={inviteBusy}>
                <option value="viewer">Viewer · read only</option>
                <option value="member">Member · standard access</option>
                <option value="admin">Admin · manage organization</option>
              </select>
            </label>
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
          <p className="helper" style={{ marginTop: -4 }}>
            Member names come from each person&apos;s encrypted organization profile. Internal account IDs stay in the background unless a profile has not been set yet.
          </p>

          {!membersAllowed ? (
            <div className="helper">
              You do not have access to the organization member directory.
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
                <button className="btn" type="button" onClick={() => setTab("profile")}>
                  Edit my profile
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
                  <>
                    <div className="bf-table-desktop">
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Member</th>
                            <th>Contact</th>
                            <th>Role</th>
                            <th>Remove</th>
                          </tr>
                        </thead>
                        <tbody>
                          {members.map((m) => (
                            <tr key={m.userId}>
                              <td>
                                <div style={{ fontWeight: 700 }}>{memberDisplayName(m)}</div>
                                {profileText(m.pronouns) ? <div className="helper">{profileText(m.pronouns)}</div> : null}
                              </td>
                              <td>{memberContact(m) || <span className="helper">Not shared</span>}</td>
                              <td>
                                {canManageMembers ? (
                                  <select
                                    className="input"
                                    value={m.role || "member"}
                                    onChange={(e) => setMemberRole(m.userId, e.target.value, m.role, memberDisplayName(m))}
                                    disabled={membersBusy}
                                  >
                                    <option value="viewer">viewer</option>
                                    <option value="member">member</option>
                                    <option value="admin">admin</option>
                                    <option value="owner" disabled={meMember?.role !== "owner"}>owner</option>
                                  </select>
                                ) : (
                                  <span>{m.role || "member"}</span>
                                )}
                              </td>
                              <td style={{ whiteSpace: "nowrap" }}>
                                {!canManageMembers || m.role === "owner" ? (
                                  <span className="helper">{m.role === "owner" ? "owner" : "—"}</span>
                                ) : (
                                  <button className="btn" type="button" onClick={() => removeMember(m.userId, memberDisplayName(m))} disabled={membersBusy}>
                                    Remove
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="bf-cards-mobile" style={{ marginTop: 12 }}>
                      {members.map((m) => (
                        <div key={m.userId || m.email} className="bf-rowcard">
                          <div className="bf-rowcard-top">
                            <div>
                              <div className="bf-rowcard-title">{memberDisplayName(m)}</div>
                              {profileText(m.pronouns) ? <div className="helper">{profileText(m.pronouns)}</div> : null}
                            </div>
                            {canManageMembers && m.role !== "owner" ? (
                              <button
                                className="btn"
                                type="button"
                                onClick={() => removeMember(m.userId, memberDisplayName(m))}
                                disabled={membersBusy}
                              >
                                Remove
                              </button>
                            ) : null}
                          </div>

                          <div className="bf-two">
                            <div className="bf-field">
                              <div className="bf-field-label">contact</div>
                              <div style={{ overflowWrap: "anywhere" }}>{memberContact(m) || "Not shared"}</div>
                            </div>
                            <div className="bf-field">
                              <div className="bf-field-label">role</div>
                              <div>{m.role || "member"}</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* My Profile */}
      {tab === "profile" && (
        <div className="card" style={{ padding: 16 }}>
          <h2 style={{ marginTop: 0 }}>My Profile</h2>
          <p className="helper" style={{ maxWidth: 720 }}>
            This profile belongs to this organization. It is encrypted with the organization key and is not shown on Bondfire&apos;s public pages. You can use a different name or contact method in another organization.
          </p>

          {!membersAllowed ? (
            <div className="helper">
              Your organization membership could not be loaded.
              {membersMsg ? <div className="error" style={{ marginTop: 8 }}>{membersMsg}</div> : null}
            </div>
          ) : !membersMeUserId ? (
            <div className="helper">Could not identify your membership.</div>
          ) : (
            <form onSubmit={saveMemberProfile} className="grid" style={{ gap: 12, maxWidth: 720 }}>
              <label className="grid" style={{ gap: 6 }}>
                <span className="helper">Display name</span>
                <input
                  className="input"
                  value={profileDraft.name}
                  onChange={(e) => setProfileDraft((current) => ({ ...current, name: e.target.value }))}
                  placeholder="How members should know you"
                  autoComplete="name"
                  required
                />
              </label>

              <div className="bf-two">
                <label className="grid" style={{ gap: 6 }}>
                  <span className="helper">Pronouns (optional)</span>
                  <input
                    className="input"
                    value={profileDraft.pronouns}
                    onChange={(e) => setProfileDraft((current) => ({ ...current, pronouns: e.target.value }))}
                    placeholder="e.g. they/them"
                  />
                </label>
                <label className="grid" style={{ gap: 6 }}>
                  <span className="helper">Contact (optional)</span>
                  <input
                    className="input"
                    value={profileDraft.contact}
                    onChange={(e) => setProfileDraft((current) => ({ ...current, contact: e.target.value }))}
                    placeholder="Email, handle, phone, or other contact"
                  />
                </label>
              </div>

              <label className="grid" style={{ gap: 6 }}>
                <span className="helper">About (optional)</span>
                <textarea
                  className="textarea"
                  rows={4}
                  value={profileDraft.bio}
                  onChange={(e) => setProfileDraft((current) => ({ ...current, bio: e.target.value }))}
                  placeholder="Anything useful for other members to know"
                />
              </label>

              <div className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <button className="btn-red" type="submit" disabled={profileBusy}>
                  {profileBusy ? "Saving…" : "Save profile"}
                </button>
                {profileMsg ? (
                  <span className={profileMsg.toLowerCase().includes("fail") || profileMsg.toLowerCase().includes("could not") ? "error" : "helper"}>
                    {profileMsg}
                  </span>
                ) : null}
              </div>
            </form>
          )}
        </div>
      )}

      {/* Public Page */}
      {tab === "public" && (
        <div className="grid" style={{ gap: 12 }}>
          <section className="card" style={{ padding: 16 }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div>
                <h2 style={{ marginTop: 0, marginBottom: 6 }}>Public Page</h2>
                <p className="helper" style={{ margin: 0 }}>
                  The page is edited live, directly on the public canvas. There is no static HTML field to maintain.
                </p>
              </div>
              {enabled && slug ? (
                <a className="btn-red" data-tour="settings-live-preview" href={`/#/p/${encodeURIComponent(slug)}`} target="_blank" rel="noreferrer">
                  Open live page
                </a>
              ) : null}
            </div>

            <form id="public-page-settings-form" onSubmit={savePublic} className="grid" style={{ gap: 12, marginTop: 16 }}>
              <AdminPublicConfigCard ref={publicConfigRef} />
              <PublicDomainCard slug={slug} />

              <div className="card" style={{ padding: 14 }}>
                <h3 style={{ marginTop: 0, marginBottom: 10 }}>Page availability</h3>
                <div className="grid" style={{ gap: 10 }}>
                  <label className="row" style={{ gap: 8, alignItems: "center" }}>
                    <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
                    <span>Enable public page</span>
                  </label>
                  <label className="grid" style={{ gap: 6 }}>
                    <span className="helper">Share URL (slug)</span>
                    <div className="row" style={{ gap: 8 }}>
                      <input className="input" style={{ flex: 1 }} value={slug} onChange={(event) => setSlug(event.target.value)} placeholder="e.g. red-harbor" />
                      <button type="button" className="btn" onClick={genSlug}>Generate</button>
                    </div>
                    {slug ? <a className="helper" href={`/#/p/${encodeURIComponent(slug)}`} target="_blank" rel="noreferrer">{publicUrl}</a> : null}
                  </label>
                </div>
              </div>

              <div className="row" style={{ gap: 8, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
                <span className={msg && !msg.includes("Saved") ? "error" : "success"}>{msg}</span>
                <button className="btn-red" type="submit">Save page availability</button>
              </div>
            </form>
          </section>
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
              <option value="closed">Status: resolved</option>
              <option value="archived">Status: archived</option>
              <option value="spam">Status: spam</option>
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
                            <option value="closed">resolved</option>
                            <option value="archived">archived</option>
                            <option value="spam">spam</option>
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

                    <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                      {(String(item.contact || "").match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) && <a className="btn" href={`mailto:${encodeURIComponent(item.contact)}`}>Reply by email</a>}
                      <button className="btn" disabled={publicInboxBusy} onClick={() => savePublicInboxItem(item, "closed", document.getElementById(`public-inbox-note-${item.type}-${item.id}`)?.value || "")}>Mark resolved</button>
                      <button className="btn" disabled={publicInboxBusy} onClick={() => savePublicInboxItem(item, "archived", document.getElementById(`public-inbox-note-${item.type}-${item.id}`)?.value || "")}>Archive</button>
                      <PromoteToCase orgId={orgId} item={item} />
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
        <div className="card bf-newsletter-admin" style={{ padding: 16 }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
            <div>
              <h2 style={{ margin: 0 }}>Newsletter</h2>
              <p className="helper" style={{ margin: "6px 0 0", maxWidth: 760 }}>
                Website signups stay in Bondfire as the source of truth. Resend handles confirmation emails and newsletter delivery for this organization.
              </p>
            </div>
            <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span className={publicNewsletterEnabled ? "bf-newsletter-status is-on" : "bf-newsletter-status"}>
                {publicNewsletterEnabled ? "Signups on" : "Signups off"}
              </span>
              <span className={nlDeliveryStatus === "ready" ? "bf-newsletter-status is-on" : "bf-newsletter-status"}>
                {nlDeliveryStatus === "loading"
                  ? "Checking Resend…"
                  : nlDeliveryStatus === "ready"
                    ? "Resend ready"
                    : nlDeliveryStatus === "not-configured"
                      ? "Resend not configured"
                      : "Resend status unavailable"}
              </span>
              <span className="bf-newsletter-status">{subscribers.length} website signup{subscribers.length === 1 ? "" : "s"}</span>
            </div>
          </div>

          <div className="grid" style={{ gap: 14, marginTop: 16 }}>
            <section className="card bf-newsletter-panel" style={{ padding: 14 }}>
              <div className="bf-newsletter-panel-head">
                <div>
                  <h3>Public signup</h3>
                  <p className="helper">Control whether visitors can join from the public Organization Page.</p>
                </div>
              </div>

              <div className="grid" style={{ gap: 10 }}>
                <label className="row bf-newsletter-toggle" style={{ gap: 10, alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={!!publicNewsletterEnabled}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setPublicNewsletterEnabled(checked);
                      if (!checked) setShowNewsletterCard(false);
                    }}
                  />
                  <span>
                    <strong>Accept newsletter signups</strong>
                    <span className="helper">Visitors may submit their name and email through the public site and receive an automatic confirmation email.</span>
                  </span>
                </label>

                <label className="row bf-newsletter-toggle" style={{ gap: 10, alignItems: "center", opacity: publicNewsletterEnabled ? 1 : .55 }}>
                  <input
                    type="checkbox"
                    checked={!!showNewsletterCard}
                    onChange={(event) => setShowNewsletterCard(event.target.checked)}
                    disabled={!publicNewsletterEnabled}
                  />
                  <span>
                    <strong>Show the signup section publicly</strong>
                    <span className="helper">Adds a Stay Connected section to supported public layouts.</span>
                  </span>
                </label>
              </div>
            </section>

            <div className="bf-newsletter-two">
              <section className="card bf-newsletter-panel" style={{ padding: 14 }}>
                <div className="bf-newsletter-panel-head">
                  <div>
                    <h3>Delivery through Resend</h3>
                    <p className="helper">Configure the sender identity used for this organization's confirmation emails and newsletters.</p>
                  </div>
                </div>

                <div className="grid" style={{ gap: 10 }}>
                  <label className="grid" style={{ gap: 6 }}>
                    <span className="helper">Sender name</span>
                    <input
                      className="input"
                      value={nlSenderName}
                      onChange={(event) => setNlSenderName(event.target.value)}
                      placeholder={orgName || "Organization"}
                    />
                  </label>

                  <label className="grid" style={{ gap: 6 }}>
                    <span className="helper">Sender email</span>
                    <input
                      className="input"
                      type="email"
                      value={nlSenderEmail}
                      onChange={(event) => setNlSenderEmail(event.target.value)}
                      placeholder="newsletter@example.org"
                      autoComplete="off"
                      spellCheck="false"
                    />
                  </label>

                  <label className="grid" style={{ gap: 6 }}>
                    <span className="helper">Reply-to <span style={{ opacity: .7 }}>(optional)</span></span>
                    <input
                      className="input"
                      type="email"
                      value={nlReplyTo}
                      onChange={(event) => setNlReplyTo(event.target.value)}
                      placeholder="contact@example.org"
                      autoComplete="off"
                      spellCheck="false"
                    />
                  </label>
                </div>

                <div className="bf-newsletter-note" style={{ marginTop: 12 }}>
                  <strong>Effective From:</strong> {nlEffectiveFrom || "Not configured yet"}
                  <br />
                  If Sender email is blank, Bondfire uses newsletter@ on the organization's verified custom domain when available, then falls back to the host's configured newsletter sender.
                  <br />
                  The sending domain must also be verified with the Resend account used by this Bondfire host.
                </div>

                <p className="helper" style={{ marginBottom: 0, marginTop: 10 }}>
                  Private-mode subscriber addresses remain encrypted at rest. This page decrypts them in your browser; sending passes the addresses to the server only for delivery through Resend without creating a new plaintext subscriber copy in D1.
                </p>

                {nlRuntime ? (
                  <details className="bf-newsletter-note" style={{ marginTop: 12 }}>
                    <summary style={{ cursor: "pointer", fontWeight: 700 }}>Runtime diagnostics</summary>
                    <div className="grid" style={{ gap: 4, marginTop: 8, fontFamily: "monospace", fontSize: 12, overflowWrap: "anywhere" }}>
                      <div>Request hostname: {nlRuntime.request_hostname || "(unknown)"}</div>
                      <div>Request origin: {nlRuntime.request_origin || "(unknown)"}</div>
                      <div>RESEND_API_KEY binding present: {nlRuntime.resend_api_key_binding_present ? "yes" : "no"}</div>
                      <div>RESEND_API_KEY non-empty: {nlRuntime.resend_api_key_nonempty ? "yes" : "no"}</div>
                      <div>JWT_SECRET binding present: {nlRuntime.jwt_secret_binding_present ? "yes" : "no"}</div>
                      <div>D1 binding present: {nlRuntime.d1_binding_present ? "yes" : "no"}</div>
                      <div>BF_PUBLIC binding present: {nlRuntime.bf_public_binding_present ? "yes" : "no"}</div>
                      <div>CF_PAGES: {nlRuntime.cf_pages || "(not exposed to Functions runtime)"}</div>
                      <div>CF_PAGES_BRANCH: {nlRuntime.cf_pages_branch || "(not exposed to Functions runtime)"}</div>
                      <div>CF_PAGES_COMMIT_SHA: {nlRuntime.cf_pages_commit_sha || "(not exposed to Functions runtime)"}</div>
                      <div>CF_PAGES_URL: {nlRuntime.cf_pages_url || "(not exposed to Functions runtime)"}</div>
                      <div>CF-Ray: {nlRuntime.cf_ray || "(unavailable)"}</div>
                      <div>Cloudflare colo: {nlRuntime.cf_colo || "(unavailable)"}</div>
                    </div>
                    <p className="helper" style={{ marginBottom: 0, marginTop: 8 }}>
                      This block exposes only deployment metadata and yes/no binding checks. Secret values are never returned.
                    </p>
                  </details>
                ) : null}

                <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
                  <button className="btn-red" type="button" onClick={saveNewsletter} disabled={nlBusy}>
                    {nlBusy ? "Saving…" : "Save newsletter settings"}
                  </button>
                </div>
              </section>

              <section className="card bf-newsletter-panel" style={{ padding: 14 }}>
                <div className="bf-newsletter-panel-head">
                  <div>
                    <h3>Write and send</h3>
                    <p className="helper">Draft here, then send directly to the current Bondfire subscriber list through Resend.</p>
                  </div>
                </div>

                <label className="grid" style={{ gap: 6 }}>
                  <span className="helper">Subject</span>
                  <input
                    className="input"
                    value={nlSubject}
                    onChange={(event) => setNlSubject(event.target.value)}
                    placeholder={`${orgName || "Organization"} update`}
                  />
                </label>

                <label className="grid" style={{ gap: 6, marginTop: 10 }}>
                  <span className="helper">Message</span>
                  <textarea
                    className="textarea bf-newsletter-compose"
                    rows={12}
                    value={nlDraft}
                    onChange={(event) => setNlDraft(event.target.value)}
                    placeholder="Write the newsletter here…"
                  />
                </label>

                <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
                  <button className="btn-red" type="button" onClick={sendNewsletter} disabled={nlBusy || subscribers.length === 0 || nlDeliveryStatus !== "ready" || !nlEffectiveFrom}>
                    {nlBusy ? "Sending…" : `Send to ${new Set(subscribers.map((subscriber) => String(subscriber?.email || "").trim().toLowerCase()).filter(Boolean)).size} subscriber${new Set(subscribers.map((subscriber) => String(subscriber?.email || "").trim().toLowerCase()).filter(Boolean)).size === 1 ? "" : "s"}`}
                  </button>
                  <button className="btn" type="button" onClick={copyNewsletterDraft}>
                    Copy draft
                  </button>
                  <button
                    className="btn"
                    type="button"
                    onClick={() => {
                      setNlSubject(`${orgName || "Organization"} update`);
                      setNlDraft(defaultNewsletterBody(nlBlurb, orgName || "Organization"));
                    }}
                  >
                    Reset draft
                  </button>
                </div>
              </section>
            </div>

            <section className="card bf-newsletter-panel" style={{ padding: 14 }}>
              <div className="bf-newsletter-panel-head">
                <div>
                  <h3>Website signups</h3>
                  <p className="helper">
                    These are the current website newsletter signups for this organization. Resend receives their addresses only for confirmation and delivery.
                  </p>
                </div>
                <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <button className="btn" type="button" onClick={() => loadSubscribers()} disabled={nlBusy}>Refresh</button>
                  <button className="btn" type="button" onClick={copySubscriberEmails} disabled={nlBusy || subscribers.length === 0}>Copy addresses</button>
                  <button className="btn" type="button" onClick={() => exportSubscribersCsv().catch(console.error)} disabled={nlBusy}>Export CSV</button>
                </div>
              </div>

              {subscribers.length === 0 ? (
                <div className="bf-newsletter-empty">
                  <strong>No website signups yet.</strong>
                  <span>Once the public signup section is enabled, new submissions will appear here.</span>
                </div>
              ) : (
                <>
                  <div className="bf-table-desktop" style={{ marginTop: 12 }}>
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Email</th>
                          <th>Name</th>
                          <th>Joined</th>
                          <th aria-label="Actions"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {subscribers.slice(0, 200).map((subscriber) => (
                          <tr key={subscriber.id || subscriber.email}>
                            <td><code>{subscriber.email}</code></td>
                            <td>{subscriber.name || ""}</td>
                            <td>{subscriber.created_at ? new Date(subscriber.created_at).toLocaleString() : ""}</td>
                            <td style={{ textAlign: "right" }}>
                              <button className="btn" type="button" onClick={() => removeSubscriber(subscriber)} disabled={nlBusy}>Remove</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="bf-cards-mobile" style={{ marginTop: 12 }}>
                    {subscribers.slice(0, 200).map((subscriber) => (
                      <div key={subscriber.id || subscriber.email} className="bf-rowcard">
                        <div className="bf-rowcard-top">
                          <div className="bf-rowcard-title">{subscriber.name || subscriber.email || "Subscriber"}</div>
                          <button className="btn" type="button" onClick={() => removeSubscriber(subscriber)} disabled={nlBusy}>Remove</button>
                        </div>
                        <div className="bf-field">
                          <div className="bf-field-label">email</div>
                          <div style={{ overflowWrap: "anywhere" }}>{subscriber.email || ""}</div>
                        </div>
                        {subscriber.name ? (
                          <div className="bf-field">
                            <div className="bf-field-label">name</div>
                            <div>{subscriber.name}</div>
                          </div>
                        ) : null}
                        <div className="bf-field">
                          <div className="bf-field-label">joined</div>
                          <div style={{ opacity: .85 }}>{subscriber.created_at ? new Date(subscriber.created_at).toLocaleString() : ""}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {subscribers.length > 200 ? (
                <div className="helper" style={{ marginTop: 8 }}>
                  Showing first 200. Export CSV for the full list.
                </div>
              ) : null}
            </section>

            {nlMsg ? (
              <div className={nlMsg.toLowerCase().includes("fail") || nlMsg.toLowerCase().includes("could not") ? "error" : "bf-newsletter-save-message"} role="status">
                {nlMsg}
              </div>
            ) : null}
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
