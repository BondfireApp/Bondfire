import * as React from "react";
import { PublicPageBuilder } from "./PublicPageBuilder.jsx";

export const PublicSiteContentCard = React.forwardRef(function PublicSiteContentCard(_, ref) {
  return <PublicPageBuilder ref={ref} />;
});
