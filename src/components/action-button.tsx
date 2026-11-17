"use client";

import { useTransition } from "react";
import { Button, type ButtonProps } from "./ui/button";

/** A button that runs a server action (already bound with its arguments). */
export function ActionButton({ action, confirm: confirmText, children, ...props }: ButtonProps & { action: () => Promise<unknown>; confirm?: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      {...props}
      disabled={pending || props.disabled}
      onClick={() => {
        if (confirmText && !window.confirm(confirmText)) return;
        start(async () => {
          await action();
        });
      }}
    >
      {pending ? "…" : children}
    </Button>
  );
}
