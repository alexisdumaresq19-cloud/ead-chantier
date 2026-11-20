import type { ReactNode } from "react";

import { cn } from "../../lib/cn";

/**
 * Short facts in a row, "a · b · c". Each fact brings its dot on its left and
 * the one that starts a line hides it in the margin, so a line never ends on
 * a dot, and a fact that does not fit goes to the next line whole.
 */
export function Meta({
  items,
  className,
}: {
  items: (ReactNode | null | undefined | false)[];
  className?: string;
}) {
  const shown = items.filter((item) => item !== null && item !== undefined && item !== false);
  return (
    // Clipped sideways only: a tall tap target inside a fact keeps its height.
    <span className={cn("block overflow-x-clip", className)}>
      <span className="-ml-3 flex flex-wrap">
        {shown.map((item, index) => (
          <span
            key={index}
            className="relative max-w-full pl-3 before:absolute before:left-1 before:content-['·']"
          >
            {item}
          </span>
        ))}
      </span>
    </span>
  );
}
