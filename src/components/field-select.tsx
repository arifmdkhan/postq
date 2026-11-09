"use client";

import type { AriaAttributes, ReactNode } from "react";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "cn";

export type SelectOption = { value: string; label: ReactNode; disabled?: boolean };
type FieldSelectProps = AriaAttributes & {
  options: SelectOption[]; name?: string; id?: string; value?: string; defaultValue?: string;
  onValueChange?: (value: string) => void; disabled?: boolean; required?: boolean;
  className?: string; size?: "sm" | "default"; placeholder?: string;
};

export function FieldSelect({ options, name, id, value, defaultValue, onValueChange, disabled, required,
  className, size, placeholder = "Choose an option", ...accessibility }: FieldSelectProps) {
  return <Select<string> items={options} name={name} id={id} value={value} defaultValue={value === undefined ? defaultValue ?? options[0]?.value : undefined}
    onValueChange={(next) => onValueChange?.(next ?? "")} disabled={disabled} required={required}>
    <SelectTrigger id={id} size={size} className={cn("min-w-0 max-w-full", className)} {...accessibility}>
      <SelectValue className="min-w-0 overflow-hidden">{(selected: string | null) => {const label=options.find((option) => option.value === (selected ?? ""))?.label ?? placeholder;return <span className="truncate" title={typeof label==="string"?label:undefined}>{label}</span>;}}</SelectValue>
    </SelectTrigger>
    <SelectContent align="start" alignItemWithTrigger={false} className="w-max min-w-(--anchor-width) max-w-[min(24rem,var(--available-width))]">
      <SelectGroup>
        {options.map(({ value, label, disabled }) => <SelectItem key={value} value={value} disabled={disabled}>{label}</SelectItem>)}
      </SelectGroup>
    </SelectContent>
  </Select>;
}
