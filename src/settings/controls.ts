// Les briques de la fenêtre de réglages, toutes dans le même style :
//   - group() : un bloc arrondi en verre dépoli, avec un titre au-dessus ;
//   - row()   : une ligne du bloc, le libellé à gauche, la commande à droite ;
//   - toggle(), segmented(), select(), stepper() : les commandes.
//
// Chaque commande appelle `onChange` avec la nouvelle valeur ; c'est la page
// qui l'enregistre. Rien ici ne connaît les réglages eux-mêmes.

import { el } from "../island/dom";

type Child = Node | string | null | undefined | false;

/** Un bloc de lignes, avec un titre (et une note sous le bloc, si besoin). */
export function group(title: string | null, rows: Child[], note?: string): HTMLElement {
  return el(
    "section",
    { class: "group" },
    title ? el("h3", { class: "group-title" }, title) : null,
    el("div", { class: "group-body" }, ...rows.filter(Boolean)),
    note ? el("p", { class: "group-note" }, note) : null,
  );
}

/**
 * Une ligne : libellé (et aide en petit) à gauche, commande à droite.
 * `key` sert à la recherche : on peut faire défiler jusqu'à la ligne et la
 * faire briller.
 */
export function row(label: string, control: Child, help?: string, key?: string): HTMLElement {
  return el(
    "div",
    { class: "row", "data-key": key ?? label },
    el("div", { class: "row-text" }, el("div", { class: "row-label" }, label), help ? el("div", { class: "row-help" }, help) : null),
    control ? el("div", { class: "row-control" }, control) : null,
  );
}

/** Une ligne pleine largeur (liste de dossiers, boutons…), sous un libellé. */
export function wideRow(label: string | null, content: Child, help?: string, key?: string): HTMLElement {
  return el(
    "div",
    { class: "row wide", "data-key": key ?? label ?? "" },
    label ? el("div", { class: "row-text" }, el("div", { class: "row-label" }, label), help ? el("div", { class: "row-help" }, help) : null) : null,
    el("div", { class: "row-wide" }, content),
  );
}

/** Un interrupteur façon iOS (une vraie case à cocher, donc accessible au clavier). */
export function toggle(value: boolean, onChange: (v: boolean) => void, label = ""): HTMLElement {
  const input = el("input", { type: "checkbox", role: "switch", "aria-label": label }) as HTMLInputElement;
  input.checked = value;
  input.addEventListener("change", () => onChange(input.checked));
  return el("label", { class: "toggle" }, input, el("span", { class: "toggle-track" }, el("span", { class: "toggle-thumb" })));
}

/**
 * Un choix parmi quelques options, en boutons collés. Une pastille glisse
 * sous l'option choisie.
 */
export function segmented(value: string, options: [string, string][], onChange: (v: string) => void): HTMLElement {
  const box = el("div", { class: "segmented", role: "radiogroup" });
  const thumb = el("span", { class: "segmented-thumb" });
  box.append(thumb);
  const buttons = options.map(([v, l]) => {
    const b = el("button", { type: "button", role: "radio", "aria-checked": String(v === value) }, l);
    b.addEventListener("click", () => {
      if (v === value) return;
      value = v;
      place();
      onChange(v);
    });
    box.append(b);
    return [v, b] as const;
  });
  const place = () => {
    for (const [v, b] of buttons) {
      b.setAttribute("aria-checked", String(v === value));
      b.classList.toggle("on", v === value);
    }
    const on = buttons.find(([v]) => v === value)?.[1];
    if (!on) return;
    thumb.style.width = `${on.offsetWidth}px`;
    thumb.style.transform = `translateX(${on.offsetLeft}px)`;
  };
  // La taille des boutons n'est connue qu'une fois la page affichée.
  requestAnimationFrame(() => {
    thumb.classList.add("instant");
    place();
    requestAnimationFrame(() => thumb.classList.remove("instant"));
  });
  new ResizeObserver(place).observe(box);
  return box;
}

/** Une liste déroulante. Au-delà de trois options, c'est plus lisible qu'un segmenté. */
export function select(value: string, options: [string, string][], onChange: (v: string) => void): HTMLElement {
  const s = el("select", { class: "select" }) as HTMLSelectElement;
  for (const [v, l] of options) s.append(el("option", { value: v }, l));
  s.value = value;
  s.addEventListener("change", () => onChange(s.value));
  return s;
}

/** Le bon contrôle pour un choix : segmenté pour 2-3 options courtes, sinon une liste. */
export function choice(value: string, options: [string, string][], onChange: (v: string) => void): HTMLElement {
  const short = options.length <= 3 && options.every(([, l]) => l.length <= 16);
  return short ? segmented(value, options, onChange) : select(value, options, onChange);
}

/** Un nombre, avec − et + de chaque côté (et une unité après). */
export function stepper(value: number, min: number, max: number, onChange: (v: number) => void, step = 1, unit = ""): HTMLElement {
  const input = el("input", { type: "number", min, max, step, class: "stepper-input" }) as HTMLInputElement;
  input.value = String(value);
  const set = (v: number) => {
    // On arrondit au pas (0,5 s…) et on reste entre min et max.
    const rounded = Math.round(v / step) * step;
    const clamped = Math.min(max, Math.max(min, Number(rounded.toFixed(4))));
    input.value = String(clamped);
    minus.disabled = clamped <= min;
    plus.disabled = clamped >= max;
    if (clamped !== value) {
      value = clamped;
      onChange(clamped);
    }
  };
  const minus = el("button", { type: "button", class: "stepper-btn", "aria-label": "Moins", onclick: () => set(value - step) }, "−");
  const plus = el("button", { type: "button", class: "stepper-btn", "aria-label": "Plus", onclick: () => set(value + step) }, "+");
  minus.disabled = value <= min;
  plus.disabled = value >= max;
  input.addEventListener("change", () => set(Number(input.value) || min));
  return el("div", { class: "stepper" }, minus, input, plus, unit ? el("span", { class: "stepper-unit" }, unit) : null);
}

/** Une petite étiquette (permission, état…). */
export function chip(text: string, tone: "" | "warn" | "ok" = ""): HTMLElement {
  return el("span", { class: `chip ${tone}` }, text);
}
