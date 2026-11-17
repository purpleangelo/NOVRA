"use client";

import { useActionState, useState } from "react";
import type { ActionState } from "@/app/actions/brain";
import { Alert } from "../ui/badge";
import { Button } from "../ui/button";
import { Input, Label, Select, Textarea } from "../ui/input";

type Props = {
  editAction: (prev: ActionState, form: FormData) => Promise<ActionState>;
  regenAction: (prev: ActionState, form: FormData) => Promise<ActionState>;
  copy: { hook: string; caption: string; hashtags: string[]; cta: string; title?: string };
  slidesText?: string;
  visual?: { headline: string; subtext?: string } | null;
  hasTitle: boolean;
  isStoryboard: boolean;
  maxChars: number;
  hashtagRange: [number, number];
};

export function VariantEditor(p: Props) {
  const [editState, edit, editing] = useActionState(p.editAction, undefined);
  const [regenState, regen, regenerating] = useActionState(p.regenAction, undefined);
  const [caption, setCaption] = useState(p.copy.caption);
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      {!open ? (
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          Edit copy
        </Button>
      ) : (
        <form action={edit} className="flex flex-col gap-2 text-sm">
          <Label>Hook</Label>
          <Input name="hook" defaultValue={p.copy.hook} />
          <Label>
            Caption <span className={caption.length > p.maxChars ? "text-destructive" : "text-muted-foreground"}>({caption.length}/{p.maxChars})</span>
          </Label>
          <Textarea name="caption" value={caption} onChange={(e) => setCaption(e.target.value)} rows={6} />
          <Label>
            Hashtags <span className="text-muted-foreground">({p.hashtagRange[0]}–{p.hashtagRange[1]})</span>
          </Label>
          <Input name="hashtags" defaultValue={p.copy.hashtags.join(" ")} />
          <Label>CTA</Label>
          <Input name="cta" defaultValue={p.copy.cta} />
          {p.hasTitle && (
            <>
              <Label>Title (max 70)</Label>
              <Input name="title" defaultValue={p.copy.title ?? ""} maxLength={100} />
            </>
          )}
          {p.visual && (
            <>
              <Label>Headline on image</Label>
              <Input name="headline" defaultValue={p.visual.headline} />
              <Label>Subtext on image</Label>
              <Input name="subtext" defaultValue={p.visual.subtext ?? ""} />
            </>
          )}
          {p.slidesText !== undefined && (
            <>
              <Label>Slides (heading on first line, body below; separate slides with a line containing ---)</Label>
              <Textarea name="slides" defaultValue={p.slidesText} rows={8} className="font-mono text-xs" />
            </>
          )}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={editing}>
              Save new version
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>
        </form>
      )}
      {editState?.error && <Alert variant="error">{editState.error}</Alert>}
      {editState?.ok && <Alert variant="success">{editState.ok}</Alert>}
      <form action={regen} className="flex flex-wrap items-center gap-2">
        <Input name="instruction" placeholder="Optional instruction, e.g. shorter, warmer light" className="min-w-0 flex-1" />
        <Select name="kind" defaultValue="copy">
          <option value="copy">{p.isStoryboard ? "Regenerate copy + storyboard" : "Regenerate copy"}</option>
          {!p.isStoryboard && <option value="image">Regenerate image</option>}
        </Select>
        <Button type="submit" size="sm" variant="secondary" disabled={regenerating}>
          Go
        </Button>
      </form>
      {regenState?.error && <Alert variant="error">{regenState.error}</Alert>}
      {regenState?.ok && <Alert variant="success">{regenState.ok}</Alert>}
    </div>
  );
}
