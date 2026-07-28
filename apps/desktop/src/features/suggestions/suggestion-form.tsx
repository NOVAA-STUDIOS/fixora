import {
  SUGGESTION_CATEGORY_LABELS,
  SUGGESTION_MESSAGE_MAX_LENGTH,
  SUGGESTION_MESSAGE_MIN_LENGTH,
  type SuggestionCategory,
} from '@fixora/shared-types';
import {
  Button,
  cn,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SendIcon,
  Textarea,
} from '@fixora/ui';
import { useId, useState } from 'react';

import { useAutoResizeTextarea } from './use-auto-resize-textarea.js';

const CATEGORIES = Object.keys(SUGGESTION_CATEGORY_LABELS) as SuggestionCategory[];

/**
 * The submission form (Sprint F1): category selector, an auto-resizing message field with a live
 * character counter, and a Submit button that shows its own loading state. Validation mirrors the
 * service's rules exactly (same min/max) so the field never rejects locally something the backend
 * would accept, or the reverse.
 */
export function SuggestionForm({
  submitting,
  serverError,
  onDismissServerError,
  onSubmit,
}: {
  submitting: boolean;
  serverError: string | null;
  onDismissServerError: () => void;
  onSubmit: (category: SuggestionCategory, message: string) => Promise<boolean>;
}): React.JSX.Element {
  const [category, setCategory] = useState<SuggestionCategory>('feature');
  const [message, setMessage] = useState('');
  const [touched, setTouched] = useState(false);

  const categoryId = useId();
  const messageId = useId();
  const counterId = useId();
  const textareaRef = useAutoResizeTextarea(message);

  const trimmedLength = message.trim().length;
  const tooShort = trimmedLength > 0 && trimmedLength < SUGGESTION_MESSAGE_MIN_LENGTH;
  const tooLong = message.length > SUGGESTION_MESSAGE_MAX_LENGTH;
  const empty = trimmedLength === 0;
  const invalid = touched && (empty || tooShort || tooLong);
  const canSubmit = !submitting && !empty && !tooShort && !tooLong;

  const validationMessage = tooLong
    ? `Too long by ${String(message.length - SUGGESTION_MESSAGE_MAX_LENGTH)} characters.`
    : tooShort
      ? `Add ${String(SUGGESTION_MESSAGE_MIN_LENGTH - trimmedLength)} more characters.`
      : empty
        ? 'Write your suggestion before submitting.'
        : null;

  const submit = async (): Promise<void> => {
    setTouched(true);
    if (!canSubmit) return;
    const ok = await onSubmit(category, message.trim());
    if (ok) {
      setMessage('');
      setTouched(false);
    }
  };

  return (
    <form
      aria-label="Submit a suggestion"
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="flex flex-col gap-2">
        <label htmlFor={categoryId} className="text-sm font-medium text-fg">
          Category
        </label>
        <Select
          value={category}
          onValueChange={(v) => {
            setCategory(v as SuggestionCategory);
          }}
        >
          <SelectTrigger id={categoryId} className="w-full sm:w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {SUGGESTION_CATEGORY_LABELS[c]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label htmlFor={messageId} className="text-sm font-medium text-fg">
            What's on your mind?
          </label>
          <span
            id={counterId}
            aria-live="polite"
            className={cn(
              'text-xs tabular-nums',
              tooLong ? 'font-medium text-danger-text' : 'text-fg-muted',
            )}
          >
            {message.length} / {SUGGESTION_MESSAGE_MAX_LENGTH}
          </span>
        </div>
        <Textarea
          id={messageId}
          ref={textareaRef}
          value={message}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
            setMessage(e.target.value);
          }}
          onBlur={() => {
            setTouched(true);
          }}
          disabled={submitting}
          invalid={invalid}
          aria-describedby={invalid ? counterId : undefined}
          placeholder="A feature you'd love, a bug that's bugging you, or anything else..."
        />
        {invalid && validationMessage !== null && (
          <p role="alert" className="text-xs text-danger-text">
            {validationMessage}
          </p>
        )}
      </div>

      {serverError !== null && (
        <div className="flex items-start justify-between gap-3 rounded-md border border-danger bg-danger-subtle px-3 py-2">
          <p className="text-xs text-danger-text">{serverError}</p>
          <button
            type="button"
            onClick={onDismissServerError}
            className="shrink-0 text-xs font-medium text-danger-text underline-offset-2 hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/*
        Disabled only while a request is in flight — never merely because the content is currently
        invalid. A native `disabled` button does not fire a click event at all, which would make
        clicking it the exact moment a first-time user needs feedback (why won't this submit?) the
        one moment they get none. `submit()` still refuses to call `onSubmit` unless `canSubmit`.
      */}
      <Button type="submit" disabled={submitting} className="self-start">
        <SendIcon className="size-4" />
        {submitting ? 'Sending…' : 'Send suggestion'}
      </Button>
    </form>
  );
}
