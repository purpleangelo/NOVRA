"use client";

import { Moon, Sun } from "lucide-react";
import { useTransition } from "react";
import { setTheme, setUiLang } from "@/app/actions/prefs";
import { Button } from "./ui/button";

export function PrefsControls({ lang, theme, toggleLabel }: { lang: "en" | "id"; theme: "light" | "dark"; toggleLabel: string }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() => start(() => setUiLang(lang === "en" ? "id" : "en"))}
        aria-label="Switch UI language"
      >
        {lang === "en" ? "ID" : "EN"}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={toggleLabel}
        disabled={pending}
        onClick={() => {
          const next = theme === "dark" ? "light" : "dark";
          document.documentElement.classList.toggle("dark", next === "dark");
          start(() => setTheme(next));
        }}
      >
        {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
      </Button>
    </div>
  );
}
