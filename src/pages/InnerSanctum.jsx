import PrivateOrgBoundary from '../components/PrivateOrgBoundary.jsx';
// InnerSanctum.jsx
import React from "react";
import { Outlet } from "react-router-dom";

export default function InnerSanctum() {
  return <PrivateOrgBoundary><Outlet /></PrivateOrgBoundary>;
}
