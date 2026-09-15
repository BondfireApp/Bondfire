// src/help/helpContent.js
// Single source of truth for in-app help content.
// IMPORTANT:
// - HelpPanel.jsx uses HELP_TOPICS (and expects blurb + sections)
// - HelpWidget.jsx uses guessTopicIdFromPath

export function guessTopicIdFromPath(pathname) {
  const p = String(pathname || "").toLowerCase();

  if (p.includes("security") || p.includes("zk") || p.includes("keys") || p.includes("settings")) return "security";
  if (p.includes("chat") || p.includes("matrix")) return "chat";
  if (p.includes("inventory")) return "inventory";
  if (p.includes("needs")) return "needs";
  if (p.includes("meetings")) return "meetings";
  if (p.includes("newsletter") || p.includes("public")) return "newsletter";
  if (p.includes("orgs") || p.includes("demo")) return "demo-mode";
  if (p.includes("drive")) return "drive";
  if (p.includes("studio")) return "studio";
  if (p.includes("overview") || p.includes("people") || p.includes("signin") || p.includes("sign-in")) return "getting-started";

  return "getting-started";
}

export const HELP_TOPICS = [
  {
    "id": "demo-mode",
    "title": "Demo Mode",
    "blurb": "Explore Bondfire without an account, reset the sandbox, and use the guided tour.",
    "keywords": ["demo", "tour", "sandbox", "reset", "guide"],
    "sections": [
      {
        "h": "What demo mode is",
        "p": [
          "Demo mode opens a seeded mutual aid workspace without making you create an account.",
          "Changes are saved only in this browser, so you can click around and test real flows without touching production data."
        ]
      },
      {
        "h": "How to learn fast",
        "p": [
          "Start on the dashboard, then open Needs, Meetings, Inventory, and Settings.",
          "Use the Demo banner to reset the sandbox or restart the guided tour at any time."
        ]
      }
    ]
  },
  {
    "id": "getting-started",
    "title": "Getting Started",
    "blurb": "How Bondfire is structured, what to do first, and how to make the dashboard yours.",
    "keywords": [
      "dashboard",
      "org",
      "cards",
      "drag",
      "reorder",
      "layout"
    ],
    "sections": [
      {
        "h": "How Bondfire is organized",
        "p": [
          "Bondfire is built around private org spaces. Once you join or create an org, everything meaningful happens inside that org.",
          "The dashboard is a snapshot of your org: members, inventory, open needs, meetings, pledges, and newsletter growth."
        ]
      },
      {
        "h": "What to do first",
        "p": [
          "If the app feels like a lot, start in this order: People (confirm who is in), Needs (post what you actually require), Meetings (schedule your next coordination moment).",
          "Inventory, pledges, and the public page make more sense once those three are real."
        ]
      },
      {
        "h": "Customize your dashboard",
        "p": [
          "You can drag and drop the top metric cards (People, Inventory, Needs, etc.) to reorder them.",
          "Your layout is saved per organization."
        ]
      }
    ]
  },
  {
    "id": "drive",
    "title": "Drive",
    "blurb": "Bondfire Drive is a compact, Obsidian style workspace for notes, folders, files, templates, and markdown editing inside each org.",
    "keywords": [
      "drive",
      "notes",
      "templates",
      "markdown",
      "files",
      "folders",
      "frontmatter",
      "backlinks"
    ],
    "sections": [
      {
        "h": "What Drive is",
        "p": [
          "Drive is your org workspace for notes, uploaded files, and reusable templates. It is built to feel familiar if you already use markdown based tools like Obsidian, just without the usual desktop app drama.",
          "Explorer and templates live on the left. The editor, preview, and inspector live on the right. Compatible markdown files can be opened, edited, and saved in app."
        ]
      },
      {
        "h": "Templates",
        "p": [
          "Templates can create a brand new note or insert into the current note. Insert keeps your existing note and adds the template content instead of replacing everything.",
          'Supported tokens include <% tp.date.now("YYYY-MM-DD") %>, <% tp.date.now("HH:mm") %>, <% tp.date.now("dddd") %>, <% tp.date.now("YYYY-[W]WW") %>, <% tp.file.title %>, plus the short forms {{date:YYYY-MM-DD}}, {{date:HH:mm}}, {{date:dddd}}, and {{title}}.'
        ]
      },
      {
        "h": "Files and previews",
        "p": [
          "Markdown and other text based uploads open in app so you can edit them directly. PDFs, images, audio, and video preview in app when supported.",
          "If a format is not previewable, Bondfire falls back to opening it in the browser instead of pretending it knows magic."
        ]
      },
      {
        "h": "Properties and backlinks",
        "p": [
          "Frontmatter properties can be viewed and edited without manually digging through raw yaml every time. Backlinks detect wiki style note references so related notes stay connected.",
          "Use the inspector for note metadata and backlinks, and use split view when you want source and rendered markdown side by side."
        ]
      }
    ]
  },
{
  "id": "studio",
  "title": "Studio Basics",
  "blurb": "Build flyers, posts, stories, banners, and reusable visual blocks inside Bondfire Studio.",
  "keywords": ["studio", "design", "flyer", "banner", "pages", "layers", "assets", "export"],
  "sections": [
    {
      "h": "What Studio is for",
      "p": [
        "Studio is Bondfire's built in design workspace for flyers, social posts, stories, banners, and quick org graphics. It is meant to keep common design work inside the app instead of making you jump out to another tool every time you need a meeting flyer or call for volunteers graphic.",
        "Studio supports multiple pages, templates, assets, live Bondfire data bindings, PNG export, PDF export, drag and resize editing, and reusable saved blocks."
      ]
    },
    {
      "h": "How to start",
      "p": [
        "Use Add to place text, shapes, images, QR codes, and guides. Use Templates when you want a faster starting structure instead of a blank page.",
        "Documents live in the Documents panel. Pages stack vertically, and Add Page appears beneath the page list."
      ]
    },
    {
      "h": "How editing works",
      "p": [
        "Click an item to select it. Drag to move. A quick toolbar appears for common actions like duplicate, delete, flip, opacity, and inspector. The inspector covers detailed values like position, size, font settings, fit mode, and colors.",
        "If something is selected, the global help button should follow your current editing context instead of dropping you into generic app help."
      ]
    },
    {
      "h": "What is saved",
      "p": [
        "Studio keeps a local cache for fast recovery and also syncs docs and saved blocks through the org encrypted path when the org key is available.",
        "Exports are plaintext by design, because a PNG or PDF has to be readable outside the app."
      ]
    }
  ]
},
{
  "id": "studio-text",
  "title": "Studio Text Editing",
  "blurb": "Write, style, and bind live org data inside text layers.",
  "keywords": ["studio", "text", "font", "alignment", "line height", "letter spacing", "binding"],
  "sections": [
    {
      "h": "Editing text",
      "p": [
        "Text layers can be edited directly on canvas and more precisely through the inspector. Use the inspector for font family, size, weight, alignment, line height, and letter spacing.",
        "Quick color chips in the top toolbar are for fast edits. The inspector is where you go when the change needs precision."
      ]
    },
    {
      "h": "Live data bindings",
      "p": [
        "Studio text can include Bondfire data tokens like org name, meeting title, date, location, and need details. This lets one design stay reusable while the actual data changes.",
        "Use the Bondfire Data panel to insert tokens and preview how current org data resolves."
      ]
    }
  ]
},
{
  "id": "studio-images",
  "title": "Studio Images and Assets",
  "blurb": "Place uploads, Drive assets, Pixabay images, and editable built in graphics.",
  "keywords": ["studio", "image", "asset", "drive", "pixabay", "background removal", "fit", "qr"],
  "sections": [
    {
      "h": "Asset sources",
      "p": [
        "Built in assets are editable graphics. Drive assets and Pixabay results come in as image layers. Uploads from your device also become image layers.",
        "Image layers support fit mode, opacity, flip, duplicate, delete, and export with the rest of the design."
      ]
    },
    {
      "h": "Background removal",
      "p": [
        "Remove BG runs locally in the browser and works best on people, portraits, and clear foreground subjects. Busy scenes, hard edges, objects, and non human subjects may still need cleanup.",
        "QR layers are intentionally excluded from background removal so they stay scannable."
      ]
    }
  ]
},
{
  "id": "studio-assets",
  "title": "Studio Asset Panels",
  "blurb": "Use built in graphics, Pixabay, Drive assets, templates, docs, and data panels without leaving the editor.",
  "keywords": ["studio", "assets", "templates", "docs", "data", "drive", "pixabay", "built in"],
  "sections": [
    {
      "h": "Panels in Studio",
      "p": [
        "Built in assets are good for shapes, icons, and editable graphics. Pixabay is for quick stock image searching. Drive pulls from your org connected files. Templates jump start common layouts. Documents switch between saved designs. Data inserts live Bondfire tokens into text.",
        "On mobile, these panels open as bottom sheets instead of staying pinned to the side."
      ]
    },
    {
      "h": "Practical use",
      "p": [
        "Use templates when the structure is repetitive. Use Drive when your org already has photos or files ready. Use Pixabay when you need something fast. Use Data when the design should stay reusable across meetings or needs."
      ]
    }
  ]
},
{
  "id": "studio-mobile",
  "title": "Studio on Mobile",
  "blurb": "Phone mode keeps the canvas central and moves tools into bottom sheets and a bottom dock.",
  "keywords": ["studio", "mobile", "phone", "dock", "bottom sheet", "touch", "resize"],
  "sections": [
    {
      "h": "How mobile mode changes things",
      "p": [
        "Studio on mobile hides the desktop side rail and uses a bottom dock for Add, Templates, Assets, Data, Docs, and Edit. The inspector opens as a bottom sheet so the canvas stays visible.",
        "Resize handles are larger on mobile because tiny precision controls on glass are an insult to human thumbs."
      ]
    },
    {
      "h": "Best way to work on a phone",
      "p": [
        "Keep zoom moderate when arranging multiple items. Use templates and data bindings to reduce repetitive typing. Open Edit when you need exact controls instead of trying to do everything directly on canvas.",
        "Mobile Studio is for quick useful work, not heroic suffering."
      ]
    }
  ]
},
  {
    "id": "security",
    "title": "Security & Encryption",
    "blurb": "Plain language explanations of org keys, what encryption protects, and what you are responsible for.",
    "keywords": [
      "encryption",
      "zk",
      "keys",
      "org key",
      "rotate",
      "rewrap",
      "backup"
    ],
    "sections": [
      {
        "h": "What the org key is",
        "p": [
          "An org key is a shared secret used to decrypt sensitive fields in your org. Encrypted fields are stored on the server as unreadable ciphertext.",
          "Decryption happens in your browser only when you have the org key available on that device."
        ]
      },
      {
        "h": "What this protects you from",
        "p": [
          "If the server, database, or logs are exposed, encrypted fields remain unreadable without the org key.",
          "This is designed to reduce harm from platform compromise, accidental admin access, and data leaks."
        ]
      },
      {
        "h": "What this does not protect you from",
        "p": [
          "If someone has access to your unlocked device and browser session, they can read what you can read.",
          "If you share the org key widely, you have effectively lowered your own security."
        ]
      },
      {
        "h": "Backups and recovery",
        "p": [
          "If the org key is lost and nobody has a backup, encrypted data cannot be recovered. There is no admin override. That is the point.",
          "Store a backup offline: password manager, encrypted note, or printed and locked away."
        ]
      },
      {
        "h": "Rotating the org key",
        "p": [
          "Rotating creates a new org key and re-wraps encrypted data so members can read it with the new key.",
          "Rotate when membership changes, when you suspect the key was shared too widely, or after a security incident."
        ]
      }
    ]
  },
  {
    "id": "chat",
    "title": "Chat (Matrix / Element)",
    "blurb": "Bondfire chat uses Matrix. This guide covers creating an Element account, joining rooms, and verification basics.",
    "keywords": [
      "matrix",
      "element",
      "room",
      "invite",
      "verification",
      "encryption"
    ],
    "sections": [
      {
        "h": "What this is",
        "p": [
          "Bondfire chat is powered by Matrix (the open protocol used by Element). Bondfire is not storing your messages or running a proprietary chat stack.",
          "You use a Matrix client (usually Element) and join your org's Matrix room."
        ]
      },
      {
        "h": "Create a Matrix account (Element)",
        "p": [
          "Open app.element.io (web) or install Element on mobile and create an account.",
          "You will get an address like @name:matrix.org. Some homeservers require email verification."
        ]
      },
      {
        "h": "Join your org room",
        "p": [
          "Your org chat is a normal Matrix room. You may join via an invite link, accept an invite from a member, or search by room name or alias in Element.",
          "If you are prompted for a room key or cannot see history, the room may be end-to-end encrypted and your session may need verification."
        ]
      },
      {
        "h": "Verification and encryption (practical version)",
        "p": [
          "If the room is encrypted, verify your Element session so new devices cannot silently impersonate you.",
          "Element will guide you through verifying using a security phrase or emoji comparison between devices. Do that once, then you are usually set."
        ]
      }
    ]
  },
  {
    "id": "inventory",
    "title": "Managing Inventory",
    "blurb": "Track what you have, set par levels for critical items, and let the dashboard warn you early.",
    "keywords": [
      "inventory",
      "par",
      "stock",
      "units",
      "low"
    ],
    "sections": [
      {
        "h": "Par levels",
        "p": [
          "Par is the minimum amount you want to keep on hand. It is not a maximum.",
          "If par is set, the dashboard can flag items when stock drops below that threshold."
        ]
      },
      {
        "h": "Good habits",
        "p": [
          "Use clear item names (Canned beans, not Beans).",
          "Be consistent with units when possible.",
          "Set par only for items you truly want monitored."
        ]
      }
    ]
  },
  {
    "id": "needs",
    "title": "Posting & Managing Needs",
    "blurb": "Make needs actionable, prioritize clearly, and keep the list honest.",
    "keywords": [
      "needs",
      "priority",
      "urgent",
      "status",
      "open",
      "closed"
    ],
    "sections": [
      {
        "h": "Write needs so someone can act",
        "p": [
          "Include what is needed, where it should go, and any timing constraints.",
          "If follow-up is required, include a contact method or where to respond (meeting, chat room, etc.)."
        ]
      },
      {
        "h": "Priority",
        "p": [
          "Higher priority rises to the top. Use it to reflect urgency, not moral importance.",
          "Close needs when fulfilled. Leaving old needs open makes the dashboard useless."
        ]
      }
    ]
  },
  {
    "id": "meetings",
    "title": "Meetings",
    "blurb": "Schedule coordination, keep agendas minimal, and use RSVP for planning attendance.",
    "keywords": [
      "meetings",
      "rsvp",
      "agenda",
      "location"
    ],
    "sections": [
      {
        "h": "What to include",
        "p": [
          "Date and time, plus location (address, link, or call in chat).",
          "Add notes or a short agenda if it helps."
        ]
      },
      {
        "h": "RSVP",
        "p": [
          "RSVP means you are planning to attend. It helps organizers estimate attendance.",
          "It is not a contract. People are allowed to be human."
        ]
      }
    ]
  },
  {
    "id": "newsletter",
    "title": "Newsletter & Public Page",
    "blurb": "Manage subscribers, export CSV for your email tool, and publish only what you mean to publish.",
    "keywords": [
      "newsletter",
      "subscribers",
      "export",
      "csv",
      "public page"
    ],
    "sections": [
      {
        "h": "Newsletter subscribers",
        "p": [
          "Bondfire tracks subscribers tied to your org. You can view recent signups and export subscribers as CSV for your email tool.",
          "The dashboard trend shows subscription movement over the last 14 days."
        ]
      },
      {
        "h": "Public page safety check",
        "p": [
          "Before you publish, confirm you are not exposing personal info or internal-only details.",
          "Public pages are for the internet, not just your members."
        ]
      }
    ]
  }
];

// Backwards-compatible alias if anything imports helpTopics.
export const helpTopics = HELP_TOPICS;
