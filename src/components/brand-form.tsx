"use client";

import { useActionState } from "react";
import type { FormState } from "@/app/actions/brands";
import { Alert } from "./ui/badge";
import { Button } from "./ui/button";
import { Input, Label, Select } from "./ui/input";

type BrandValues = {
  name: string;
  languages: string[];
  platforms: string[];
  postsPerMonth: number;
  imageSource: string;
  formatMix: Record<string, number>;
  isTest: boolean;
};

export type BrandFormLabels = Record<
  "name" | "languages" | "platforms" | "postsPerMonth" | "imageSource" | "formatMix" | "submit" | "saved" | "test",
  string
> & { langs: Record<string, string>; formats: Record<string, string>; images: Record<string, string> };

export function BrandForm({
  action,
  initial,
  labels,
  platforms,
}: {
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  initial?: BrandValues;
  labels: BrandFormLabels;
  platforms: { id: string; label: string }[];
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const v: BrandValues = initial ?? {
    name: "",
    languages: ["en"],
    platforms: platforms.map((p) => p.id),
    postsPerMonth: 30,
    imageSource: "generated",
    formatMix: { short_video: 40, carousel: 30, single_image: 30 },
    isTest: false,
  };
  return (
    <form action={formAction} className="flex max-w-2xl flex-col gap-5">
      {state?.error && <Alert variant="error">{state.error}</Alert>}
      {state?.ok && <Alert variant="success">{labels.saved}</Alert>}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">{labels.name}</Label>
        <Input id="name" name="name" defaultValue={v.name} required minLength={2} maxLength={80} />
      </div>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-sm font-medium">{labels.languages}</legend>
        <div className="flex gap-4">
          {Object.entries(labels.langs).map(([id, label]) => (
            <label key={id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="languages" value={id} defaultChecked={v.languages.includes(id)} /> {label}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-sm font-medium">{labels.platforms}</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {platforms.map((p) => (
            <label key={p.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="platforms" value={p.id} defaultChecked={v.platforms.includes(p.id)} /> {p.label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="postsPerMonth">{labels.postsPerMonth}</Label>
          <Input id="postsPerMonth" name="postsPerMonth" type="number" min={20} max={60} defaultValue={v.postsPerMonth} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="imageSource">{labels.imageSource}</Label>
          <Select id="imageSource" name="imageSource" defaultValue={v.imageSource}>
            {Object.entries(labels.images).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-sm font-medium">{labels.formatMix}</legend>
        <div className="grid grid-cols-3 gap-3">
          {Object.entries(labels.formats).map(([id, label]) => (
            <label key={id} className="flex flex-col gap-1 text-sm">
              {label}
              <Input name={`mix_${id}`} type="number" min={0} max={100} defaultValue={v.formatMix[id] ?? 0} />
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isTest" defaultChecked={v.isTest} /> {labels.test}
      </label>
      <div>
        <Button type="submit" disabled={pending}>
          {labels.submit}
        </Button>
      </div>
    </form>
  );
}
