import React from "react";
import LivePublicPageEditor from "./LivePublicPageEditor.jsx";
import { api } from "../utils/api.js";

async function checkEditorAccess(slug) {
  try {
    const data = await api("/api/public/" + encodeURIComponent(slug) + "/editor", { method: "GET" });
    return data?.allowed ? data : null;
  } catch {
    return null;
  }
}

export default function PublicPageAdminBar({ slug, initialData, children, onPublished }) {
  const [access, setAccess] = React.useState(() => initialData?.editor?.allowed ? initialData.editor : null);
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    const initialAccess = initialData?.editor?.allowed ? initialData.editor : null;
    setAccess(initialAccess);
    checkEditorAccess(slug)
      .then((result) => { if (active && result) setAccess(result); })
      .catch(() => { /* Public visitors simply receive no admin bar. */ });
    return () => { active = false; };
  }, [slug, initialData?.editor?.allowed, initialData?.editor?.orgId]);

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
