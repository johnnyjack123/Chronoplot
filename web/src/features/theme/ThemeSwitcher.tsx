import { useState } from "react";
import type { ThemeName } from "@shared";
import { cn } from "@/lib/cn";
import { IconButton } from "@/components/ui/Button";
import { Popover } from "@/components/ui/Popover";
import { CheckIcon, PaletteIcon } from "@/components/icons";
import { THEMES, useThemeStore } from "@/state/theme";

/*
 * Each theme is previewed with its own colours rather than a text label, so the
 * choice is made by looking rather than by reading. The preview renders a
 * miniature of the actual product - canvas, a surface panel, and three cards -
 * because an abstract swatch row does not tell you what the editor will feel
 * like.
 */
function ThemePreview({ theme }: { theme: ThemeName }) {
  return (
    <div
      data-theme={theme}
      aria-hidden
      className="flex h-11 w-16 shrink-0 flex-col justify-end gap-1 overflow-hidden rounded-sm border border-line bg-canvas p-1.5"
    >
      <div className="h-1.5 w-full rounded-full bg-[var(--card-1)]" />
      <div className="h-1.5 w-3/5 rounded-full bg-[var(--card-3)]" />
      <div className="h-1.5 w-4/5 rounded-full bg-[var(--card-4)]" />
    </div>
  );
}

export function ThemeSwitcher({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const { active, override, setOverride, projectTheme } = useThemeStore();

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      className="w-72"
      trigger={
        <IconButton label="Theme" size={compact ? "sm" : "md"}>
          <PaletteIcon />
        </IconButton>
      }
    >
      <div className="flex flex-col gap-1">
        <p className="px-1 pb-1 text-micro uppercase text-ink-subtle">Theme</p>

        {THEMES.map((theme) => {
          const selected = active === theme.name;
          return (
            <button
              key={theme.name}
              type="button"
              onClick={() => setOverride(theme.name)}
              className={cn(
                "flex items-center gap-3 rounded-md p-1.5 text-left",
                "transition-colors duration-[var(--dur-instant)] ease-standard",
                selected ? "bg-accent-soft" : "hover:bg-accent-soft/60",
              )}
            >
              <ThemePreview theme={theme.name} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="text-label text-ink">{theme.label}</span>
                  {selected ? <CheckIcon className="size-3.5 text-accent" /> : null}
                </span>
                <span className="block truncate-1 text-caption text-ink-subtle">{theme.blurb}</span>
              </span>
            </button>
          );
        })}

        {override && override !== projectTheme ? (
          <button
            type="button"
            onClick={() => setOverride(null)}
            className="mt-1 rounded-md px-2 py-1.5 text-left text-caption text-ink-muted hover:bg-accent-soft/60 hover:text-ink"
          >
            Follow the project’s theme instead
          </button>
        ) : null}
      </div>
    </Popover>
  );
}
