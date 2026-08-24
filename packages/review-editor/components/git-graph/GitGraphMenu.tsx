import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type GitGraphMenuItem =
  | { separator: true; label?: never; run?: never }
  | { separator?: false; label: string; run: () => void; danger?: boolean };

interface GitGraphMenuProps {
  x: number;
  y: number;
  items: GitGraphMenuItem[];
  onClose: () => void;
}

export const GitGraphMenu: React.FC<GitGraphMenuProps> = ({ x, y, items, onClose }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({
      x: Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)),
    });
  }, [x, y, items]);

  useEffect(() => {
    const onDoc = (ev: MouseEvent) => {
      if (ref.current && !ref.current.contains(ev.target as Node)) onClose();
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onClose();
    };
    const onScroll = () => onClose();
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      className="fixed z-[80] min-w-[196px] bg-popover text-popover-foreground border border-border rounded shadow-lg overflow-hidden py-1"
      style={{ left: pos.x, top: pos.y }}
      role="menu"
    >
      {items.map((item, i) => {
        if (item.separator) {
          return <div key={`sep-${i}`} className="h-px bg-border my-1" />;
        }
        return (
          <button
            key={`${item.label}-${i}`}
            type="button"
            role="menuitem"
            className={`flex w-[calc(100%-8px)] items-center gap-2 mx-1 px-2 py-1.5 text-xs rounded cursor-pointer outline-none text-left ${
              item.danger
                ? "text-destructive hover:bg-destructive/10"
                : "text-foreground/80 hover:bg-muted hover:text-foreground"
            }`}
            onClick={() => {
              onClose();
              item.run();
            }}
          >
            {item.label}
          </button>
        );
      })}
    </div>,
    document.body,
  );
};
