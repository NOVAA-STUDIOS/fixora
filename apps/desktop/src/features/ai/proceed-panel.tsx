import { Button } from '@fixora/ui';
import { useState } from 'react';

/**
 * Proceed Mode — minimal UI (P2.1, objective 8).
 *
 * The "simple prompt input" and nothing more: no redesign, no animation, no advanced UX. Editing modes
 * become Repair / Proceed / Explain; Repair is unchanged, Explain is a placeholder. This component is
 * intentionally dumb — it collects the instruction and hands it to `onSubmit`; the verified editing
 * pipeline lives entirely in main (proceed-service). Kept self-contained and unit-tested so it cannot
 * regress the existing Repair panel.
 */

export type EditMode = 'repair' | 'proceed' | 'explain';

export interface EditModeTabsProps {
  active: EditMode;
  onChange: (mode: EditMode) => void;
}

/** The Repair / Proceed / Explain switch. Explain is a placeholder (disabled) for now. */
export function EditModeTabs({ active, onChange }: EditModeTabsProps): React.JSX.Element {
  const modes: readonly { id: EditMode; label: string; disabled?: boolean }[] = [
    { id: 'repair', label: 'Repair' },
    { id: 'proceed', label: 'Proceed' },
    { id: 'explain', label: 'Explain', disabled: true },
  ];
  return (
    <div role="tablist" aria-label="Editing mode" style={{ display: 'flex', gap: 4 }}>
      {modes.map((m) => (
        <button
          key={m.id}
          type="button"
          role="tab"
          aria-selected={active === m.id}
          disabled={m.disabled === true}
          onClick={() => {
            onChange(m.id);
          }}
        >
          {m.label}
          {m.disabled === true ? ' (soon)' : ''}
        </button>
      ))}
    </div>
  );
}

export interface ProceedPanelProps {
  /** Called with the trimmed instruction when the user submits a non-empty request. */
  onSubmit: (instruction: string) => void;
  /** True while an edit is being generated/verified — disables the input and submit. */
  busy?: boolean;
}

export function ProceedPanel({ onSubmit, busy = false }: ProceedPanelProps): React.JSX.Element {
  const [instruction, setInstruction] = useState('');
  const trimmed = instruction.trim();
  const canSubmit = trimmed.length > 0 && !busy;

  const submit = (e: React.SyntheticEvent): void => {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit(trimmed);
  };

  return (
    <form onSubmit={submit} aria-label="Proceed">
      <label htmlFor="proceed-instruction">What would you like to change?</label>
      <textarea
        id="proceed-instruction"
        value={instruction}
        onChange={(e) => {
          setInstruction(e.target.value);
        }}
        placeholder="e.g. make this button green, rename this variable, add a loading state"
        rows={3}
        disabled={busy}
      />
      <Button type="submit" disabled={!canSubmit}>
        {busy ? 'Working…' : 'Proceed'}
      </Button>
    </form>
  );
}
