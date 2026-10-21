// Le menu de choix des Réglages (1.2.4), en verre : une pilule qui montre le
// choix actuel, et une liste qui sort du bouton avec un ressort, une pastille
// qui suit la souris (ou les flèches) et une coche sur le choix actuel.
//
// Le vrai <select> reste dans la page, caché : c'est lui qui garde la valeur.
// Choisir dans la liste change sa valeur et envoie « change » (et « input »),
// exactement comme avant ; le code qui lit `select.value` ou qui écoute
// « change » ne voit aucune différence. Si le code change la valeur
// (`select.value = …`) ou les options, la pilule suit.
//
// Clavier : sur la pilule, ↓ ↑ Entrée ou Espace ouvrent ; dans la liste, ↓ ↑
// Début Fin déplacent, une lettre va au premier choix qui commence par elle,
// Entrée ou Espace choisissent, Échap referme, Tab referme et continue.
// Lecteur d'écran : bouton aria-haspopup="listbox", liste role="listbox",
// choix role="option" aria-selected.

import { el } from "../island/dom";
import { reducedMotion } from "../island/tab-pill";

const ENHANCED = new WeakSet<HTMLSelectElement>();
/** Une classe de plus sur la liste d'un menu (l'île la décore à sa façon : « Se voir » de l'Agenda). */
const MENU_CLASS = new WeakMap<HTMLSelectElement, string>();
let listId = 0;

/** La liste ouverte (une seule à la fois). */
let open: { menu: HTMLElement; button: HTMLButtonElement; select: HTMLSelectElement } | null = null;

const CHEVRON = '<svg class="gsel-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>';
const CHECK = '<svg class="gsel-check" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>';

/** Le texte du choix actuel d'un <select>. */
function shownText(select: HTMLSelectElement): string {
  return select.selectedOptions[0]?.textContent ?? select.options[0]?.textContent ?? "";
}

/**
 * Habille un <select> : renvoie la pilule (qui contient le <select> caché).
 * Un <select> déjà habillé renvoie son habit.
 */
export function glassSelect(select: HTMLSelectElement, opts: { menuClass?: string } = {}): HTMLElement {
  if (ENHANCED.has(select)) return (select.closest(".gsel") as HTMLElement) ?? select;
  ENHANCED.add(select);
  if (opts.menuClass) MENU_CLASS.set(select, opts.menuClass);
  const value = el("span", { class: "gsel-value" });
  const button = el("button", { type: "button", class: "gsel-btn", "aria-haspopup": "listbox", "aria-expanded": "false" }, value) as HTMLButtonElement;
  button.insertAdjacentHTML("beforeend", CHEVRON);
  const box = el("span", { class: "gsel" });
  // Le <select> garde sa place dans la page (pour un lien profond, un formulaire), caché.
  select.parentNode?.insertBefore(box, select);
  box.append(button, select);
  select.classList.add("gsel-native");
  select.tabIndex = -1;
  select.setAttribute("aria-hidden", "true");

  const sync = () => {
    value.textContent = shownText(select);
    button.disabled = select.disabled;
    // Le nom du menu : celui du <select> (aria-label, ou la ligne qui le décrit).
    for (const attr of ["aria-label", "aria-labelledby", "aria-describedby", "title"]) {
      const v = box.getAttribute(attr) ?? select.getAttribute(attr);
      if (v) button.setAttribute(attr, v);
    }
    if (box.hasAttribute("aria-label")) box.removeAttribute("aria-label");
  };
  // `select.value = …` (ou selectedIndex) écrit par le code : la pilule suit.
  for (const prop of ["value", "selectedIndex"] as const) {
    const d = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, prop);
    if (!d?.get || !d.set) continue;
    Object.defineProperty(select, prop, {
      configurable: true,
      get() {
        return d.get!.call(this);
      },
      set(v: unknown) {
        d.set!.call(this, v);
        sync();
      },
    });
  }
  select.addEventListener("change", sync);
  new MutationObserver(sync).observe(select, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["disabled", "aria-label", "aria-labelledby", "aria-describedby"] });
  new MutationObserver(sync).observe(box, { attributes: true, attributeFilter: ["aria-label"] });
  button.addEventListener("click", () => (open?.button === button ? close(true) : show(button, select)));
  button.addEventListener("keydown", (e) => {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
      e.preventDefault();
      if (open?.button !== button) show(button, select);
    }
  });
  sync();
  return box;
}

/** Habille tous les <select> pas encore habillés sous `root`. */
export function upgradeSelects(root: ParentNode) {
  for (const s of root.querySelectorAll<HTMLSelectElement>("select")) if (!ENHANCED.has(s)) glassSelect(s);
}

/** Referme la liste ouverte ; `focus` : rend la main à la pilule. */
export function close(focus = false) {
  if (!open) return;
  const { menu, button } = open;
  open = null;
  button.setAttribute("aria-expanded", "false");
  button.removeAttribute("aria-controls");
  if (focus) button.focus();
  if (reducedMotion()) return menu.remove();
  menu.classList.add("out");
  window.setTimeout(() => menu.remove(), 150);
}

