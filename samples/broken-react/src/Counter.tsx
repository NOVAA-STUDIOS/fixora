import { useEffect, useState } from 'react';

export function Counter({ start }: { start: number }) {
  const [count, setCount] = useState(start);

  // No dependency array: this runs after every render and resets the count,
  // so the button can never increment past `start`.
  useEffect(() => {
    setCount(start);
  });

  return <button onClick={() => setCount(count + 1)}>{count}</button>;
}
