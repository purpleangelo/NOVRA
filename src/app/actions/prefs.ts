"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

export async function setUiLang(lang: "en" | "id") {
  (await cookies()).set("novra_lang", lang === "id" ? "id" : "en", { path: "/", maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/", "layout");
}

export async function setTheme(theme: "light" | "dark") {
  (await cookies()).set("novra_theme", theme === "dark" ? "dark" : "light", { path: "/", maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/", "layout");
}
