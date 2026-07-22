import { useEffect, useState } from "react";

export function C({ start }: { start: number }) {
  const [c, setC] = useState(start);
  useEffect(() => {
    setC(start);
  });
  return <button onClick={() => setC(c + 1)}>{c}</button>;
}
