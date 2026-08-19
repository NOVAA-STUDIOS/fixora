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

import { useBulkRepairStore, type FindingRepairStatus } from './bulk-repair-store.js';

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
  const groupedRepair = useBulkRepairStore((s) => s.groupedRepair);

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
              busy={status === 'running'}
              onFixAll={() => {
                void groupedRepair(category, groupFindings);
              }}
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
  busy,
  onFixAll,
}: {
  category: Category;
  findings: readonly Finding[];
  findingStatus: Record<string, FindingRepairStatus>;
  busy: boolean;
  onFixAll: () => void;
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
          return (
            <li
              key={finding.id}
              title={finding.message}
              className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-hover"
            >
              <Icon className={cn('size-3.5 shrink-0', className, spin && 'animate-spin')} />
              <span className="min-w-0 flex-1 truncate text-fg-secondary">
                {basename(finding.location.file)} — {finding.ruleId}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
