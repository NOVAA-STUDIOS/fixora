import { useState } from "react";

export function Bad({ enabled }: { enabled: boolean }) {
  if (enabled) {
    const [x] = useState(0);
    return <span>{x}</span>;
  }
  return null;
}
