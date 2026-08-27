import * as RadixDialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { IconButton } from "./Button";
import { XIcon } from "@/components/icons";

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Wider variant for the export dialog, which shows a preview. */
  size?: "md" | "lg";
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "md",
}: DialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        {/* The one place the design system permits a backdrop blur. */}
        <RadixDialog.Overlay
          className="cp-overlay fixed inset-0 z-[var(--z-dialog)] bg-black/50 backdrop-blur-[2px]"
        />
        <RadixDialog.Content
          className={cn(
            "cp-pop fixed left-1/2 top-1/2 z-[var(--z-dialog)] -translate-x-1/2 -translate-y-1/2",
            "flex max-h-[85vh] w-[calc(100vw-32px)] flex-col overflow-hidden",
            "rounded-xl border border-line bg-raised shadow-3",
            size === "lg" ? "max-w-3xl" : "max-w-md",
          )}
        >
          <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <RadixDialog.Title className="text-title text-ink">{title}</RadixDialog.Title>
              {description ? (
                <RadixDialog.Description className="mt-1 text-body text-ink-muted">
                  {description}
                </RadixDialog.Description>
              ) : null}
            </div>
            <RadixDialog.Close asChild>
              <IconButton label="Close" size="sm">
                <XIcon />
              </IconButton>
            </RadixDialog.Close>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

          {footer ? (
            <footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
              {footer}
            </footer>
          ) : null}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export const DialogClose = RadixDialog.Close;
