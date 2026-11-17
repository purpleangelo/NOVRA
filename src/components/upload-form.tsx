"use client";

import { useActionState } from "react";
import type { ActionState } from "@/app/actions/brain";
import { Alert } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export function UploadForm({
  action,
  accept,
  label,
  multiple = true,
  extra,
}: {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  accept: string;
  label: string;
  multiple?: boolean;
  extra?: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input type="file" name="files" accept={accept} multiple={multiple} className="max-w-sm" aria-label={label} />
        {extra}
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Uploading…" : label}
        </Button>
      </div>
      {state?.error && <Alert variant="error">{state.error}</Alert>}
      {state?.ok && <Alert variant="success">{state.ok}</Alert>}
    </form>
  );
}
