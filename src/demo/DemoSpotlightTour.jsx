import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { isDemoMode } from "./demoMode.js";
import "./demo.css";

const TOUR_SEEN = "bf_demo_seen_tour_v2";
const STEPS = [
  {
    title: "Welcome to the Bondfire demo",
    body: "This walkthrough highlights the real parts of the app as you move through them. It is short on purpose, because nobody wants a hostage situation.",
  },
  {
    path: "/orgs",
    target: '[data-tour="demo-org-open"]',
    title: "Open the demo org",
    body: "This is your seeded demo workspace. The app is already using it, so this just shows where you would normally enter an org.",
  },
  {
    path: "/org/demo-org/overview",
    target: '[data-tour="nav-needs"]',
    title: "Navigation stays visible",
    body: "This nav is the fastest way around Bondfire. Next we will jump into Needs.",
  },
  {
    path: "/org/demo-org/needs",
    target: '[data-tour="needs-add-form"]',
    title: "Needs are actionable requests",
    body: "Add a need here, then watch it show up around the workspace. This is one of the core loops of the app.",
  },
  {
    path: "/org/demo-org/needs",
    target: '[data-tour="nav-meetings"]',
    title: "Meetings coordinate the work",
    body: "Use the nav to move between operational pages quickly. Next we jump into Meetings.",
  },
  {
    path: "/org/demo-org/meetings",
    target: '[data-tour="meetings-add-form"]',
    title: "Meetings track coordination",
    body: "Create meetings, RSVP, and keep locations and agendas visible to the people doing the work.",
  },
  {
    path: "/org/demo-org/meetings",
    target: '[data-tour="nav-settings"]',
    title: "Settings controls the public side",
    body: "Settings handles members, invites, newsletter, pledges, and the public page configuration.",
  },
  {
    path: "/org/demo-org/settings?tab=public-page",
    target: '[data-tour="settings-live-preview"]',
    title: "Your public page already has a live preview",
    body: "This is the front facing side of the org. It is where people can see needs, meetings, and ways to get involved.",
  },
  {
    path: "/org/demo-org/settings?tab=public-page",
    target: '[data-tour="help-fab"]',
    title: "Help follows you",
    body: "The help button is route aware. Open it any time or restart this tour from the Demo banner.",
  },
];

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function sameRoute(loc, target) {
  const here = `${loc.pathname || ""}${loc.search || ""}`;
  return here === target;
}

function intersects(a, b) {
  return !(
    a.left + a.width <= b.left ||
    b.left + b.width <= a.left ||
    a.top + a.height <= b.top ||
    b.top + b.height <= a.top
  );
}

function placeTooltip(vw, vh, rect) {
  const gutter = 12;
  const cardWidth = Math.min(380, vw - 24);
  const cardHeightGuess = 250;
  const helpSafe = { left: vw - 92, top: vh - 92, width: 80, height: 80 };

  let tooltip = { left: Math.max(gutter, (vw / 2) - (cardWidth / 2)), top: Math.max(gutter, (vh / 2) - 120), width: cardWidth };

  if (rect) {
    const below = rect.top + rect.height + 16;
    const above = rect.top - cardHeightGuess - 16;
    const centeredLeft = clamp(rect.left + (rect.width / 2) - (cardWidth / 2), gutter, vw - cardWidth - gutter);
    const top = above > gutter ? above : Math.min(vh - cardHeightGuess - gutter, below);
    tooltip = { left: centeredLeft, top, width: cardWidth };
  }

  let box = { left: tooltip.left, top: tooltip.top, width: tooltip.width, height: cardHeightGuess };

  if (intersects(box, helpSafe)) {
    const moveLeft = clamp(vw - cardWidth - 108, gutter, vw - cardWidth - gutter);
    const moveUp = clamp(vh - cardHeightGuess - 108, gutter, vh - cardHeightGuess - gutter);

    // Prefer moving away from the bottom-right help button without drifting wildly.
    if (box.left > vw / 2) {
      tooltip.left = moveLeft;
    }
    if (box.top > vh / 2) {
      tooltip.top = moveUp;
    }

    box = { left: tooltip.left, top: tooltip.top, width: tooltip.width, height: cardHeightGuess };

    // Last resort, shove it toward upper-left safe zone.
    if (intersects(box, helpSafe)) {
      tooltip.left = gutter;
      tooltip.top = Math.max(gutter, Math.min(tooltip.top, vh - cardHeightGuess - 112));
    }
  }

  tooltip.left = clamp(tooltip.left, gutter, vw - cardWidth - gutter);
  tooltip.top = clamp(tooltip.top, gutter, vh - cardHeightGuess - gutter);
  return tooltip;
}

