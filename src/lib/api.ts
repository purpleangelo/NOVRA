import "server-only";
import { z } from "zod";
import { currentUser } from "./auth/session";
import { brandScope, BrandNotFoundError, NotFoundError } from "./brands/scope";
import { getDb } from "./db";
import { getStorage, keyBelongsToBrand } from "./storage";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** For route handlers: signed-in operator + brand scope, or an HTTP error. */
export async function apiBrand(brandId: string) {
  if (!(await currentUser())) throw new HttpError(401, "Not signed in");
  if (!z.string().uuid().safeParse(brandId).success) throw new HttpError(404, "Not found");
  try {
    return await brandScope(getDb(), brandId);
  } catch (e) {
    if (e instanceof BrandNotFoundError) throw new HttpError(404, "Not found");
    throw e;
  }
}

export function handleApiError(e: unknown) {
  if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
  if (e instanceof NotFoundError) return Response.json({ error: "Not found" }, { status: 404 });
  console.error(e);
  return Response.json({ error: "Server error" }, { status: 500 });
}

/** Streams a stored file after checking the key belongs to the brand. */
export async function fileResponse(brandId: string, key: string, mime: string, fileName: string, download = false) {
  if (!keyBelongsToBrand(key, brandId)) throw new HttpError(404, "Not found");
  const data = await getStorage().get(key);
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": mime,
      "Content-Length": String(data.length),
      "Cache-Control": "private, max-age=3600",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}"`,
      "X-Content-Type-Options": "nosniff",
      ...(mime === "image/svg+xml" ? { "Content-Security-Policy": "script-src 'none'" } : {}),
    },
  });
}
