import { useEffect, useRef } from "react";

import { errorMessage } from "../../lib/api";
import { FormError } from "../../ui";

/**
 * A form's error that comes into view when it appears. At the end of a long
 * form in a window, it would otherwise sit below what the person sees, and
 * the button pressed would seem to do nothing.
 */
export function ShownError({ error }: { error: unknown }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) ref.current?.scrollIntoView({ block: "nearest" });
  }, [error]);
  return (
    <div ref={ref} className="scroll-my-4 empty:hidden">
      <FormError>{error ? errorMessage(error) : null}</FormError>
    </div>
  );
}
