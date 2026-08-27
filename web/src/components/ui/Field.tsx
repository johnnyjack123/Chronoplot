import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/*
 * Inputs sit on the sunken surface with a hairline border; focus replaces the
 * hairline with an accent ring rather than adding an outline on top of it, so
 * the control does not change size when focused.
 */
const CONTROL = cn(
  "w-full bg-sunken text-ink placeholder:text-ink-subtle",
  "border border-line rounded-sm",
  "transition-[border-color,box-shadow] duration-[var(--dur-fast)] ease-standard",
  "hover:border-line-strong",
  "focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/25",
  "disabled:opacity-55 disabled:cursor-not-allowed",
);

export interface FieldProps {
  label: string;
  /** Hides the label visually but keeps it for screen readers. */
  hideLabel?: boolean;
  hint?: ReactNode;
  error?: string | null;
  children: (props: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => ReactNode;
}

export function Field({ label, hideLabel, hint, error, children }: FieldProps) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className={cn("text-label text-ink-muted", hideLabel && "sr-only")}>
        {label}
      </label>

      {children({
        id,
        ...(describedBy ? { "aria-describedby": describedBy } : {}),
        ...(error ? { "aria-invalid": true } : {}),
      })}

      {error ? (
        <p id={`${id}-error`} role="alert" className="text-caption text-critical">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-caption text-ink-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return <input ref={ref} className={cn(CONTROL, "h-8 px-2.5 text-body", className)} {...rest} />;
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(CONTROL, "min-h-20 resize-y px-2.5 py-2 text-body leading-5", className)}
        {...rest}
      />
    );
  },
);
