/*
 * The .chronoplot project file - the format for moving a timeline between
 * instances.
 *
 * It is deliberately a thin envelope around the document rather than a database
 * dump: no ids of users, no sharing, no server URLs. A project file describes a
 * timeline, not who could see it on the machine it came from.
 *
 * `format` is versioned separately from the document's own `schemaVersion` so
 * the envelope can change without implying the document did.
 */
import { timelineDocSchema, findDocumentInconsistencies, type TimelineDoc } from "@shared";
import { z } from "zod";

export const PROJECT_FILE_FORMAT = 1;
export const PROJECT_FILE_EXTENSION = ".chronoplot.json";

export const projectFileSchema = z.object({
  format: z.literal(PROJECT_FILE_FORMAT),
  kind: z.literal("chronoplot-project"),
  title: z.string().min(1).max(200),
  /** Informational only - never trusted, never used for anything but display. */
  exportedAt: z.number().int().optional(),
  exportedBy: z.string().max(200).optional(),
  doc: timelineDocSchema,
});

export type ProjectFile = z.infer<typeof projectFileSchema>;

export function buildProjectFile(
  title: string,
  doc: TimelineDoc,
  exportedBy?: string,
): ProjectFile {
  return {
    format: PROJECT_FILE_FORMAT,
    kind: "chronoplot-project",
    title,
    exportedAt: Date.now(),
    ...(exportedBy ? { exportedBy } : {}),
    doc,
  };
}

export function downloadProjectFile(title: string, doc: TimelineDoc, exportedBy?: string): void {
  const payload = JSON.stringify(buildProjectFile(title, doc, exportedBy), null, 2);
  const blob = new Blob([payload], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${title.replace(/[^\w\d\-. ]+/g, "").trim() || "timeline"}${PROJECT_FILE_EXTENSION}`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Parses a file chosen by the user.
 *
 * Everything is validated before it is offered to the server - a file picked
 * off disk is untrusted input, and a clear message here beats a 422 from the
 * API. The referential check runs too, since a structurally valid document can
 * still point at rows that do not exist.
 */
export function parseProjectFile(text: string): ProjectFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That file is not valid JSON.");
  }

  const result = projectFileSchema.safeParse(parsed);
  if (!result.success) {
    const looksLikeOurs =
      typeof parsed === "object" && parsed !== null && "kind" in parsed &&
      (parsed as { kind?: unknown }).kind === "chronoplot-project";
    throw new Error(
      looksLikeOurs
        ? "That project file was written by an incompatible version of Chronoplot."
        : "That does not look like a Chronoplot project file.",
    );
  }

  const problems = findDocumentInconsistencies(result.data.doc);
  if (problems.length > 0) {
    throw new Error(`The timeline in that file is inconsistent: ${problems[0]}`);
  }

  return result.data;
}
