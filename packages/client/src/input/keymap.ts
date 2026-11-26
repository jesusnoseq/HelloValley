/**
 * Remappable game keys (build plan M37, GDD §10). Every game action has one key
 * (`KeyboardEvent.code`, so the binding follows the key's position on any layout); a few keys are
 * fixed and never remapped: Escape (closes things everywhere), the arrow keys (always walk, and
 * move focus inside panels), the digits (emotes) and Tab inside text fields. Pure: no DOM, no
 * shared values (it is in the entry chunk).
 */

export const GAME_ACTIONS = [
  "moveUp",
  "moveDown",
  "moveLeft",
  "moveRight",
  "run",
  "interact",
  "rotateLeft",
  "rotateRight",
  "chat",
  "inventory",
  "notebook",
  "quests",
  "use",
  "rotateItem",
] as const;
export type GameAction = (typeof GAME_ACTIONS)[number];

export type Keymap = Readonly<Record<GameAction, string>>;

/** GDD §10: WASD (and the arrows), Shift run, F interact, Q/E rotate, Enter chat, Tab bag, N notebook. */
export const DEFAULT_KEYMAP: Keymap = {
  moveUp: "KeyW",
  moveDown: "KeyS",
  moveLeft: "KeyA",
  moveRight: "KeyD",
  run: "ShiftLeft",
  interact: "KeyF",
  rotateLeft: "KeyQ",
  rotateRight: "KeyE",
  chat: "Enter",
  inventory: "Tab",
  notebook: "KeyN",
  // The quest log (M30).
  quests: "KeyJ",
  // Cast and reel (M27), eat from the hotbar (M29).
  use: "Space",
  // Turn the held furniture (M17).
  rotateItem: "KeyR",
};

/** Arrow keys always walk too (fixed alternates of the four move actions). */
export const ARROW_MOVES: Readonly<Record<string, GameAction>> = {
  ArrowUp: "moveUp",
  ArrowDown: "moveDown",
  ArrowLeft: "moveLeft",
  ArrowRight: "moveRight",
};

/** Keys a game action can never take. */
export function isReservedKey(code: string): boolean {
  return (
    code === "Escape" ||
    code in ARROW_MOVES ||
    /^(?:Digit|Numpad)[0-9]$/.test(code) ||
    /^(?:Meta|OS|Context|F\d+$)/.test(code) ||
    code === "" ||
    code === "Unidentified"
  );
}

/** Left and right modifiers (and the two Enter keys) count as the same key. */
export function normalizeKeyCode(code: string): string {
  switch (code) {
    case "ShiftRight":
      return "ShiftLeft";
    case "ControlRight":
      return "ControlLeft";
    case "AltRight":
      return "AltLeft";
    case "NumpadEnter":
      return "Enter";
    default:
      return code;
  }
}

/** True when `code` is the key bound to `action` (arrows count for the move actions). */
export function matchesAction(keymap: Keymap, action: GameAction, code: string): boolean {
  const c = normalizeKeyCode(code);
  return keymap[action] === c || ARROW_MOVES[c] === action;
}

/** The action a key triggers, if any. */
export function actionForKey(keymap: Keymap, code: string): GameAction | null {
  const c = normalizeKeyCode(code);
  if (ARROW_MOVES[c]) return ARROW_MOVES[c];
  return GAME_ACTIONS.find((a) => keymap[a] === c) ?? null;
}

export type RebindResult = { ok: true; keymap: Keymap; swappedWith: GameAction | null } | { ok: false; reason: "reserved" };

/**
 * Bind `action` to `code`. A key already used by another action swaps: that action takes this
 * action's old key, so no action is ever left without one.
 */
export function rebindKey(keymap: Keymap, action: GameAction, code: string): RebindResult {
  const c = normalizeKeyCode(code);
  if (isReservedKey(c)) return { ok: false, reason: "reserved" };
  const other = GAME_ACTIONS.find((a) => a !== action && keymap[a] === c) ?? null;
  const next = { ...keymap, [action]: c };
  if (other) next[other] = keymap[action];
  return { ok: true, keymap: next, swappedWith: other };
}

/** A keymap from saved data: unknown actions and reserved keys fall back, duplicates are undone. */
export function parseKeymap(raw: unknown): Keymap {
  const out: Record<GameAction, string> = { ...DEFAULT_KEYMAP };
  if (raw && typeof raw === "object") {
    for (const action of GAME_ACTIONS) {
      const v = (raw as Record<string, unknown>)[action];
      if (typeof v === "string" && v.length <= 32 && !isReservedKey(normalizeKeyCode(v))) out[action] = normalizeKeyCode(v);
    }
  }
  const used = new Set<string>();
  for (const action of GAME_ACTIONS) {
    if (used.has(out[action])) return { ...DEFAULT_KEYMAP };
    used.add(out[action]);
  }
  return out;
}

const NAMED: Readonly<Record<string, string>> = {
  ShiftLeft: "Shift",
  ControlLeft: "Ctrl",
  AltLeft: "Alt",
  Space: "Space",
  Enter: "Enter",
  Tab: "Tab",
  Backspace: "Backspace",
  CapsLock: "Caps Lock",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
};

/** A short label for a key code ("KeyF" → "F", "ShiftLeft" → "Shift"). */
export function keyLabel(code: string): string {
  const c = normalizeKeyCode(code);
  if (NAMED[c]) return NAMED[c];
  const m = /^(?:Key|Digit)(.)$/.exec(c) ?? /^Numpad(.+)$/.exec(c);
  if (m) return m[1]!;
  return c;
}

/** The `aria-keyshortcuts` value for a key code (WAI-ARIA key names). */
export function ariaKey(code: string): string {
  const label = keyLabel(code);
  return label === "Ctrl" ? "Control" : label;
}
