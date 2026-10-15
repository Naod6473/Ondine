// Les raccourcis clavier globaux choisis par la personne (1.2.4) : champ
// « hotkey » des manifestes (src/settings/form.ts), règles et écriture.
//
// Forme enregistrée : celle que lit `tauri_plugin_global_shortcut::Shortcut`
// (« Ctrl+Alt+K », « Ctrl+Shift+F9 », « Super+Alt+Space ») : les
// modificateurs dans l'ordre Ctrl, Alt, Shift, Super, puis une touche.
// Les règles sont les mêmes que `check_hotkey` côté Rust
// (src-tauri/src/modules/askclaude_voice.rs) : au moins un modificateur sauf
// pour F1–F24, pas « Maj + une touche » (la frappe), pas un raccourci de
// Windows (Alt+F4, Ctrl+Alt+Suppr, Win+L…) ni d'édition (Ctrl+C…).
//
// Une lettre ou un chiffre est lu par `keyCode` (la touche « virtuelle » de
// Windows, celle qu'utilise RegisterHotKey) et non par `code` (sa place sur
// un clavier QWERTY) : sur un clavier AZERTY, appuyer sur A donne bien « A ».

export const MODIFIERS = ["Ctrl", "Alt", "Shift", "Super"] as const;
type Modifier = (typeof MODIFIERS)[number];

/** Les touches acceptées (noms du greffon), en plus des lettres, chiffres et F1–F24. */
const NAMED = [
  "Enter",
  "Space",
  "Tab",
  "Backspace",
  "Delete",
  "Insert",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Escape",
  "Pause",
  "PrintScreen",
  "ScrollLock",
  "Minus",
  "Equal",
  "Comma",
  "Period",
  "Slash",
  "Semicolon",
  "Quote",
  "BracketLeft",
  "BracketRight",
  "Backslash",
  "Backquote",
  "NumpadAdd",
  "NumpadSubtract",
  "NumpadMultiply",
  "NumpadDivide",
  "NumpadDecimal",
  "NumpadEnter",
  ...Array.from({ length: 10 }, (_, i) => `Numpad${i}`),
];

