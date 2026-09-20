import React from "react";
import LivePublicPageEditor from "./LivePublicPageEditor.jsx";

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");

async function checkEditorAccess(slug) {
  const response = await fetch(API_BASE + "/api/public/" + encodeURIComponent(slug) + "/editor", {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) return null;
  const data = await response.json().catch(() => ({}));
  return data?.allowed ? data : null;
}

export default function PublicPageAdminBar({ slug, initialData, children, onPublished }) {
  const [access, setAccess] = React.useState(null);
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    setAccess(null);
    checkEditorAccess(slug)
      .then((result) => { if (active) setAccess(result); })
      .catch(() => { if (active) setAccess(null); });
    return () => { active = false; };
  }, [slug]);

  return (
    <>
      {access ? (
        <div className="public-page-admin-bar" role="region" aria-label="Public page administration">
          <div className="public-page-admin-bar-inner">
            <span className="public-page-admin-label">
              <span className="public-page-admin-dot" aria-hidden="true" />
              You are viewing the public page as an administrator
            </span>
            <button className="public-page-edit-button" type="button" onClick={() => setOpen(true)}>
              Edit page
            </button>
          </div>
        </div>
      ) : null}
      {children}
      {open ? (
        <LivePublicPageEditor
          slug={slug}
          orgId={access.orgId}
          initialData={initialData}
          onClose={() => setOpen(false)}
          onPublished={(page) => {
            setOpen(false);
            onPublished?.(page);
          }}
        />
      ) : null}
    </>
  );
}
