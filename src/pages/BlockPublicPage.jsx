import React from "react";
import PublicPageRenderer from "../components/PublicPageRenderer.jsx";

export default function BlockPublicPage({ slug, initialData, children }) {
  const page = initialData?.public?.page || { blocks: [] };
  React.useEffect(() => {
    const title = page?.meta?.title || initialData?.public?.title || "";
    if (title) document.title = title;
  }, [page?.meta?.title, initialData?.public?.title]);
  return <PublicPageRenderer page={page} slug={slug}>{children}</PublicPageRenderer>;
}