function show(button: HTMLButtonElement, select: HTMLSelectElement) {
  close();
  if (button.disabled) return;
  const id = `gsel-list-${++listId}`;
  const menu = el("div", { class: `gsel-menu ${MENU_CLASS.get(select) ?? ""}`.trim(), role: "listbox", id, tabindex: "-1" });
  const label = button.getAttribute("aria-label");
  if (label) menu.setAttribute("aria-label", label);
  else if (button.getAttribute("aria-labelledby")) menu.setAttribute("aria-labelledby", button.getAttribute("aria-labelledby")!);
  const hl = el("span", { class: "gsel-hl", "aria-hidden": "true" });
  menu.append(hl);
  const items: HTMLElement[] = [...select.options].map((o, i) => {
    const item = el(
      "div",
      { class: "gsel-option", role: "option", id: `${id}-${i}`, tabindex: "-1", "aria-selected": String(o.selected), "aria-disabled": o.disabled ? "true" : undefined, "data-index": i },
      el("span", { class: "gsel-option-text" }, o.textContent ?? ""),
    );
    item.insertAdjacentHTML("afterbegin", CHECK);
    item.style.animationDelay = `${Math.min(i, 6) * 15}ms`;
    menu.append(item);
    return item;
  });
  document.body.append(menu);
  // Sous la pilule, alignée à droite ; au-dessus si la place manque en bas.
  const r = button.getBoundingClientRect();
  const width = Math.max(menu.offsetWidth, r.width);
  menu.style.minWidth = `${width}px`;
  const room = innerHeight - r.bottom - 12;
  const up = room < Math.min(menu.offsetHeight, 260) && r.top > room;
  menu.style.maxHeight = `${Math.max(140, (up ? r.top : innerHeight - r.bottom) - 18)}px`;
  const h = menu.offsetHeight;
  menu.classList.toggle("up", up);
  menu.style.left = `${Math.max(8, Math.min(innerWidth - width - 8, r.right - width))}px`;
  menu.style.top = `${up ? r.top - 6 - h : r.bottom + 6}px`;
  button.setAttribute("aria-expanded", "true");
  button.setAttribute("aria-controls", id);
  open = { menu, button, select };

  const usable = (item: HTMLElement) => item.getAttribute("aria-disabled") !== "true";
  const hover = (item: HTMLElement) => {
    hl.style.opacity = "1";
    hl.style.transform = `translateY(${item.offsetTop}px)`;
    hl.style.height = `${item.offsetHeight}px`;
    item.focus({ preventScroll: true });
    item.scrollIntoView({ block: "nearest" });
  };
  const pick = (item: HTMLElement) => {
    if (!usable(item)) return;
    const index = Number(item.dataset.index);
    for (const x of items) x.setAttribute("aria-selected", String(x === item));
    if (select.selectedIndex !== index) {
      select.selectedIndex = index;
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
    // La coche a le temps de se poser avant que la liste se referme.
    window.setTimeout(() => {
      if (open?.menu === menu) close(true);
    }, reducedMotion() ? 0 : 140);
  };
  for (const item of items) {
    item.addEventListener("pointerenter", () => usable(item) && hover(item));
    item.addEventListener("click", () => pick(item));
  }
  menu.addEventListener("pointerleave", () => (hl.style.opacity = "0"));
  const start = items.find((x) => x.getAttribute("aria-selected") === "true") ?? items.find(usable) ?? items[0];
  requestAnimationFrame(() => start && open?.menu === menu && hover(start));
  menu.addEventListener("keydown", (e) => {
    const now = items.indexOf(document.activeElement as HTMLElement);
    const step = (from: number, delta: number) => {
      for (let n = 1; n <= items.length; n++) {
        const next = items[(from + delta * n + items.length * n) % items.length];
        if (usable(next)) return next;
      }
      return null;
    };
    let target: HTMLElement | null = null;
    if (e.key === "ArrowDown") target = step(now, 1);
    else if (e.key === "ArrowUp") target = step(now < 0 ? 0 : now, -1);
    else if (e.key === "Home") target = items.find(usable) ?? null;
    else if (e.key === "End") target = [...items].reverse().find(usable) ?? null;
    else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (now >= 0) pick(items[now]);
      return;
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
      return;
    } else if (e.key === "Tab") {
      // La pilule reprend la main : Tab continue vers le champ suivant.
      close(true);
      return;
    } else if (e.key.length === 1 && /\S/.test(e.key)) {
      const k = e.key.toLowerCase();
      target = items.slice(now + 1).concat(items.slice(0, now + 1)).find((x) => usable(x) && (x.textContent ?? "").trim().toLowerCase().startsWith(k)) ?? null;
    } else return;
    e.preventDefault();
    if (target) hover(target);
  });
}

// Un clic ailleurs, la fenêtre qui change de taille ou la page qui défile : la liste se referme.
document.addEventListener("pointerdown", (e) => {
  if (open && !open.menu.contains(e.target as Node) && !open.button.contains(e.target as Node)) close();
});
window.addEventListener("resize", () => close());
document.addEventListener(
  "scroll",
  (e) => {
    if (open && !open.menu.contains(e.target as Node)) close();
  },
  true,
);
