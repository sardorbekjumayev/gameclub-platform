"use client";

import { ClubDashboard } from "@/components/dashboards/club";
import { DeskDashboard } from "@/components/dashboards/desk";
import { PlatformDashboard } from "@/components/dashboards/platform";
import { PANEL } from "@/lib/panel";

/** Har bir panelning o'z bosh sahifasi. */
export default function Dashboard() {
  if (PANEL === "platform") return <PlatformDashboard />;
  if (PANEL === "desk") return <DeskDashboard />;
  return <ClubDashboard />;
}
