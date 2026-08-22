import {
  CategorySchema,
  isRepairAttemptable,
  repairStateFor,
  type Category,
  type Finding,
} from '@fixora/shared-types';
import {
  Button,
  CheckIcon,
  CloseIcon,
  ClockIcon,
  Dialog,
  DialogContent,
  DialogTitle,
  RefreshIcon,
  cn,
} from '@fixora/ui';
import { useMemo } from 'react';

import { basename } from '../../lib/path.js';

import { useBulkRepairStore, type FindingRepairStatus, type FindingReviewFlag } from './bulk-repair-store.js';

/** Red-first: the order a triage pass would actually work in, not alphabetical. Mirrors
 * `CategorySchema`'s own declared order (shared-types), kept explicit here since the panel's
 * layout is the one place that order is a visible product decision, not an implementation detail. */
const CATEGORY_ORDER: readonly Category[] = CategorySchema.options;

const CATEGORY_META: Record<Category, { emoji: string; label: string; accent: string }> = {
  correctness: { emoji: '🔴', label: 'Correctness', accent: 'text-danger-text' },
  security: { emoji: '🔴', label: 'Security', accent: 'text-danger-text' },
  performance: { emoji: '🟠', label: 'Performance', accent: 'text-warn' },
  maintainability: { emoji: '🟡', label: 'Maintainability', accent: 'text-warn' },
  style: { emoji: '🟢', label: 'Style', accent: 'text-success-text' },
};

const STATUS_META: Record<
  FindingRepairStatus,
  { Icon: typeof CheckIcon; className: string; spin?: boolean }
> = {
  pending: { Icon: ClockIcon, className: 'text-fg-muted' },
  fixing: { Icon: RefreshIcon, className: 'text-accent-text', spin: true },
  done: { Icon: CheckIcon, className: 'text-success-text' },
  failed: { Icon: CloseIcon, className: 'text-danger-text' },
  'needs-review': { Icon: ClockIcon, className: 'text-warn' },
};

/**
 * "Repair All", broken into per-category cards with a "Fix All" of their own — for the common case
 * of "I trust the security fixes, I want to look at style changes myself first". Built entirely on
 * `bulk-repair-store.ts`'s `groupedRepair`, which is itself a filtered call into the same `start()`
 * queue "Repair All Repairable" already uses — one verified/gated repair pipeline, two ways to slice
 * what goes into it.
 */
export function GroupedRepairPanel({
  open,
  onOpenChange,
  findings,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  findings: readonly Finding[];
}): React.JSX.Element {
  const status = useBulkRepairStore((s) => s.status);
  const findingStatus = useBulkRepairStore((s) => s.findingStatus);
  const reviewFlags = useBulkRepairStore((s) => s.reviewFlags);
  const lowConfidenceIds = useBulkRepairStore((s) => s.lowConfidenceIds);
  const groupedRepair = useBulkRepairStore((s) => s.groupedRepair);
  const applyReviewed = useBulkRepairStore((s) => s.applyReviewed);
  const skipReviewed = useBulkRepairStore((s) => s.skipReviewed);

  const groups = useMemo(() => {
    const byCategory = new Map<Category, Finding[]>();
    for (const finding of findings) {
      const bucket = byCategory.get(finding.category);
      if (bucket === undefined) byCategory.set(finding.category, [finding]);
      else bucket.push(finding);
    }
    return CATEGORY_ORDER.filter((c) => byCategory.has(c)).map((category) => ({
      category,
      findings: byCategory.get(category) ?? [],
    }));
  }, [findings]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] max-w-2xl flex-col gap-4 overflow-y-auto bg-canvas">
        <DialogTitle className="text-base font-semibold text-fg">Group Repair</DialogTitle>
        {groups.length === 0 ? (
          <p className="py-6 text-center text-sm text-fg-muted">No findings to group.</p>
        ) : (
          groups.map(({ category, findings: groupFindings }) => (
            <CategoryCard
              key={category}
              category={category}
              findings={groupFindings}
              findingStatus={findingStatus}
              reviewFlags={reviewFlags}
              lowConfidenceIds={lowConfidenceIds}
              busy={status === 'running'}
              onFixAll={() => {
                void groupedRepair(category, groupFindings);
              }}
              onApplyReviewed={(id) => void applyReviewed(id)}
              onSkipReviewed={skipReviewed}
            />
          ))
        )}
      </DialogContent>
    </Dialog>
  );
}

