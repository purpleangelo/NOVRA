import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", {
  variants: {
    variant: {
      default: "border-transparent bg-primary text-primary-foreground",
      secondary: "border-transparent bg-muted text-foreground",
      outline: "text-foreground",
      success: "border-transparent bg-success/15 text-success",
      warning: "border-transparent bg-warning/20 text-foreground",
      destructive: "border-transparent bg-destructive/15 text-destructive",
    },
  },
  defaultVariants: { variant: "default" },
});

export function Badge({ className, variant, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export function Alert({ className, variant = "info", ...props }: React.HTMLAttributes<HTMLDivElement> & { variant?: "info" | "warning" | "error" | "success" }) {
  const styles = {
    info: "border-primary/30 bg-accent",
    warning: "border-warning/50 bg-warning/10",
    error: "border-destructive/50 bg-destructive/10 text-destructive",
    success: "border-success/50 bg-success/10",
  }[variant];
  return <div role="alert" className={cn("rounded-md border px-4 py-3 text-sm", styles, className)} {...props} />;
}
