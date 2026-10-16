// « Qu'est-ce qui remplit mon disque ? » : le panneau de l'onglet Système.
//
// Il prend la place du contenu de l'onglet, avec deux parties :
//   - la carte : les plus gros dossiers en barres, ou en carte proportionnelle
//     (au choix, retenu sur ce PC). Un clic descend dans un dossier, « ← »
//     remonte, le chemin (fil d'Ariane) ramène plus haut, « Ouvrir dans
//     l'Explorateur ». L'analyse tourne en Rust dans un fil à part
//     (system_disk.rs) : à chaque `system.disk-scan`, on redemande la vue du
//     dossier affiché, qui se remplit au fur et à mesure ;
//   - « Faire de la place » : chaque nettoyage avec la place gagnée estimée et
//     une confirmation. Pendant le nettoyage, Ondine passe un coup de balai
//     (scène « sweep » de src/island/scenes/) et travaille (task.started).
//
// La logique sans DOM (tailles, carte, textes) est dans disk-logic.ts.

import "../../styles/disk.css";
import { errorText } from "../../core/log";
import type { ModuleApi } from "../../core/module-types";
import { el } from "../../island/dom";
import { motionOn, staggerIn } from "../../island/motion";
import { blocksOf, bytesText, checkedBytes, cleanLines, cleanResult, rootLabel, shareText, statusParts, treemap, type Block, type CleanLine, type DiskEstimate, type DiskView } from "./disk-logic";

const MODE_KEY = "system.diskMode";

function savedMode(): "bars" | "map" {
  try {
    return localStorage.getItem(MODE_KEY) === "map" ? "map" : "bars";
  } catch {
    return "bars";
  }
}

