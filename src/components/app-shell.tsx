import Link from "next/link";
import { cookies } from "next/headers";
import { logout } from "@/app/actions/auth";
import { requireUser } from "@/lib/auth/session";
import { getT, getUiLang } from "@/lib/i18n/server";
import { PrefsControls } from "./prefs-controls";
import { Button } from "./ui/button";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const t = await getT();
  const lang = await getUiLang();
  const theme = (await cookies()).get("novra_theme")?.value === "dark" ? "dark" : "light";
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b bg-card/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-4 px-4">
          <Link href="/brands" className="text-lg font-bold tracking-tight">
            NOVRA
          </Link>
          <nav className="flex items-center gap-3 text-sm">
            <Link href="/brands" className="text-muted-foreground hover:text-foreground">
              {t("nav.brands")}
            </Link>
            <Link href="/usage" className="text-muted-foreground hover:text-foreground">
              {t("nav.usage")}
            </Link>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden text-xs text-muted-foreground md:inline">{user.email}</span>
            <PrefsControls lang={lang} theme={theme} toggleLabel={t("theme.toggle")} />
            <form action={logout}>
              <Button variant="outline" size="sm" type="submit">
                {t("nav.logout")}
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1400px] px-4 py-6">{children}</main>
    </div>
  );
}
