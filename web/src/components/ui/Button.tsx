import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/*
 * Three variants plus one destructive, three heights. Adding a fourth variant
 * is almost always a sign the layout is wrong rather than the button - see
 * docs/DESIGN.md section 7.
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-accent-ink hover:bg-accent-hover shadow-1 " +
    "disabled:bg-accent/40 disabled:shadow-none",
  secondary:
    "bg-surface text-ink border border-line hover:border-line-strong hover:bg-raised",
  ghost: "text-ink-muted hover:text-ink hover:bg-accent-soft",
  danger: "bg-critical text-white hover:brightness-110 shadow-1",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 gap-1.5 text-caption rounded-sm",
  md: "h-8 px-3 gap-2 text-label rounded-sm",
  lg: "h-10 px-4 gap-2 text-body font-medium rounded-md",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Renders before the label; keep it to a 16px icon. */
  icon?: ReactNode;
  /** Swaps the label for a spinner and blocks interaction. */
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon, loading, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        "relative inline-flex select-none items-center justify-center whitespace-nowrap",
        "transition-[background-color,border-color,color,box-shadow,transform]",
        "duration-[var(--dur-instant)] ease-standard",
        "active:scale-[0.98] disabled:pointer-events-none disabled:opacity-55",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? (
        <span
          aria-hidden
          className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent opacity-80"
        />
      ) : (
        icon
      )}
      {children}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required: an icon-only control still needs an accessible name. */
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  active?: boolean;
}

const ICON_SIZES: Record<ButtonSize, string> = {
  sm: "size-7 rounded-sm",
  md: "size-8 rounded-sm",
  lg: "size-10 rounded-md",
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, variant = "ghost", size = "md", active, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      aria-label={label}
      /*
       * Deliberately no `title`. The browser renders its own tooltip from it,
       * which appeared on top of the styled one wherever a Tooltip wrapped this
       * button - two tooltips for one control. `aria-label` carries the name for
       * assistive technology; a Tooltip carries it for everyone else.
       */
      aria-pressed={active}
      className={cn(
        "inline-flex shrink-0 items-center justify-center",
        "transition-[background-color,border-color,color] duration-[var(--dur-instant)] ease-standard",
        "active:scale-[0.96] disabled:pointer-events-none disabled:opacity-50",
        VARIANTS[variant],
        ICON_SIZES[size],
        active && "bg-accent-soft text-accent",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});
