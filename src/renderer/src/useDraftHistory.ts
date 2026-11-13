import { useRef, useState } from "react";

/** A bounded local undo history. Replacing a saved/reloaded revision clears it. */
export function useDraftHistory<T>(initial: T) {
  const [value, setValue] = useState(initial);
  const current = useRef(initial),
    past = useRef<T[]>([]),
    future = useRef<T[]>([]);
  const [, refresh] = useState(0);
  const show = (next: T) => {
    current.current = next;
    setValue(next);
    refresh((n) => n + 1);
  };
  const commit = (update: T | ((current: T) => T)) => {
    const next =
      typeof update === "function"
        ? (update as (current: T) => T)(current.current)
        : update;
    if (JSON.stringify(next) === JSON.stringify(current.current)) return;
    past.current.push(current.current);
    if (past.current.length > 50) past.current.shift();
    future.current = [];
    show(next);
  };
  const replace = (next: T) => {
    past.current = [];
    future.current = [];
    show(next);
  };
  const undo = () => {
    if (past.current.length) {
      future.current.push(current.current);
      show(past.current.pop()!);
    }
  };
  const redo = () => {
    if (future.current.length) {
      past.current.push(current.current);
      show(future.current.pop()!);
    }
  };
  return {
    value,
    commit,
    replace,
    undo,
    redo,
    canUndo: !!past.current.length,
    canRedo: !!future.current.length,
  };
}
