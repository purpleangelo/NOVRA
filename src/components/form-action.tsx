"use client";

import { useActionState } from "react";
import type { ActionState } from "@/app/actions/brain";
import { Alert } from "./ui/badge";
import { Button, type ButtonProps } from "./ui/button";

/** A form whose only control is a submit button, showing the action's result. */
export function FormAction({
  action,
  label,
  children,
  variant,
  confirm: confirmText,
}: {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  label: string;
  children?: React.ReactNode;
  variant?: ButtonProps["variant"];
  confirm?: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form
      action={formAction}
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        if (confirmText && !window.confirm(confirmText)) e.preventDefault();
      }}
    >
      {children}
      <div>
        <Button type="submit" disabled={pending} variant={variant}>
          {pending ? "Working…" : label}
        </Button>
      </div>
      {state?.error && <Alert variant="error">{state.error}</Alert>}
      {state?.ok && <Alert variant="success">{state.ok}</Alert>}
    </form>
  );
}
