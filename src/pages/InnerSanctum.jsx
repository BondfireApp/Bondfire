import PrivateOrgBoundary from '../components/PrivateOrgBoundary.jsx';
// InnerSanctum.jsx
import React from "react";
import { Outlet, useLocation, useParams } from "react-router-dom";
import BondfireChat from "./BondfireChat.jsx";

export default function InnerSanctum() {
  const { orgId } = useParams();
  const location = useLocation();
  const [fireChatEnabled, setFireChatEnabled] = React.useState(false);

  React.useEffect(() => {
    let alive = true;

    const loadModules = async () => {
      if (!orgId) {
        if (alive) setFireChatEnabled(false);
        return;
      }

      try {
        const response = await fetch(`/api/orgs/${encodeURIComponent(orgId)}/modules`, {
          credentials: "include",
          headers: { Accept: "application/json" },
        });
        const payload = await response.json().catch(() => ({}));
        if (!alive) return;
        if (!response.ok || !Array.isArray(payload?.enabled_modules)) {
          setFireChatEnabled(false);
          return;
        }
        setFireChatEnabled(
          payload.enabled_modules.map(String).includes("bondfire-chat")
        );
      } catch {
        if (alive) setFireChatEnabled(false);
      }
    };

    const onModulesChanged = (event) => {
      const changedOrgId = event?.detail?.orgId;
      if (changedOrgId && String(changedOrgId) !== String(orgId)) return;
      loadModules();
    };

    loadModules();
    window.addEventListener("bf:modules_changed", onModulesChanged);

    return () => {
      alive = false;
      window.removeEventListener("bf:modules_changed", onModulesChanged);
    };
  }, [orgId]);

  const onFullChatRoute = /\/org\/[^/]+\/chat\/?$/i.test(location.pathname || "");

  return (
    <PrivateOrgBoundary>
      <Outlet />
      {fireChatEnabled && !onFullChatRoute ? <BondfireChat floating /> : null}
    </PrivateOrgBoundary>
  );
}
