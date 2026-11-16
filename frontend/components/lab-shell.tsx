"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, ChevronRight, Menu, X } from "lucide-react";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme";
import { modules } from "@/lib/modules";

function LabMenu({ path, close }: { path: string; close?: () => void }) {
  return <nav className="lab-menu" aria-label="Workspace modules">
    {modules.map(({ group, items }) => <div className="lab-menu-group" key={group}>
      <span className="eyebrow">{group}</span>
      {items.map(({ route, label, icon: Icon }) => {
        const href = route ? `/lab/${route}` : "/lab";
        return <Link href={href} prefetch={false} aria-current={path === href ? "page" : undefined} key={label} onClick={close}><Icon size={17} strokeWidth={1.65} /><span>{label}</span></Link>;
      })}
    </div>)}
  </nav>;
}

export function LabShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const selected = modules.flatMap((section) => [...section.items]).find(({ route }) => path === (route ? `/lab/${route}` : "/lab"));
  useEffect(() => {
    const drawer = dialog.current;
    if (open && drawer && !drawer.open) drawer.showModal();
    if (!open && drawer?.open) drawer.close();
  }, [open]);
  return <div className="lab-shell">
    <aside className="lab-sidebar">
      <div className="lab-brand"><Brand /></div>
      <LabMenu path={path} />
      <Link className="lab-home" href="/"><ArrowLeft size={16} /> Research overview</Link>
    </aside>
    <dialog className="lab-drawer" ref={dialog} onClose={() => setOpen(false)} aria-label="Workspace navigation">
      <div className="lab-brand"><Brand /><Button variant="ghost" size="icon" aria-label="Close navigation" onClick={() => setOpen(false)}><X size={20} /></Button></div>
      <LabMenu path={path} close={() => setOpen(false)} />
      <Link className="lab-home" href="/" onClick={() => setOpen(false)}><ArrowLeft size={16} /> Research overview</Link>
    </dialog>
    <div className="lab-content">
      <header className="lab-top">
        <div className="crumb">
          <Button className="drawer-toggle" variant="ghost" size="icon" aria-label="Open navigation" aria-expanded={open} onClick={() => setOpen(true)}><Menu size={21} /></Button>
          <Link href="/lab">Workspace</Link><ChevronRight size={14} /><span>{selected?.label ?? (path === "/workspace" ? "My workspace" : "Module")}</span>
        </div>
        <div className="nav-actions"><ThemeToggle /><Button asChild size="small" variant="outline"><Link href="/workspace">My workspace</Link></Button></div>
      </header>
      <main id="main" className="lab-main" tabIndex={-1} key={path}>{children}</main>
    </div>
  </div>;
}
