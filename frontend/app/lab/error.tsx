"use client";

import { Button } from "@/components/ui/button";

export default function LabError({ reset }: { reset: () => void }) {
  return <div className="surface dashboard-panel"><h1>Module unavailable</h1><p>The research module failed to load.</p><Button onClick={reset}>Try again</Button></div>;
}
