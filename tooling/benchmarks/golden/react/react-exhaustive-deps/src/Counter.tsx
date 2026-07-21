import { useEffect, useState } from "react";

export function Counter({ start }: { start: number }) {
  const [count, setCount] = useState(start);
  useEffect(() => {
    setCount(start);
  });
  return <button onClick={() => setCount(count + 1)}>{count}</button>;
}
