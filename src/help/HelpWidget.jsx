import React from "react";
import { useLocation } from "react-router-dom";
import HelpPanel from "./HelpPanel.jsx";
import { HELP_TOPICS, guessTopicIdFromPath } from "./helpContent.js";

export default function HelpWidget() {
  const location = useLocation();
  const [hidden, setHidden] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [hovered, setHovered] = React.useState(false);
  const [activeId, setActiveId] = React.useState(() => guessTopicIdFromPath(location.pathname));

  React.useEffect(() => {
    const hide = () => setHidden(true);
    const show = () => setHidden(false);

    window.addEventListener("bf-tour-start", hide);
    window.addEventListener("bf-tour-end", show);

    return () => {
      window.removeEventListener("bf-tour-start", hide);
      window.removeEventListener("bf-tour-end", show);
    };
  }, []);

  React.useEffect(() => {
    setActiveId(guessTopicIdFromPath(location.pathname));
  }, [location.pathname]);

  React.useEffect(() => {
    const onTopic = (e) => {
      const nextId = String(e?.detail?.id || "").trim();
      if (nextId) setActiveId(nextId);
    };
    window.addEventListener("bf-help-topic", onTopic);
    return () => window.removeEventListener("bf-help-topic", onTopic);
  }, []);

  const activeTopic = React.useMemo(() => {
    return HELP_TOPICS.find((topic) => topic.id === activeId) || HELP_TOPICS[0];
  }, [activeId]);

  if (hidden) return null;

  return (
    <>
      <div className="help-widget">
        <button
          type="button"
          className={"help-button" + (open ? " is-open" : "")}
          aria-label={open ? "Close help" : "Open help"}
          aria-expanded={open}
          title={activeTopic?.title || "Help"}
          onClick={() => setOpen((value) => !value)}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          ?
        </button>
        <div className={"help-hover-label" + (hovered && !open ? " is-visible" : "")}>{activeTopic?.title || "Help"}</div>
      </div>
      <HelpPanel open={open} activeId={activeId} setActiveId={setActiveId} onClose={() => setOpen(false)} />
    </>
  );
}
