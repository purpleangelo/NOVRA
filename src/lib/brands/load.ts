import "server-only";
import { notFound } from "next/navigation";
import { cache } from "react";
import { z } from "zod";
import { requireUser } from "../auth/session";
import { getDb } from "../db";
import { brandScope, BrandNotFoundError } from "./scope";

/** Loads a brand for the signed-in operator and returns its BrandScope. 404 for unknown ids. */
export const loadBrand = cache(async (brandId: string) => {
  await requireUser();
  if (!z.string().uuid().safeParse(brandId).success) notFound();
  try {
    return await brandScope(getDb(), brandId);
  } catch (e) {
    if (e instanceof BrandNotFoundError) notFound();
    throw e;
  }
});
