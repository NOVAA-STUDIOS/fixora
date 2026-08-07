import { z } from 'zod';

/** Which manifest the workspace root has — governs both what's listed and what Install/Uninstall run. */
export const ManifestKindSchema = z.enum(['npm', 'pip', 'none']);
export type ManifestKind = z.infer<typeof ManifestKindSchema>;

export const PackageDependencySchema = z.object({
  name: z.string(),
  /** The version range as written in the manifest (npm) or pin (pip) — not a resolved version. */
  version: z.string(),
  dev: z.boolean(),
});
export type PackageDependency = z.infer<typeof PackageDependencySchema>;

export const PackageListSchema = z.object({
  kind: ManifestKindSchema,
  dependencies: z.array(PackageDependencySchema),
});
export type PackageList = z.infer<typeof PackageListSchema>;

export const PackageSearchResultSchema = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string(),
});
export type PackageSearchResult = z.infer<typeof PackageSearchResultSchema>;

export const PackageSearchResponseSchema = z.object({
  results: z.array(PackageSearchResultSchema),
});
export type PackageSearchResponse = z.infer<typeof PackageSearchResponseSchema>;
