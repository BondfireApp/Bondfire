import React from "react";
import { isDemoMode } from "./demoMode.js";
import "./demo.css";

const TOUR_SEEN = "bf_demo_seen_tour_v1";
const STEPS = [
  { title: "Welcome to the Bondfire demo", body: "This is a seeded mutual aid workspace you can explore safely. Changes save only in this browser." },
  { title: "Use the dashboard first", body: "The dashboard shows the core loop: people, inventory, needs, meetings, pledges, inbox, and newsletter movement." },
  { title: "Learn by doing", body: "Open Needs, Meetings, Inventory, or People and add or edit real demo data. The point is to click around without fear." },
  { title: "Settings shows the public side", body: "Under Settings you can test invites, members, newsletter, pledges, and your public page configuration. Your live preview button is still there." },
  { title: "Help follows you", body: "Use the help button any time. It opens route aware help, and you can restart this tour from the Demo banner or help panel." },
];

export default function DemoGuideOverlay() {
  const [open, setOpen] = React.useState(() => {
    try { return isDemoMode() && !localStorage.getItem(TOUR_SEEN); } catch { return false; }
  });
  const [step, setStep] = React.useState(0);

  React.useEffect(() => {
    const onOpen = () => { setStep(0); setOpen(true); };
    window.addEventListener("bf-demo-tour-open", onOpen);
    return () => window.removeEventListener("bf-demo-tour-open", onOpen);
  }, []);

  if (!open || !isDemoMode()) return null;
  const s = STEPS[Math.max(0, Math.min(step, STEPS.length - 1))];
  const close = () => { setOpen(false); try { localStorage.setItem(TOUR_SEEN, "1"); } catch {} };

  return (
    <div className="bf-demo-tour-backdrop">
      <div className="bf-demo-tour-card">
        <div className="bf-demo-tour-kicker">Guided Tour</div>
        <h3>{s.title}</h3>
        <p>{s.body}</p>
        <div className="bf-demo-tour-progress">Step {step + 1} of {STEPS.length}</div>
        <div className="bf-demo-tour-actions">
          <button className="btn" type="button" onClick={close}>Skip</button>
          {step > 0 ? <button className="btn" type="button" onClick={() => setStep((v) => Math.max(0, v - 1))}>Back</button> : null}
          {step < STEPS.length - 1 ? <button className="btn-red" type="button" onClick={() => setStep((v) => Math.min(STEPS.length - 1, v + 1))}>Next</button> : <button className="btn-red" type="button" onClick={close}>Start Exploring</button>}
        </div>
      </div>
    </div>
  );
}
