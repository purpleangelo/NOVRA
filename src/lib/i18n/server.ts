import "server-only";
import { cookies } from "next/headers";
import { translator, type UiLang } from "./dict";

export async function getUiLang(): Promise<UiLang> {
  const jar = await cookies();
  return jar.get("novra_lang")?.value === "id" ? "id" : "en";
}
export async function getT() {
  return translator(await getUiLang());
}
