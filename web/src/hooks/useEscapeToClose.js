import { useEffect, useRef } from "react";

// Escape closes the topmost open window only (e.g. the Manage commodities
// window over the distribution form, or a confirmation over a form): every
// active caller is kept on a stack, and the last one opened handles the key.
const stack = [];
let installed = false;
function onKeyDown(e) {
  if (e.key !== "Escape" || stack.length === 0) return;
  stack[stack.length - 1].current();
}

export function useEscapeToClose(active, onClose) {
  const handler = useRef(onClose);
  handler.current = onClose;
  useEffect(() => {
    if (!active) return undefined;
    stack.push(handler);
    if (!installed) {
      document.addEventListener("keydown", onKeyDown);
      installed = true;
    }
    return () => {
      const i = stack.lastIndexOf(handler);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [active]);
}
