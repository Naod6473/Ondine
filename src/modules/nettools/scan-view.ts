// Réseau : « Scanner mon réseau ». Le Rust (commande « scan »,
// src-tauri/src/modules/nettools.rs) fait un ping vers chaque adresse du
// réseau local, lit la table ARP de Windows et cherche les noms ; ici, la
// liste des appareils, avec pour chacun « Identifier » (commande « probe » :
// quelques ports courants pour deviner ce que c'est), « Ping » (remplit le
// champ du haut) et, si l'appareil a une page web, « Ouvrir la page ».

import { errorText } from "../../core/log";
import type { ModuleApi } from "../../core/module-types";
import { el } from "../../island/dom";
import { deviceDetails, deviceTitle, KINDS, sortDevices, webPort, type ScanDevice, type ScanResult } from "./scan-logic";

/**
 * Lance le scan et montre la liste dans `out`. `ping(ip)` : remplit le champ
 * du haut et lance le ping.
 */
export async function runScan(api: ModuleApi, out: HTMLElement, ping: (ip: string) => void): Promise<void> {
  out.replaceChildren(el("p", { class: "muted" }, "Scan du réseau local… (quelques secondes)"));
  let r: ScanResult;
  try {
    r = await api.invoke<ScanResult>("scan");
  } catch (err) {
    out.replaceChildren(el("p", { class: "net-bad" }, `⚠️ ${errorText(err)}`));
    return;
  }
  const head = el(
    "small",
    { class: "muted" },
    `${r.network} · ${r.adapter} · ${r.devices.length} appareil${r.devices.length > 1 ? "s" : ""} · ${(r.elapsedMs / 1000).toFixed(1).replace(".", ",")} s`,
  );
  const me = el(
    "li",
    { class: "net-device me" },
    el("span", { class: "net-device-icon" }, "💻"),
    el("span", { class: "net-device-text" }, el("b", {}, "Ce PC"), el("small", { class: "muted" }, [r.me.ip, r.me.name].filter(Boolean).join(" · "))),
  );
  const rows = sortDevices(r.devices).map((d) => deviceRow(api, d, ping));
  out.replaceChildren(
    head,
    el("ul", { class: "net-devices" }, me, ...rows),
    el("p", { class: "muted" }, "Seuls les appareils de votre réseau local sont contactés. « Identifier » essaie quelques ports courants de l'appareil."),
  );
}

function deviceRow(api: ModuleApi, d: ScanDevice, ping: (ip: string) => void): HTMLElement {
  const [icon, kindName] = KINDS[d.kind] ?? KINDS.unknown;
  const iconBox = el("span", { class: "net-device-icon", title: kindName }, icon);
  const kindLine = el("small", { class: "muted net-device-kind" }, d.kind === "unknown" ? "" : kindName);
  const actions = el("span", { class: "net-device-actions" });
  const identify = el(
    "button",
    {
      class: "btn small",
      title: "Essayer quelques ports courants pour deviner ce que c'est",
      onclick: api.handler(async () => {
        identify.setAttribute("disabled", "");
        identify.textContent = "…";
        try {
          const p = await api.invoke<{ open: number[]; kind: string }>("probe", { ip: d.ip });
          const [ic, name] = KINDS[p.kind] ?? KINDS.unknown;
          iconBox.textContent = ic;
          iconBox.title = name;
          kindLine.replaceChildren(el("span", {}, name), " · ", el("span", {}, p.open.length ? `ports ${p.open.join(", ")}` : "aucun port courant ouvert"));
          identify.remove();
          const port = webPort(p.open);
          if (port != null) {
            actions.prepend(
              el(
                "button",
                { class: "btn small", title: "Ouvrir la page de l'appareil dans le navigateur", onclick: api.handler(() => openWeb(api, d.ip, port)) },
                "Ouvrir la page",
              ),
            );
          }
        } catch (err) {
          identify.removeAttribute("disabled");
          identify.textContent = "Identifier";
          kindLine.textContent = errorText(err);
        }
      }),
    },
    "Identifier",
  );
  actions.append(identify, el("button", { class: "btn small", title: "Ping cet appareil", onclick: api.handler(() => ping(d.ip)) }, "Ping"));
  const badges = [d.gateway ? el("span", { class: "net-badge" }, "Box") : null, d.new ? el("span", { class: "net-badge new" }, "Nouveau") : null];
  return el(
    "li",
    { class: `net-device${d.new ? " new" : ""}` },
    iconBox,
    el(
      "span",
      { class: "net-device-text" },
      // Le nom vient du réseau (DNS) ou de la table des fabricants : jamais traduit.
      el("b", {}, el("span", { "data-no-i18n": d.name || d.vendor ? true : undefined }, deviceTitle(d)), ...badges),
      // L'adresse IP et l'adresse MAC ne se traduisent pas ; « adresse MAC privée », si.
      el("small", { class: "muted" }, ...deviceDetails(d).flatMap((x, i) => [i ? " · " : "", x === "adresse MAC privée" ? el("span", {}, x) : el("span", { "data-no-i18n": true }, x)])),
      kindLine,
    ),
    actions,
  );
}

async function openWeb(api: ModuleApi, ip: string, port: number) {
  try {
    await api.invoke("open_web", { ip, port });
  } catch (err) {
    api.notify({ title: "Page non ouverte", body: errorText(err), icon: "⚠️", priority: "low", key: "net-open" });
  }
}
