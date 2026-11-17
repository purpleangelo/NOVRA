"use client";

import { useActionState } from "react";
import { login } from "@/app/actions/auth";
import { Alert } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";

type Labels = { title: string; email: string; password: string; submit: string; invalid: string; noUser: string };

export function LoginForm({ labels }: { labels: Labels }) {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{labels.title}</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-col gap-3">
          {state?.error && <Alert variant="error">{state.error === "noUser" ? labels.noUser : labels.invalid}</Alert>}
          <Label htmlFor="email">{labels.email}</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={state?.email} key={state?.email} />
          <Label htmlFor="password">{labels.password}</Label>
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
          <Button type="submit" disabled={pending} className="mt-2">
            {labels.submit}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
