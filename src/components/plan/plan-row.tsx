"use client";

import { useActionState } from "react";
import type { ActionState } from "@/app/actions/brain";
import { Button } from "../ui/button";
import { Input, Select } from "../ui/input";

export type RowValues = { date: string; pillar: string; format: string; angle: string; goal: string };

const FORMATS = [
  ["short_video", "Short video"],
  ["carousel", "Carousel"],
  ["single_image", "Single image"],
] as const;
const GOALS = ["awareness", "engagement", "leads"] as const;

/** One editable plan row (also used for "add row"). */
export function PlanRowForm({
  values,
  pillars,
  action,
  submitLabel,
  children,
  locked,
}: {
  values: RowValues;
  pillars: string[];
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  submitLabel: string;
  children?: React.ReactNode;
  locked?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const listId = `pillars-${Math.random().toString(36).slice(2, 7)}`;
  return (
    <form action={formAction} className="grid grid-cols-[8.5rem_9rem_8rem_1fr_7.5rem_auto] items-start gap-2 border-t py-2 text-sm max-lg:grid-cols-2" data-testid="plan-row">
      <Input name="date" type="date" defaultValue={values.date} disabled={locked} required />
      <Input name="pillar" defaultValue={values.pillar} list={listId} disabled={locked} required />
      <datalist id={listId}>
        {pillars.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
      <Select name="format" defaultValue={values.format} disabled={locked}>
        {FORMATS.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </Select>
      <Input name="angle" defaultValue={values.angle} disabled={locked} required minLength={5} className="max-lg:col-span-2" />
      <Select name="goal" defaultValue={values.goal} disabled={locked}>
        {GOALS.map((g) => (
          <option key={g} value={g}>
            {g}
          </option>
        ))}
      </Select>
      <div className="flex items-center gap-1">
        {!locked && (
          <Button type="submit" size="sm" variant="outline" disabled={pending}>
            {submitLabel}
          </Button>
        )}
        {children}
      </div>
      {state?.error && <div className="col-span-full text-xs text-destructive">{state.error}</div>}
    </form>
  );
}
