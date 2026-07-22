import { useState } from "react";

export function Bad({ on }: { on: boolean }) {
  if (on) {
    const [x] = useState(0);
    return <span>{x}</span>;
  }
  return null;
}
