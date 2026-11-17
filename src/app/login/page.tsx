import { getT } from "@/lib/i18n/server";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const t = await getT();
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <h1 className="text-3xl font-bold tracking-tight">NOVRA</h1>
        <p className="mb-6 text-sm text-muted-foreground">{t("app.tagline")}</p>
        <LoginForm labels={{ title: t("login.title"), email: t("login.email"), password: t("login.password"), submit: t("login.submit"), invalid: t("login.invalid"), noUser: t("login.noUser") }} />
      </div>
    </main>
  );
}
