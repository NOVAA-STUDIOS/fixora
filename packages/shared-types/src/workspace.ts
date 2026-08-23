import { z } from 'zod';

/**
 * The workspace + filesystem domain schemas, shared by the IPC contracts and both processes. A
 * `relPath` is always a workspace-relative POSIX path; the renderer never sees or sends an
 * absolute path or the workspace root (Security §3) — main owns the root and resolves against it.
 */

export const WorkspaceSchema = z.object({
  id: z.string(),
  rootPath: z.string(),
  name: z.string(),
  lastOpenedAt: z.number(),
  /** When the user pinned this project, or null if it is not pinned (Sprint F2). */
  pinnedAt: z.number().nullable(),
});
export type WorkspaceInfo = z.infer<typeof WorkspaceSchema>;

export const DirEntrySchema = z.object({
  name: z.string(),
  relPath: z.string(),
  kind: z.enum(['dir', 'file']),
  language: z.string().nullable(),
});
export type DirEntryInfo = z.infer<typeof DirEntrySchema>;

export const FileEncodingSchema = z.enum(['utf8', 'utf8-bom', 'utf16le', 'utf16be', 'latin1']);
export type FileEncodingName = z.infer<typeof FileEncodingSchema>;

export const FileContentSchema = z.object({
  relPath: z.string(),
  language: z.string().nullable(),
  content: z.string(),
  /** How the bytes on disk were decoded. Carried so the editor can say when a file is not UTF-8 —
   *  and so nothing downstream assumes it is. */
  encoding: FileEncodingSchema,
});
export type FileContentInfo = z.infer<typeof FileContentSchema>;

/** A batch of file-system changes the watcher observed, coalesced (main → renderer event). */
export const FilesChangedSchema = z.object({
  /** Relative directory paths whose listing may have changed and should be re-fetched. */
  changedDirs: z.array(z.string()),
});
export type FilesChanged = z.infer<typeof FilesChangedSchema>;
