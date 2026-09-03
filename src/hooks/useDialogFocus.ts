import { useEffect, useRef, type RefObject } from "react";

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

function visibleModalDialogs() {
  return Array.from(document.querySelectorAll<HTMLElement>("[role='dialog'][aria-modal='true']")).filter(
    (element) => element.getClientRects().length > 0
  );
}

export function useDialogFocus<T extends HTMLElement>(
  onClose: () => void,
  active = true,
  returnFocusRef?: RefObject<HTMLElement | null>
) {
  const dialogRef = useRef<T>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!active) return;

    const dialog = dialogRef.current;
    const previouslyFocused = returnFocusRef?.current
      ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const focusableElements = () =>
      Array.from(dialog?.querySelectorAll<HTMLElement>(focusableSelector) ?? []).filter(
        (element) => element.getClientRects().length > 0 && element.getAttribute("aria-hidden") !== "true"
      );
    const isTopmostDialog = () => visibleModalDialogs().at(-1) === dialog;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!dialog || !isTopmostDialog()) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const elements = focusableElements();
      if (elements.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = elements[0];
      const last = elements[elements.length - 1];
      const activeElement = document.activeElement;
      if (event.shiftKey && (activeElement === first || !dialog.contains(activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (activeElement === last || !dialog.contains(activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };

    const focusFrame = window.requestAnimationFrame(() => {
      if (dialog && isTopmostDialog() && !dialog.contains(document.activeElement)) {
        (focusableElements()[0] ?? dialog).focus();
      }
    });
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [active]);

  return dialogRef;
}
