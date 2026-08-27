import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { AlertIcon } from "@/components/icons";
import {
  resolveConflictWithLocal, resolveConflictWithServer, useSyncStore,
} from "@/state/sync";

/*
 * Shown when the server refuses a save because someone else stored a newer
 * version. Neither side is discarded automatically - the app cannot know which
 * one matters, and quietly picking one is how people lose an afternoon of work.
 */
export function ConflictDialog() {
  const conflict = useSyncStore((state) => state.conflict);

  return (
    <Dialog
      open={conflict !== null}
      // Deliberately not dismissible: closing without choosing would leave the
      // editor in a state where nothing saves and nothing says why.
      onOpenChange={() => undefined}
      title="This timeline changed somewhere else"
      description="Someone else saved while you were editing. Choose which version to keep."
      footer={
        <>
          <Button onClick={resolveConflictWithServer}>Discard mine</Button>
          <Button variant="primary" onClick={resolveConflictWithLocal}>
            Keep my changes
          </Button>
        </>
      }
    >
      <div className="flex gap-3 rounded-md border border-line bg-sunken p-3">
        <AlertIcon className="mt-0.5 size-4 shrink-0 text-warning" />
        <div className="flex flex-col gap-2 text-body text-ink-muted">
          <p>
            <strong className="text-ink">Keep my changes</strong> overwrites their version with
            yours on the next save.
          </p>
          <p>
            <strong className="text-ink">Discard mine</strong> loads their version and throws away
            the edits you made since your last successful save.
          </p>
        </div>
      </div>
    </Dialog>
  );
}
