"use client";

import { useActionState, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/date-time-picker";
import { Textarea } from "@/components/ui/textarea";
import { save } from "./actions";

type DraftEditorProps = {
  id: string;
  creating?: boolean;
  title?: string;
  body?: string;
  plannedOn?: string;
  tag?: string;
  updatedAt?: string;
  copyFrom?: string;
};

export function DraftEditor({ id, creating = false, title = "", body = "", plannedOn = "", tag = "", updatedAt = "", copyFrom = "" }: DraftEditorProps) {
  const [message, action, pending] = useActionState(save.bind(null, id, creating), null);
  const fieldId = useId();
  const [values, setValues] = useState({ title, body, plannedOn, tag });
  return (
    <form action={action}>
      <input type="hidden" name="expectedUpdatedAt" value={updatedAt} />
      <input type="hidden" name="copyFrom" value={copyFrom} />
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={fieldId + "-title"}>Title</FieldLabel>
          <Input id={fieldId + "-title"} name="title" value={values.title} onChange={(event) => setValues({ ...values, title: event.target.value })} maxLength={160} required />
        </Field>
        <Field>
          <FieldLabel htmlFor={fieldId + "-body"}>Caption</FieldLabel>
          <Textarea id={fieldId + "-body"} name="body" value={values.body} onChange={(event) => setValues({ ...values, body: event.target.value })} maxLength={10000} rows={5} />
        </Field>
        <DatePicker id={fieldId + "-date"} label="Planned date (optional)" name="plannedOn" value={values.plannedOn} onChange={(plannedOn) => setValues({ ...values, plannedOn })} />
        <Field>
          <FieldLabel htmlFor={fieldId + "-tag"}>Tag (optional)</FieldLabel>
          <Input id={fieldId + "-tag"} name="tag" value={values.tag} onChange={(event) => setValues({ ...values, tag: event.target.value })} maxLength={48} placeholder="e.g. Product updates" />
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save draft"}</Button>
          {message && <FieldError>{message}</FieldError>}
        </div>
      </FieldGroup>
    </form>
  );
}