/** Le panneau du disque pour `rootPath` (« C:\ »). `close` : revenir à l'onglet Système. */
export function diskPane(api: ModuleApi, rootPath: string, close: () => void): { node: HTMLElement; stop(): void } {
  let job = 0;
  let nodeId = 0;
  let mode = savedMode();
  let view: DiskView | null = null;
  let alive = true;
  let part: "map" | "clean" = "map";

  const back = el("button", { class: "btn small disk-back", title: "Remonter", onclick: () => goUp() }, "←");
  const crumbs = el("div", { class: "disk-crumbs", "data-no-i18n": true });
  const status = el("div", { class: "disk-status muted", "aria-live": "polite" }, "Analyse en cours…");
  const stopBtn = el("button", { class: "btn small", onclick: api.handler(() => api.invoke("disk_cancel", { job })) }, "Arrêter");
  const openBtn = el("button", { class: "btn small", title: "Ouvrir ce dossier dans l'Explorateur", onclick: api.handler(() => api.invoke("disk_open", { job, node: nodeId })) }, "📂 Ouvrir dans l'Explorateur");
  const modeBtn = el("button", { class: "btn small", onclick: () => setMode(mode === "bars" ? "map" : "bars") }, "");
  const cleanBtn = el("button", { class: "btn small primary", onclick: () => showPart(part === "map" ? "clean" : "map") }, "");
  const body = el("div", { class: "disk-body" });
  const sub = el("div", { class: "disk-sub" }, status, el("div", { class: "btn-row" }, stopBtn, openBtn));
  const node = el("div", { class: "disk" }, el("div", { class: "disk-head" }, back, crumbs, el("div", { class: "btn-row" }, modeBtn, cleanBtn)), sub, body);

  const labelButtons = () => {
    modeBtn.textContent = mode === "bars" ? "Carte" : "Barres";
    modeBtn.title = mode === "bars" ? "Voir en carte proportionnelle" : "Voir en barres";
    cleanBtn.textContent = part === "map" ? "🧹 Faire de la place" : "← La carte";
    modeBtn.hidden = part !== "map";
    sub.hidden = part !== "map";
  };
  labelButtons();

  const setMode = (m: "bars" | "map") => {
    mode = m;
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      // stockage indisponible : le choix vaut pour cette fois
    }
    labelButtons();
    if (view) draw(view, true);
  };

  const goUp = () => {
    if (part === "clean") return showPart("map");
    const c = view?.crumbs ?? [];
    if (c.length < 2) return close();
    open(c[c.length - 2].id);
  };

  const open = (id: number) => {
    nodeId = id;
    void refresh(true);
  };

  // ── La carte ──
  let inFlight = false;
  let again = false;
  const refresh = async (moved = false) => {
    if (!job || part !== "map") return;
    if (inFlight) {
      again = true;
      return;
    }
    inFlight = true;
    try {
      const v = await api.invoke<DiskView>("disk_view", { job, node: nodeId });
      if (alive) draw(v, moved);
    } catch (err) {
      if (alive) status.textContent = errorText(err);
    } finally {
      inFlight = false;
      if (again && alive) {
        again = false;
        void refresh();
      }
    }
  };

  // Les lignes déjà dessinées, par clé : elles glissent à leur nouvelle taille au lieu d'être refaites.
  let rows = new Map<string, HTMLElement>();
  let drawnFor = "";

  const draw = (v: DiskView, moved: boolean) => {
    view = v;
    crumbs.replaceChildren(
      ...v.crumbs.flatMap((c, i) => {
        const label = i === 0 ? rootLabel(c.name) : c.name;
        const last = i === v.crumbs.length - 1;
        const item = last ? el("b", {}, label) : el("button", { class: "link-btn", onclick: () => open(c.id) }, label);
        return i ? [el("span", { class: "muted" }, " › "), item] : [item];
      }),
    );
    status.replaceChildren(el("b", {}, bytesText(v.node.bytes)), ...statusParts(v).flatMap((p) => [el("span", { class: "disk-dot" }, " · "), el("span", {}, p)]));
    stopBtn.hidden = v.done;
    const key = `${mode}:${v.node.id}`;
    if (key !== drawnFor) {
      drawnFor = key;
      rows = new Map();
      body.replaceChildren();
      moved = true;
    }
    const blocks = blocksOf(v);
    if (!blocks.length) {
      body.replaceChildren(el("p", { class: "muted disk-empty" }, v.done ? "Ce dossier est vide." : "Lecture du dossier…"));
      rows = new Map();
      drawnFor = "";
      return;
    }
    if (mode === "bars") drawBars(v, blocks);
    else drawMap(v, blocks);
    drawBig(v);
    if (moved) staggerIn(body, 0);
  };

  const pick = (b: Block) => {
    if (b.kind === "dir" && b.id !== undefined) open(b.id);
  };

  const drawBars = (v: DiskView, blocks: Block[]) => {
    let list = body.querySelector<HTMLElement>(".disk-bars");
    if (!list) {
      list = el("div", { class: "disk-bars", role: "list" });
      body.prepend(list);
    }
    const max = Math.max(1, ...blocks.map((b) => b.bytes));
    const keep = new Set(blocks.map((b) => b.key));
    for (const [k, r] of rows) if (!keep.has(k)) (r.remove(), rows.delete(k));
    for (const b of blocks) {
      let r = rows.get(b.key);
      if (!r) {
        const bar = el("i", {});
        r = el(
          b.kind === "dir" ? "button" : "div",
          { class: `disk-row ${b.kind}`, role: "listitem", title: b.kind === "dir" ? "Voir ce qu'il contient" : undefined, onclick: () => pick(b) },
          el("span", { class: "disk-name", "data-no-i18n": b.kind === "dir" ? true : undefined }, b.kind === "dir" ? `📁 ${b.label}` : b.label),
          el("span", { class: "disk-bar" }, bar),
          el("span", { class: "disk-size" }, ""),
          el("span", { class: "disk-pct muted" }, ""),
        );
        rows.set(b.key, r);
      }
      list.append(r); // dans l'ordre (déplace la ligne si elle existe)
      r.classList.toggle("busy", b.kind === "dir" && !b.done && !v.done);
      (r.querySelector(".disk-bar i") as HTMLElement).style.transform = `scaleX(${b.bytes / max})`;
      r.querySelector(".disk-size")!.textContent = bytesText(b.bytes);
      r.querySelector(".disk-pct")!.textContent = shareText(b.bytes, v.node.bytes);
    }
  };

  const drawMap = (v: DiskView, blocks: Block[]) => {
    let map = body.querySelector<HTMLElement>(".disk-map");
    if (!map) {
      map = el("div", { class: "disk-map", role: "list" });
      body.prepend(map);
    }
    const ratio = Math.max(1, (map.clientWidth || 600) / (map.clientHeight || 200));
    const tiles = new Map(treemap(blocks, ratio).map((t) => [t.key, t]));
    const keep = new Set(tiles.keys());
    for (const [k, r] of rows) if (!keep.has(k)) (r.remove(), rows.delete(k));
    blocks.forEach((b, i) => {
      const t = tiles.get(b.key);
      if (!t) return;
      let r = rows.get(b.key);
      if (!r) {
        r = el(
          b.kind === "dir" ? "button" : "div",
          { class: `disk-tile ${b.kind}`, role: "listitem", onclick: () => pick(b) },
          el("span", { class: "disk-name", "data-no-i18n": b.kind === "dir" ? true : undefined }, b.label),
          el("span", { class: "disk-size" }, ""),
        );
        map.append(r);
        rows.set(b.key, r);
      }
      r.style.setProperty("--i", String(i));
      Object.assign(r.style, { left: `${t.x * 100}%`, top: `${t.y * 100}%`, width: `${t.w * 100}%`, height: `${t.h * 100}%` });
      r.classList.toggle("busy", b.kind === "dir" && !b.done && !v.done);
      r.classList.toggle("tiny", t.w * t.h < 0.012);
      r.title = b.label;
      r.querySelector(".disk-size")!.textContent = bytesText(b.bytes);
    });
  };

  /** Les plus gros fichiers posés dans ce dossier (« Montrer » : dans l'Explorateur). */
  const drawBig = (v: DiskView) => {
    body.querySelector(".disk-big")?.remove();
    if (!v.big.length) return;
    body.append(
      el(
        "div",
        { class: "disk-big" },
        el("div", { class: "sys-title muted" }, "Plus gros fichiers ici"),
        ...v.big.slice(0, 4).map((f) =>
          el(
            "div",
            { class: "disk-file" },
            el("span", { class: "disk-name", "data-no-i18n": true }, f.name),
            el("span", { class: "disk-size" }, bytesText(f.bytes)),
            el("button", { class: "link-btn", title: "Montrer dans l'Explorateur", onclick: api.handler(() => api.invoke("disk_open", { path: f.path })) }, "Montrer"),
          ),
        ),
      ),
    );
  };

  // ── Faire de la place ──
  const showPart = (p: "map" | "clean") => {
    part = p;
    labelButtons();
    drawnFor = "";
    rows = new Map();
    body.replaceChildren();
    if (p === "map") void refresh(true);
    else void loadClean();
  };

  let estimate: DiskEstimate | null = null;
  let running = false;
  const checked = new Set<string>();

  const loadClean = async () => {
    body.replaceChildren(el("p", { class: "muted disk-empty" }, "Calcul de la place à gagner…"));
    try {
      estimate = await api.invoke<DiskEstimate>("disk_estimate");
      checked.clear();
      for (const i of estimate.downloads.items) checked.add(i.path);
      if (alive && part === "clean") drawClean(true);
    } catch (err) {
      if (alive) body.replaceChildren(el("p", { class: "muted disk-empty" }, errorText(err)));
    }
  };

  const drawClean = (enter = false) => {
    if (!estimate) return;
    const lines = cleanLines(estimate);
    const box = el(
      "div",
      { class: "disk-clean", role: "list" },
      ...lines.map((l) => cleanRow(l)),
      el("p", { class: "muted tool-note" }, "Rien d'autre n'est jamais supprimé. Les dossiers exclus (Confidentialité) ne sont pas touchés."),
    );
    body.replaceChildren(box);
    if (enter) staggerIn(box, 0);
  };

  const cleanRow = (l: CleanLine): HTMLElement => {
    const size = el("b", { class: "disk-size", title: "Estimation" }, l.empty ? "" : "≈ ", l.empty ? "" : el("span", {}, bytesText(l.bytes)));
    const actions = el("div", { class: "btn-row" });
    const extra = el("div", { class: "disk-extra" });
    const row = el(
      "div",
      { class: `disk-cl${l.empty ? " empty" : ""}`, role: "listitem" },
      el("div", { class: "disk-cl-main" }, el("span", { class: "disk-cl-icon" }, l.icon), el("div", { class: "disk-cl-text" }, el("span", {}, l.label), el("small", { class: "muted" }, l.detail)), size, actions),
      extra,
    );
    const idle = () => {
      const go = el("button", { class: "btn small", disabled: l.empty || running, onclick: () => (l.kind === "downloads" ? toggleDownloads() : ask()) }, l.action);
      actions.replaceChildren(go);
    };
    const ask = (text = l.confirm, paths?: string[]) => {
      const yes = el("button", { class: "btn small danger", onclick: api.handler(() => run(l.kind, paths)) }, "Confirmer");
      const no = el("button", { class: "btn small", onclick: () => (idle(), l.kind === "downloads" ? drawDownloads() : extra.replaceChildren()) }, "Annuler");
      if (l.kind !== "downloads") actions.replaceChildren();
      extra.replaceChildren(el("div", { class: "disk-ask" }, el("span", {}, text), el("div", { class: "btn-row" }, yes, no)));
      yes.focus();
    };
    const toggleDownloads = () => {
      if (extra.childElementCount) return extra.replaceChildren();
      drawDownloads();
    };
    const drawDownloads = () => {
      if (!estimate) return;
      const items = estimate.downloads.items;
      const total = el("b", {}, bytesText(checkedBytes(items, checked)));
      const send = el("button", { class: "btn small primary", disabled: !checked.size }, "Envoyer à la Corbeille");
      const refreshTotal = () => {
        total.textContent = bytesText(checkedBytes(items, checked));
        (send as HTMLButtonElement).disabled = !checked.size;
      };
      send.addEventListener("click", () => {
        const paths = items.filter((i) => checked.has(i.path)).map((i) => i.path);
        ask(`Envoyer ${paths.length} éléments à la Corbeille ? Vous pourrez les y retrouver.`, paths);
      });
      const all = el(
        "button",
        {
          class: "link-btn",
          onclick: () => {
            const every = checked.size < items.length;
            checked.clear();
            if (every) for (const i of items) checked.add(i.path);
            drawDownloads();
          },
        },
        checked.size < items.length ? "Tout cocher" : "Tout décocher",
      );
      extra.replaceChildren(
        el(
          "div",
          { class: "disk-dl" },
          el(
            "div",
            { class: "disk-dl-list" },
            ...items.map((i) => {
              const box = el("input", { type: "checkbox", checked: checked.has(i.path) }) as HTMLInputElement;
              box.addEventListener("change", () => {
                if (box.checked) checked.add(i.path);
                else checked.delete(i.path);
                refreshTotal();
              });
              return el(
                "label",
                { class: "disk-dl-item" },
                box,
                el("span", { class: "disk-name", "data-no-i18n": true }, `${i.dir ? "📁 " : ""}${i.name}`),
                el("span", { class: "muted" }, `${i.days} j`),
                el("span", { class: "disk-size" }, bytesText(i.bytes)),
              );
            }),
          ),
          el("div", { class: "disk-dl-foot" }, all, el("span", { class: "muted" }, "Coché :"), total, send),
        ),
      );
    };
    idle();
    return row;
  };

  const run = async (kind: CleanLine["kind"], paths?: string[]) => {
    if (running) return;
    running = true;
    body.querySelectorAll<HTMLButtonElement>(".disk-clean button").forEach((b) => (b.disabled = true));
    // Ondine fait le ménage : elle travaille, et passe un coup de balai si l'onglet est ouvert.
    api.emit("task.started", { source: "system", kind: "disk-clean" });
    api.emit("mascot.scene", { scene: "sweep" });
    try {
      const r = await api.invoke<{ freed: number; files: number; skipped: number; trashed?: number }>("disk_clean", { kind, paths: paths ?? [] });
      api.emit("task.finished", { source: "system", kind: "disk-clean" });
      const text = cleanResult(kind, r);
      api.notify({ title: text.title, body: text.body || undefined, icon: "🧹", priority: "low", key: "system-disk-clean" });
    } catch (err) {
      api.emit("task.failed", { source: "system", kind: "disk-clean" });
      api.notify({ title: errorText(err), icon: "⚠️", priority: "normal", key: "system-disk-clean" });
    } finally {
      running = false;
      if (alive && part === "clean") void loadClean();
    }
  };

  // ── Démarrage et progression ──
  const off = api.on("system.disk-scan", (msg) => {
    const p = (msg.payload ?? {}) as { job?: number };
    if (p.job === job) void refresh();
  });
  void (async () => {
    try {
      const r = await api.invoke<{ job: number }>("disk_scan", { path: rootPath });
      if (!alive) {
        void api.invoke("disk_cancel", { job: r.job, forget: true }).catch(() => undefined);
        return;
      }
      job = r.job;
      void refresh(true);
    } catch (err) {
      status.textContent = errorText(err);
      stopBtn.hidden = true;
    }
  })();
  if (motionOn()) node.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: 260, easing: "ease-out" });

  return {
    node,
    stop() {
      alive = false;
      off();
      if (job) void api.invoke("disk_cancel", { job, forget: true }).catch(() => undefined);
    },
  };
}
