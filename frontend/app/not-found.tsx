import Link from "next/link";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return <main id="main" className="standalone"><Brand /><div className="surface dashboard-panel"><h1>Page unavailable</h1><p>This address does not match a LinguaLens page.</p><Button asChild><Link href="/lab">Open the dashboard</Link></Button></div></main>;
}
