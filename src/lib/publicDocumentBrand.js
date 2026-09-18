import React from "react";

export function usePublicDocumentBrand(title, iconUrl) {
  React.useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const previousTitle = document.title;
    const nextTitle = String(title || "").trim();
    if (nextTitle) document.title = nextTitle;

    let icon = document.querySelector('link[rel="icon"]');
    const created = !icon;
    if (!icon) {
      icon = document.createElement("link");
      icon.rel = "icon";
      document.head.appendChild(icon);
    }
    const previousHref = icon.getAttribute("href");
    const previousType = icon.getAttribute("type");
    const nextIcon = String(iconUrl || "").trim();
    if (nextIcon) {
      icon.type = "image/png";
      icon.href = nextIcon;
    }

    return () => {
      document.title = previousTitle;
      if (created) icon.remove();
      else {
        if (previousHref == null) icon.removeAttribute("href"); else icon.setAttribute("href", previousHref);
        if (previousType == null) icon.removeAttribute("type"); else icon.setAttribute("type", previousType);
      }
    };
  }, [title, iconUrl]);
}