export default function DemoSpotlightTour() {
  const navigate = useNavigate();
  const loc = useLocation();
  const [open, setOpen] = React.useState(() => {
    try { return isDemoMode() && !localStorage.getItem(TOUR_SEEN); } catch { return false; }
  });
  const [step, setStep] = React.useState(0);
  const [rect, setRect] = React.useState(null);

  const current = STEPS[Math.max(0, Math.min(step, STEPS.length - 1))];

  React.useEffect(() => {
    const onOpen = () => { setStep(0); setOpen(true); };
    window.addEventListener("bf-demo-tour-open", onOpen);
    return () => window.removeEventListener("bf-demo-tour-open", onOpen);
  }, []);

  React.useEffect(() => {
    if (!open || !isDemoMode()) return;
    if (current?.path && !sameRoute(loc, current.path)) {
      navigate(current.path, { replace: false });
    }
  }, [open, current?.path, loc.pathname, loc.search, navigate]);

  React.useEffect(() => {
    if (!open || !isDemoMode()) return;
    if (!current?.target) {
      setRect(null);
      return;
    }
    let raf = 0;
    let attempts = 0;
    const update = () => {
      const el = document.querySelector(current.target);
      if (el) {
        try { el.scrollIntoView({ block: "center", inline: "center", behavior: attempts < 2 ? "auto" : "smooth" }); } catch {}
        const r = el.getBoundingClientRect();
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
      } else {
        setRect(null);
      }
      attempts += 1;
      if (attempts < 40 && !document.querySelector(current.target)) raf = requestAnimationFrame(update);
    };
    const onViewport = () => {
      const el = document.querySelector(current.target);
      if (!el) return;
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    update();
    window.addEventListener("resize", onViewport);
    window.addEventListener("scroll", onViewport, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onViewport);
      window.removeEventListener("scroll", onViewport, true);
    };
  }, [open, step, current?.target, loc.pathname, loc.search]);

  if (!open || !isDemoMode()) return null;

  const close = () => {
    setOpen(false);
    try { localStorage.setItem(TOUR_SEEN, "1"); } catch {}
  };

  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const tooltip = placeTooltip(vw, vh, rect);

  return (
    <div className="bf-demo-spotlight-root">
      <div className="bf-demo-spotlight-backdrop" />
      {rect ? (
        <div
          className="bf-demo-spotlight-ring"
          style={{ top: Math.max(8, rect.top - 8), left: Math.max(8, rect.left - 8), width: rect.width + 16, height: rect.height + 16 }}
        />
      ) : null}
      <div className="bf-demo-spotlight-card" style={{ left: tooltip.left, top: tooltip.top, width: tooltip.width }}>
        <div className="bf-demo-tour-kicker">Guided Tour</div>
        <h3>{current.title}</h3>
        <p>{current.body}</p>
        <div className="bf-demo-tour-progress">Step {step + 1} of {STEPS.length}</div>
        <div className="bf-demo-tour-actions">
          <button className="btn" type="button" onClick={close}>Skip</button>
          {step > 0 ? <button className="btn" type="button" onClick={() => setStep((v) => Math.max(0, v - 1))}>Back</button> : null}
          {step < STEPS.length - 1 ? (
            <button className="btn-red" type="button" onClick={() => setStep((v) => Math.min(STEPS.length - 1, v + 1))}>Next</button>
          ) : (
            <button className="btn-red" type="button" onClick={close}>Done</button>
          )}
        </div>
      </div>
    </div>
  );
}
