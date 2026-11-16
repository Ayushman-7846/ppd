"use client";

import Link from "next/link";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/components/theme";
import { Button } from "@/components/ui/button";
import { ProviderSettings } from "@/components/provider-settings";

export function LabSettings() {
  const { theme, change } = useTheme();
  return <>
    <div className="lab-title"><div><h1>Settings</h1><p>Manage model connections, display preferences, and your researcher account.</p></div></div>
    <ProviderSettings />
    <section className="surface dashboard-panel settings-panel"><div className="panel-heading"><div><h2>Appearance</h2><p>Your choice is saved in this browser.</p></div></div>
      <div className="settings-buttons"><Button variant={theme === "dark" ? "primary" : "outline"} aria-pressed={theme === "dark"} onClick={() => change("dark")}><Moon size={17} /> Dark</Button>
      <Button variant={theme === "light" ? "primary" : "outline"} aria-pressed={theme === "light"} onClick={() => change("light")}><Sun size={17} /> Light</Button></div>
    </section>
    <section className="surface dashboard-panel settings-panel"><div className="panel-heading"><div><h2>Researcher account</h2><p>Sign in, register, or review your current profile.</p></div></div><Button asChild variant="outline"><Link href="/workspace">My workspace</Link></Button></section>
  </>;
}
