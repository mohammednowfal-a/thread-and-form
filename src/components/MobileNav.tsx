"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

export function MobileNav({ links }: { links: { href: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="lg:hidden">
      <button type="button" className="btn-outline btn-sm" aria-expanded={open} aria-controls="mobile-menu" onClick={() => setOpen((o) => !o)}>
        {open ? "Close" : "Menu"}
      </button>
      {open && (
        <nav id="mobile-menu" aria-label="Main" className="absolute left-0 right-0 top-full z-40 border-b border-fog bg-chalk shadow-lg">
          <ul className="container-x flex flex-col py-2">
            {links.map((l) => (
              <li key={l.href}><Link href={l.href} onClick={() => setOpen(false)} className="flex min-h-[48px] items-center border-b border-fog/60 text-base no-underline">{l.label}</Link></li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}
