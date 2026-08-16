import { useEffect, useState } from "react";

function useTitle(title: string): void {
  useEffect(() => {
    document.title = title;
  }, [title]);
}

type ProfileProps = {
  name: string;
  isOnline: boolean;
};

export function Profile({ name, isOnline }: ProfileProps) {
  const [expanded, setExpanded] = useState(false);
  useTitle(`Profile: ${name}`);

  return (
    <div onClick={() => setExpanded((prev) => !prev)}>
      <span>{name}</span>
      {isOnline ? <span>online</span> : <span>offline</span>}
      {expanded && <p>Details for {name}</p>}
    </div>
  );
}
