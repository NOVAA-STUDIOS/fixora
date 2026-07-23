import { useState } from 'react';

interface CounterProps {
  enabled: boolean;
  start?: number;
}

export function Counter({ enabled, start = 0 }: CounterProps) {
  // BUG: a hook called conditionally (rules-of-hooks). On a render where `enabled` flips, the hook
  // order changes and React's state association breaks.
  if (!enabled) {
    return <span>disabled</span>;
  }

  const [count, setCount] = useState(start);

  return (
    <button type="button" onClick={() => setCount((c) => c + 1)}>
      count: {count}
    </button>
  );
}
