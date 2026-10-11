"use client";

import { useEffect } from "react";

/** Arrow keys / space step between slides; with `printButton`, renders the "Save PDF" button instead (print = one slide per page). */
export function DeckKeys({ printButton = false }: { printButton?: boolean }) {
  useEffect(() => {
    if (printButton) return;
    const onKey = (e: KeyboardEvent) => {
      const step = ["ArrowRight", "ArrowDown", "PageDown", " "].includes(e.key) ? 1 : ["ArrowLeft", "ArrowUp", "PageUp"].includes(e.key) ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      const slides = Array.from(document.querySelectorAll<HTMLElement>(".deck .slide"));
      const mid = window.innerHeight / 2;
      const current = slides.findIndex((s) => s.getBoundingClientRect().bottom > mid);
      const next = slides[Math.min(slides.length - 1, Math.max(0, (current < 0 ? 0 : current) + step))];
      next?.scrollIntoView({ behavior: "smooth", block: "center" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [printButton]);
  if (!printButton) return null;
  return (
    <button type="button" onClick={() => window.print()}>
      Save PDF
    </button>
  );
}
