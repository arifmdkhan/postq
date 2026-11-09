"use client";

import { useId, useState } from "react";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const formatDate = new Intl.DateTimeFormat("en", { dateStyle: "medium" });

export function DatePicker({ name, label, id, value, defaultValue = "", onChange, minDate }: {
  name?: string; label: string; id?: string; value?: string; defaultValue?: string; onChange?: (value: string) => void; minDate?: string;
}) {
  const generatedId = useId();
  const [selected, setSelected] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const date = value ?? selected;
  const candidate = date ? new Date(date + "T12:00:00") : undefined;
  const day = candidate && Number.isFinite(candidate.valueOf()) ? candidate : undefined;
  const choose = (next?: Date) => {
    const dateKey = next ? `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}` : "";
    setSelected(dateKey);
    onChange?.(dateKey);
    setOpen(false);
  };
  return <Field>
    <FieldLabel htmlFor={id ?? generatedId}>{label}</FieldLabel>
    {name && <input type="hidden" name={name} value={date} />}
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button id={id ?? generatedId} type="button" variant="outline" className="min-h-9 justify-start" />}>
        <CalendarDays data-icon="inline-start" />{day ? formatDate.format(day) : "Pick a date"}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar mode="single" selected={day} defaultMonth={day} disabled={minDate ? { before: new Date(minDate + "T00:00:00") } : undefined} onSelect={choose} />
        {day && <div className="flex justify-end border-t p-2"><Button type="button" variant="ghost" size="sm" onClick={() => choose()}>Clear date</Button></div>}
      </PopoverContent>
    </Popover>
  </Field>;
}

export function TimePicker({ name, label, value, defaultValue, onChange, min }: {
  name?: string; label: string; value?: string; defaultValue?: string; onChange?: (value: string) => void; min?: string;
}) {
  const id = useId();
  return <Field>
    <FieldLabel htmlFor={id}>{label}</FieldLabel>
    <Input id={id} name={name} type="time" step={60} min={min} value={value} defaultValue={defaultValue}
      onChange={(event) => onChange?.(event.target.value)} className="min-h-9" />
  </Field>;
}

export function UtcDateTimePicker({ name, defaultValue = "", timezone = "UTC" }: { name: string; defaultValue?: string; timezone?: string }) {
  const [date, setDate] = useState(defaultValue.slice(0, 10));
  const [time, setTime] = useState(defaultValue.slice(11, 16));
  return <FieldGroup className="grid grid-cols-2 gap-2">
    <input type="hidden" name={name} value={date && time ? date + "T" + time : ""} />
    <DatePicker label={`Date (${timezone})`} value={date} onChange={setDate} />
    <TimePicker label={`Time (${timezone})`} value={time} onChange={setTime} />
  </FieldGroup>;
}
