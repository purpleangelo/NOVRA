"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function BrandNav({ base, items }: { base: string; items: { href: string; label: string }[] }) {
  const path = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto border-b text-sm">
      {items.map((i) => {
        const href = base + i.href;
        const active = i.href === "" ? path === base : path.startsWith(href);
        return (
          <Link
            key={i.href}
            href={href}
            className={cn("whitespace-nowrap border-b-2 px-3 py-2", active ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}
          >
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
