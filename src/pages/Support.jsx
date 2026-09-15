import React from "react";
import { useLocation, useParams } from "react-router-dom";
import packageInfo from "../../package.json";
import "./Support.css";

const TYPE_OPTIONS = [
  ["bug", "Bug"],
  ["account", "Account problem"],
  ["feature", "Feature request"],
  ["other", "Other"],
];

const PUBLIC_TYPES = new Set(["bug", "feature"]);
const HOSTED_SUPPORT_EMAIL = "support@bondfireapp.org";
const HOSTED_INFO_EMAIL = "info@bondfireapp.org";
const HOSTED_SECURITY_EMAIL = "security@bondfireapp.org";

function newIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `bf-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function readOrgName(orgId) {
  if (!orgId) return "";
  try {
    const settings = JSON.parse(localStorage.getItem(`bf_org_settings_${orgId}`) || "{}");
    const orgs = JSON.parse(localStorage.getItem("bf_orgs") || "[]");
    const org = Array.isArray(orgs) ? orgs.find((item) => String(item?.id) === String(orgId)) : null;
    return String(settings?.name || org?.name || "").trim();
  } catch {
    return "";
  }
}

function Diagnostics({ value }) {
  return (
    <details className="bf-support-diagnostics" open>
      <summary>Diagnostics that will be attached</summary>
      <dl>
        <div><dt>Bondfire version</dt><dd>{value.version || "Unknown"}</dd></div>
        <div><dt>Current route</dt><dd>{value.route || "Unknown"}</dd></div>
        <div><dt>Browser</dt><dd>{value.userAgent || "Unknown"}</dd></div>
        <div><dt>Deployment mode</dt><dd>{value.deploymentMode || "Unknown"}</dd></div>
        <div><dt>Organization</dt><dd>{value.orgName || "None"}</dd></div>
        <div><dt>Organization ID</dt><dd>{value.orgId || "None"}</dd></div>
        <div><dt>Enabled modules</dt><dd>{value.enabledModules?.length ? value.enabledModules.join(", ") : "None reported"}</dd></div>
      </dl>
      <p className="bf-support-privacy-note">
        Authentication data, cookies, tokens, messages, files, document contents, REC media, FireChat contents, and other private user content are never collected here.
      </p>
    </details>
  );
}

export default function Support() {
  const { orgId } = useParams();
  const location = useLocation();
  const [type, setType] = React.useState("bug");
  const [subject, setSubject] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [replyEmail, setReplyEmail] = React.useState("");
  const [includeDiagnostics, setIncludeDiagnostics] = React.useState(true);
  const [enabledModules, setEnabledModules] = React.useState([]);
  const [config, setConfig] = React.useState({
    loading: true,
    publicSupportEmail: "",
    deploymentMode: "",
    publicIssueEnabled: false,
  });
  const [idempotencyKey, setIdempotencyKey] = React.useState(() => newIdempotencyKey());
  const [status, setStatus] = React.useState({ state: "idle", message: "", issueUrl: "", issueNumber: null });

  React.useEffect(() => {
    let alive = true;
    fetch("/api/support", { credentials: "include", headers: { Accept: "application/json" } })
      .then(async (response) => ({ response, payload: await response.json().catch(() => ({})) }))
      .then(({ response, payload }) => {
        if (!alive) return;
        if (!response.ok || !payload?.ok) {
          setConfig((current) => ({ ...current, loading: false }));
          return;
        }
        setReplyEmail((current) => current || String(payload.replyEmail || ""));
        setConfig({
          loading: false,
          publicSupportEmail: String(payload.publicSupportEmail || ""),
          deploymentMode: String(payload.deploymentMode || ""),
          publicIssueEnabled: Boolean(payload.publicIssueEnabled),
        });
      })
      .catch(() => {
        if (alive) setConfig((current) => ({ ...current, loading: false }));
      });
    return () => { alive = false; };
  }, []);

  React.useEffect(() => {
    let alive = true;
    setEnabledModules([]);
    if (!orgId) return () => { alive = false; };

    fetch(`/api/orgs/${encodeURIComponent(orgId)}/modules`, {
      credentials: "include",
      headers: { Accept: "application/json" },
    })
      .then(async (response) => ({ response, payload: await response.json().catch(() => ({})) }))
      .then(({ response, payload }) => {
        if (!alive || !response.ok || !Array.isArray(payload?.enabled_modules)) return;
        setEnabledModules(payload.enabled_modules.map(String));
      })
      .catch(() => {});

    return () => { alive = false; };
  }, [orgId]);

  const diagnostics = React.useMemo(() => ({
    version: String(packageInfo?.version || ""),
    route: location.pathname || "/",
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
    deploymentMode: config.deploymentMode,
    orgId: orgId ? String(orgId) : "",
    orgName: readOrgName(orgId),
    enabledModules,
  }), [config.deploymentMode, enabledModules, location.pathname, orgId]);

  const isPublic = PUBLIC_TYPES.has(type);
  const hostedDeployment = String(config.deploymentMode || "hosted").toLowerCase() !== "self-hosted";
  const supportEmail = config.publicSupportEmail || (hostedDeployment ? HOSTED_SUPPORT_EMAIL : "");
  const validate = () => {
    if (!subject.trim()) return "Subject is required.";
    if (!description.trim()) return "Description is required.";
    if (!replyEmail.trim()) return "Reply email is required.";
    if (!/^\S+@\S+\.\S+$/.test(replyEmail.trim())) return "Enter a valid reply email.";
    return "";
  };

  const resetForAnother = () => {
    setSubject("");
    setDescription("");
    setIdempotencyKey(newIdempotencyKey());
    setStatus({ state: "idle", message: "", issueUrl: "", issueNumber: null });
  };

  const submit = async (event) => {
    event.preventDefault();
    if (status.state === "submitting") return;

    const validationError = validate();
    if (validationError) {
      setStatus({ state: "error", message: validationError, issueUrl: "", issueNumber: null });
      return;
    }

    setStatus({ state: "submitting", message: "", issueUrl: "", issueNumber: null });
    try {
      const response = await fetch("/api/support", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          type,
          subject: subject.trim(),
          description: description.trim(),
          replyEmail: replyEmail.trim(),
          includeDiagnostics,
          diagnostics: includeDiagnostics ? diagnostics : null,
          idempotencyKey,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) {
        const message = payload?.message || payload?.error || "Support submission failed. Nothing was reported as sent.";
        setStatus({ state: "error", message, issueUrl: "", issueNumber: null });
        return;
      }

      if (payload.kind === "github") {
        setStatus({
          state: "success",
          message: `Public GitHub issue #${payload.issueNumber} was created successfully.`,
          issueUrl: String(payload.issueUrl || ""),
          issueNumber: payload.issueNumber || null,
        });
      } else {
        setStatus({
          state: "success",
          message: "Your private support request was sent successfully.",
          issueUrl: "",
          issueNumber: null,
        });
      }
    } catch {
      setStatus({
        state: "error",
        message: "The server could not be reached. Nothing was reported as sent. You can retry this same submission safely.",
        issueUrl: "",
        issueNumber: null,
      });
    }
  };

  return (
    <main className="bf-support-page">
      <section className="bf-support-hero">
        <p className="bf-support-kicker">BONDFIRE SUPPORT</p>
        <h1>Contact support</h1>
        <p>
          Use this when you need the people operating this Bondfire installation. The floating Help button remains for instructions about the screen you are using.
        </p>
        <div className="bf-support-contacts" aria-label="Bondfire contact addresses">
          {supportEmail ? (
            <p className="bf-support-identity">
              <a href={`mailto:${supportEmail}`}><strong>{supportEmail}</strong></a><br />
              General support, account problems, and private support.
            </p>
          ) : null}
          {hostedDeployment ? (
            <>
              <p className="bf-support-identity">
                <a href={`mailto:${HOSTED_INFO_EMAIL}`}><strong>{HOSTED_INFO_EMAIL}</strong></a><br />
                General questions and information.
              </p>
              <p className="bf-support-identity">
                <a href={`mailto:${HOSTED_SECURITY_EMAIL}`}><strong>{HOSTED_SECURITY_EMAIL}</strong></a><br />
                Security reports and sensitive security-related contact.
              </p>
            </>
          ) : null}
        </div>
      </section>

      <form className="bf-support-form" onSubmit={submit} noValidate>
        <div className="bf-support-field">
          <label htmlFor="support-type">Type</label>
          <select id="support-type" value={type} onChange={(event) => setType(event.target.value)} disabled={status.state === "submitting"}>
            {TYPE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>

        {isPublic ? (
          <div className="bf-support-public-warning" role="note">
            <strong>This report can become a PUBLIC GitHub issue.</strong>
            <span>Your reply email and organization ID/name are not published. Do not put secrets or private information in the subject or description.</span>
            {!config.loading && !config.publicIssueEnabled ? <span>Public issue submission is not configured on this deployment yet.</span> : null}
          </div>
        ) : (
          <div className="bf-support-private-note" role="note">
            <strong>This request stays private.</strong>
            <span>Account problems and Other requests are routed to the configured private support destination and are never turned into GitHub issues.</span>
          </div>
        )}

        <div className="bf-support-field">
          <label htmlFor="support-subject">Subject</label>
          <input
            id="support-subject"
            type="text"
            maxLength={160}
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            disabled={status.state === "submitting"}
            autoComplete="off"
            required
          />
        </div>

        <div className="bf-support-field">
          <label htmlFor="support-description">Description</label>
          <textarea
            id="support-description"
            rows={9}
            maxLength={12000}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={status.state === "submitting"}
            required
          />
        </div>

        <div className="bf-support-field">
          <label htmlFor="support-email">Reply email</label>
          <input
            id="support-email"
            type="email"
            maxLength={254}
            value={replyEmail}
            onChange={(event) => setReplyEmail(event.target.value)}
            disabled={status.state === "submitting"}
            autoComplete="email"
            required
          />
          <p className="bf-support-field-help">Used for private replies only. It is never included in a public GitHub issue.</p>
        </div>

        <label className="bf-support-checkbox" htmlFor="support-diagnostics">
          <input
            id="support-diagnostics"
            type="checkbox"
            checked={includeDiagnostics}
            onChange={(event) => setIncludeDiagnostics(event.target.checked)}
            disabled={status.state === "submitting"}
          />
          <span>
            <strong>Include non-sensitive diagnostics</strong>
            <small>On by default. You can inspect exactly what is attached below.</small>
          </span>
        </label>

        {includeDiagnostics ? <Diagnostics value={diagnostics} /> : null}

        {status.state === "error" ? (
          <div className="bf-support-status is-error" role="alert">{status.message}</div>
        ) : null}
        {status.state === "success" ? (
          <div className="bf-support-status is-success" role="status">
            <span>{status.message}</span>
            {status.issueUrl ? <a href={status.issueUrl} target="_blank" rel="noreferrer">Open issue #{status.issueNumber}</a> : null}
          </div>
        ) : null}

        <div className="bf-support-actions">
          <button type="submit" className="bf-support-submit" disabled={status.state === "submitting" || status.state === "success"}>
            {status.state === "submitting" ? "Submitting…" : isPublic ? "Submit public report" : "Send private support request"}
          </button>
          {status.state === "success" ? (
            <button type="button" className="bf-support-secondary" onClick={resetForAnother}>Submit another</button>
          ) : null}
        </div>
      </form>
    </main>
  );
}
