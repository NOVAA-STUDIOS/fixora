import { z } from 'zod';

/**
 * One matching line, with a little context. A whole-file match list would let one huge generated
 * file dominate the results and the response payload; capped counts (enforced main-side, in
 * `search-service.ts`) are what keep this fast on a 100k+ file project — the schema just describes
 * the shape those caps produce.
 */
export const SearchMatchSchema = z.object({
  /** Workspace-relative path (POSIX), same convention as `Finding.location.file`. */
  file: z.string(),
  /** 1-based, matching Monaco's convention (`revealAt` feeds this straight to it). */
  line: z.number().int().positive(),
  column: z.number().int().positive(),
  matchLength: z.number().int().positive(),
  lineText: z.string(),
  contextBefore: z.array(z.string()),
  contextAfter: z.array(z.string()),
});
export type SearchMatch = z.infer<typeof SearchMatchSchema>;

export const SearchResponseSchema = z.object({
  matches: z.array(SearchMatchSchema),
  /** True when the result cap was hit — the true match count is larger than `matches.length`. */
  truncated: z.boolean(),
});
export type SearchResponse = z.infer<typeof SearchResponseSchema>;