function CategoryCard({
  category,
  findings,
  findingStatus,
  reviewFlags,
  lowConfidenceIds,
  busy,
  onFixAll,
  onApplyReviewed,
  onSkipReviewed,
}: {
  category: Category;
  findings: readonly Finding[];
  findingStatus: Record<string, FindingRepairStatus>;
  reviewFlags: Record<string, FindingReviewFlag>;
  lowConfidenceIds: Record<string, boolean>;
  busy: boolean;
  onFixAll: () => void;
  onApplyReviewed: (findingId: string) => void;
  onSkipReviewed: (findingId: string) => void;
}): React.JSX.Element {
  const meta = CATEGORY_META[category];
  const repairable = findings.some((f) => {
    const state = repairStateFor(f);
    return isRepairAttemptable(state) || state === 'manual-only';
  });

  return (
    <div className="animate-ios-enter rounded-xl border border-border-subtle bg-raised">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <span className={cn('flex items-center gap-2 text-sm font-medium', meta.accent)}>
          <span aria-hidden="true">{meta.emoji}</span>
          {meta.label}
          <span className="text-xs font-normal text-fg-muted">({findings.length} issues)</span>
        </span>
        <Button variant="ghost" size="sm" disabled={busy || !repairable} onClick={onFixAll}>
          Fix All
        </Button>
      </div>
      <div className="border-t border-border-subtle" />
      <ul className="flex flex-col gap-0.5 p-2">
        {findings.map((finding) => {
          const rowStatus = findingStatus[finding.id] ?? 'pending';
          const { Icon, className, spin } = STATUS_META[rowStatus];
          const review = reviewFlags[finding.id];
          const lowConfidence = lowConfidenceIds[finding.id] === true;
          return (
            <li key={finding.id} className="flex flex-col gap-1.5">
              <div
                title={finding.message}
                className={cn(
                  'flex items-center gap-2.5 rounded-lg border-l-2 px-2 py-1.5 text-sm hover:bg-hover',
                  // Severity accent (req. 1): error rows red, warning rows yellow — findings other
                  // than error/warning (info) carry no accent, matching how little they say here.
                  finding.severity === 'error' && 'border-l-danger-text',
                  finding.severity === 'warning' && 'border-l-warn',
                  finding.severity !== 'error' && finding.severity !== 'warning' && 'border-l-transparent',
                )}
              >
                <Icon className={cn('size-3.5 shrink-0', className, spin && 'animate-spin')} />
                <span className="min-w-0 flex-1 truncate text-fg-secondary">
                  {basename(finding.location.file)} — {finding.ruleId}
                </span>
                {lowConfidence && (
                  <span className="shrink-0 rounded-full bg-warn/15 px-2 py-0.5 text-[10px] font-medium text-warn">
                    Review Recommended
                  </span>
                )}
              </div>
              {review !== undefined && (
                <div className="ml-6 flex flex-col gap-2 rounded-lg border border-danger-text/30 bg-danger-text/5 px-3 py-2">
                  <p className="text-xs font-medium text-danger-text">
                    ⚠️ This fix may be risky — review before applying
                  </p>
                  <ul className="list-inside list-disc text-xs text-fg-muted">
                    {review.harmfulReasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => {
                        onApplyReviewed(finding.id);
                      }}
                    >
                      Review & Apply
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        onSkipReviewed(finding.id);
                      }}
                    >
                      Skip
                    </Button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