const FKEY = /^F([1-9]|1\d|2[0-4])$/;
const ALIASES: Record<string, string> = { esc: "Escape", up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", return: "Enter" };

/** Une touche (sans modificateur) sous son nom canonique, ou null. */
function canonicalKey(token: string): string | null {
  const t = token.trim();
  if (/^[a-z]$/i.test(t)) return t.toUpperCase();
  if (/^[0-9]$/.test(t)) return t;
  const key = /^Key([A-Z])$/i.exec(t);
  if (key) return key[1].toUpperCase();
  const digit = /^Digit([0-9])$/i.exec(t);
  if (digit) return digit[1];
  if (FKEY.test(t.toUpperCase())) return t.toUpperCase();
  const alias = ALIASES[t.toLowerCase()];
  if (alias) return alias;
  return NAMED.find((n) => n.toLowerCase() === t.toLowerCase()) ?? null;
}

function canonicalModifier(token: string): Modifier | null {
  switch (token.trim().toLowerCase()) {
    case "ctrl":
    case "control":
      return "Ctrl";
    case "alt":
    case "option":
      return "Alt";
    case "shift":
    case "maj":
      return "Shift";
    case "super":
    case "win":
    case "cmd":
    case "command":
      return "Super";
    default:
      return null;
  }
}

/** Un raccourci écrit à la main ou enregistré → sa forme canonique, ou null (illisible). */
export function normalizeHotkey(value: string): string | null {
  const tokens = value.split("+");
  if (!value.trim() || tokens.some((t) => !t.trim())) return null;
  const mods = new Set<Modifier>();
  let key: string | null = null;
  for (const token of tokens) {
    const m = canonicalModifier(token);
    if (m && !key) {
      mods.add(m);
      continue;
    }
    if (key) return null; // une seule touche, après les modificateurs
    key = canonicalKey(token);
    if (!key) return null;
  }
  if (!key) return null;
  return [...MODIFIERS.filter((m) => mods.has(m)), key].join("+");
}

/** Les morceaux d'un raccourci canonique. */
function parts(value: string): { mods: Modifier[]; key: string } {
  const tokens = value.split("+");
  return { mods: tokens.slice(0, -1) as Modifier[], key: tokens[tokens.length - 1] };
}

const WINDOWS_COMBOS = new Set([
  "Alt+F4",
  "Alt+Tab",
  "Alt+Shift+Tab",
  "Alt+Escape",
  "Alt+Space",
  "Ctrl+Escape",
  "Ctrl+Shift+Escape",
  "Ctrl+Alt+Delete",
  "Ctrl+Alt+Tab",
  ..."LDERIXASVHM".split("").map((k) => `Super+${k}`),
  "Super+Tab",
  "Super+Period",
  "Shift+Super+S",
  "Ctrl+Super+D",
  "Ctrl+Super+ArrowLeft",
  "Ctrl+Super+ArrowRight",
  "Ctrl+Super+F4",
  ..."0123456789".split("").map((k) => `Super+${k}`),
]);
const EDITING = new Set("ACFNOPSTVWXYZ".split(""));

/**
 * Pourquoi ce raccourci est refusé (une phrase), ou null s'il convient.
 * Mêmes règles que `check_hotkey` côté Rust.
 */
export function hotkeyProblem(value: string): string | null {
  const canonical = normalizeHotkey(value);
  if (!canonical) return "Raccourci illisible.";
  const { mods, key } = parts(canonical);
  const fkey = FKEY.test(key);
  if (!mods.length && !fkey) return "Il faut au moins une touche Ctrl, Alt, Maj ou Win (sauf pour F1 à F24).";
  if (!mods.length && key === "F12") return "F12 seule est réservée par Windows.";
  if (mods.length === 1 && mods[0] === "Shift" && !fkey) return "Maj seule avec une touche gênerait la frappe : ajoutez Ctrl, Alt ou Win.";
  if (WINDOWS_COMBOS.has(canonical)) return "Ce raccourci sert déjà à Windows.";
  if (mods.length === 1 && mods[0] === "Ctrl" && EDITING.has(key)) return "Ce raccourci sert à toutes les applis (copier, coller, enregistrer…).";
  return null;
}

/** Ce qu'on sait d'une touche pressée (un KeyboardEvent, ou ce qu'il en faut). */
export interface KeyPress {
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  code: string;
  keyCode: number;
}

/** Une touche pressée → le raccourci, ou seulement des modificateurs (`partial`), ou Échap. */
export function hotkeyFromEvent(e: KeyPress): { value: string } | { partial: string } | { cancel: true } {
  const mods: Modifier[] = [];
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (e.metaKey) mods.push("Super");
  if (e.code === "Escape" && !mods.length) return { cancel: true };
  let key: string | null = null;
  if (e.keyCode >= 65 && e.keyCode <= 90) key = String.fromCharCode(e.keyCode);
  else if (e.keyCode >= 48 && e.keyCode <= 57 && e.code.startsWith("Digit")) key = String.fromCharCode(e.keyCode);
  else if (!/^(Control|Alt|Shift|Meta|OS)(Left|Right)?$/.test(e.code)) key = canonicalKey(e.code);
  if (!key) return { partial: mods.join("+") };
  return { value: [...mods, key].join("+") };
}

const PRETTY_FR: Record<string, string> = {
  Shift: "Maj",
  Super: "Win",
  Enter: "Entrée",
  Space: "Espace",
  Delete: "Suppr",
  Insert: "Inser",
  Escape: "Échap",
  Backspace: "Retour arrière",
  Home: "Début",
  End: "Fin",
  PageUp: "Page préc.",
  PageDown: "Page suiv.",
  PrintScreen: "Impr. écran",
};
const PRETTY_EN: Record<string, string> = { Super: "Win", Escape: "Esc", PageUp: "Page Up", PageDown: "Page Down", PrintScreen: "Print Screen" };
const PRETTY_ANY: Record<string, string> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Minus: "-",
  Equal: "=",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Semicolon: ";",
  Quote: "'",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Backquote: "`",
  NumpadAdd: "Pavé +",
  NumpadSubtract: "Pavé -",
  NumpadMultiply: "Pavé *",
  NumpadDivide: "Pavé /",
  NumpadDecimal: "Pavé .",
  NumpadEnter: "Pavé Entrée",
};

/** Un raccourci à lire : « Ctrl + Alt + Maj + K » (« Shift » en anglais). */
export function prettyHotkey(value: string, lang = "fr"): string {
  const canonical = normalizeHotkey(value);
  if (!canonical) return value;
  const words = lang === "fr" ? PRETTY_FR : PRETTY_EN;
  return canonical
    .split("+")
    .map((t) => {
      const any = PRETTY_ANY[t];
      if (any) return lang === "fr" ? any : any.replace("Pavé", "Num").replace("Entrée", "Enter");
      const numpad = /^Numpad(\d)$/.exec(t);
      if (numpad) return `${lang === "fr" ? "Pavé" : "Num"} ${numpad[1]}`;
      return words[t] ?? t;
    })
    .join(" + ");
}

/** La valeur à garder pour un champ « hotkey » (vide = aucun, un choix proposé, ou un raccourci valable). */
export function coerceHotkey(value: unknown, presets: string[], fallback: string): string {
  if (typeof value !== "string") return fallback;
  const v = value.trim();
  if (!v || presets.includes(v)) return v;
  const canonical = normalizeHotkey(v);
  return canonical && !hotkeyProblem(canonical) ? canonical : fallback;
}
