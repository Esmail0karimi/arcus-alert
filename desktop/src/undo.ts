/* One shared undo/redo journal (Ctrl+Z / Ctrl+Y) for alerts, horizontal lines, trend lines and text notes. */
export type UndoEntry = { tag: string; undo: () => void; redo: () => void };
const U: UndoEntry[] = [],
  R: UndoEntry[] = [];
export const undoManager = {
  push(e: UndoEntry) {
    U.push(e);
    if (U.length > 200) U.shift();
    R.length = 0;
  },
  undo(): boolean {
    const e = U.pop();
    if (!e) return false;
    try {
      e.undo();
    } catch {}
    R.push(e);
    return true;
  },
  redo(): boolean {
    const e = R.pop();
    if (!e) return false;
    try {
      e.redo();
    } catch {}
    U.push(e);
    return true;
  },
  /** Forget entries of one kind (e.g. chart annotations when the symbol changes). */
  drop(tag: string) {
    for (const list of [U, R])
      for (let i = list.length - 1; i >= 0; i--) if (list[i].tag === tag) list.splice(i, 1);
  },
};
