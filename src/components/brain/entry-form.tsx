"use client";

import { useActionState } from "react";
import type { ActionState } from "@/app/actions/brain";
import { dataToFormValue, type Field } from "@/lib/brand-brain/fields";
import { Alert } from "../ui/badge";
import { Button } from "../ui/button";
import { Input, Label, Textarea } from "../ui/input";

export function EntryForm({
  fields,
  data,
  action,
  submitLabel,
}: {
  fields: Field[];
  data?: Record<string, unknown>;
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      {state?.error && <Alert variant="error">{state.error}</Alert>}
      {fields.map((f) => {
        const value = dataToFormValue(f, data?.[f.key]);
        const id = `f-${f.key}-${Math.random().toString(36).slice(2, 7)}`;
        if (f.type === "boolean")
          return (
            <label key={f.key} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name={f.key} defaultChecked={data?.[f.key] === true} /> {f.label}
            </label>
          );
        return (
          <div key={f.key} className="flex flex-col gap-1">
            <Label htmlFor={id}>{f.label}</Label>
            {f.type === "text" ? (
              <Input id={id} name={f.key} defaultValue={value} />
            ) : (
              <Textarea id={id} name={f.key} defaultValue={value} rows={f.type === "textarea" ? 3 : 4} />
            )}
            {f.hint && <span className="text-xs text-muted-foreground">{f.hint}</span>}
          </div>
        );
      })}
      <div>
        <Button type="submit" size="sm" disabled={pending}>
          {submitLabel}
        </Button>
        {state?.ok && <span className="ml-3 text-sm text-success">{state.ok}</span>}
      </div>
    </form>
  );
}
