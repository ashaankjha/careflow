import { forwardRef, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes, type LabelHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const base = "w-full rounded-md border border-line bg-surface px-3 text-sm text-ink placeholder:text-ink-4 transition-colors hover:border-ink/20 focus:border-accent disabled:bg-canvas disabled:text-ink-3";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={cn(base, "h-9", className)} {...p} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, ...p }, ref) {
  return <select ref={ref} className={cn(base, "h-9 pr-8", className)} {...p} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...p }, ref) {
  return <textarea ref={ref} className={cn(base, "py-2 leading-6", className)} {...p} />;
});

export function Label({ className, ...p }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("mb-1 block text-[12px] font-medium text-ink-2", className)} {...p} />;
}

export function FieldHint({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-[11px] text-ink-3">{children}</p>;
}
