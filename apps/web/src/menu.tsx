import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type MenuOption = { id: string; label: string; short?: string };

type Box = { top: number; left: number; width: number; maxHeight: number };

function measure(button: HTMLButtonElement): Box {
  const rect = button.getBoundingClientRect();
  const gap = 6;
  const below = window.innerHeight - rect.bottom - gap - 8;
  const above = rect.top - gap - 8;
  const upward = below < 180 && above > below;
  const maxHeight = Math.max(120, Math.min(320, upward ? above : below));
  const width = Math.max(rect.width, 200);
  const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
  const top = upward ? Math.max(8, rect.top - gap - maxHeight) : rect.bottom + gap;
  return { top, left, width, maxHeight };
}

export function Menu({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: string;
  options: MenuOption[];
  onChange: (id: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<Box | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const current = options.find((option) => option.id === value);

  useEffect(() => {
    if (!open || !buttonRef.current) return;
    const update = () => {
      if (buttonRef.current) setBox(measure(buttonRef.current));
    };
    update();
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest("[data-menu-pop]")) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`menu-trigger${className ? ` ${className}` : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={label}
        title={current?.label ?? label}
        onClick={() => {
          if (buttonRef.current) setBox(measure(buttonRef.current));
          setOpen((value) => !value);
        }}
      >
        <span className="menu-mark" aria-hidden="true">{current?.short ?? current?.label?.slice(0, 2) ?? "•"}</span>
        <span className="menu-value">{current?.label ?? value}</span>
      </button>
      {open && box
        ? createPortal(
            <ul
              id={listId}
              data-menu-pop=""
              className="menu-pop"
              role="listbox"
              aria-label={label}
              style={{ top: box.top, left: box.left, width: box.width, maxHeight: box.maxHeight }}
            >
              {options.map((option) => (
                <li key={option.id} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={option.id === value}
                    className={option.id === value ? "is-current" : undefined}
                    onClick={() => {
                      onChange(option.id);
                      setOpen(false);
                    }}
                  >
                    {option.short ? <span className="lang-short">{option.short}</span> : null}
                    <span>{option.label}</span>
                  </button>
                </li>
              ))}
            </ul>,
            document.body,
          )
        : null}
    </>
  );
}
