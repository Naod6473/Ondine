// Module « Réseau » : ping en continu, test de port, DNS.
//
// Le Rust (src-tauri/src/modules/nettools.rs) envoie les paquets de test ;
// ici on affiche. Le ping est répété chaque seconde tant que l'onglet est
// ouvert et qu'on ne l'a pas arrêté : un graphique en barres montre les
// derniers temps de réponse, avec la perte et le min / moyenne / max.

import manifest from "./manifest.json";
import { errorText } from "../../core/log";
import type { IslandModule, ModuleApi, ModuleManifest } from "../../core/module-types";
import { el } from "../../island/dom";
import { setLabel } from "../../island/icon";
import { aiCard, wireAi } from "./ai";

interface PingReply {
  ip: string;
  ms: number | null;
  ttl?: number;
}

/** Les ports qu'on teste le plus souvent en informatique. */
const PORTS: [number, string][] = [
  [443, "HTTPS"],
  [80, "HTTP"],
  [3389, "RDP"],
  [22, "SSH"],
  [445, "Partage"],
  [53, "DNS"],
];
const PING_EVERY_MS = 1000;
const BARS = 40;

export const nettools: IslandModule = {
  manifest: manifest as ModuleManifest,

  // Les alertes de la surveillance en fond (Rust) : Internet, VPN, serveurs, IP publique.
  setup(api) {
    const offs = [
      api.on("nettools.internet", (msg) => {
        const up = !!(msg.payload as { up?: boolean } | null)?.up;
        api.notify(
          up
            ? { title: "Internet est revenu", icon: "🌐", priority: "low", key: "net-internet" }
            : { title: "Plus d'accès à Internet", body: "Le réseau local répond peut-être encore.", icon: "📵", priority: "normal", key: "net-internet" },
        );
      }),
      api.on("nettools.vpn", (msg) => {
        const p = (msg.payload ?? {}) as { name?: string; up?: boolean };
        api.notify(
          p.up
            ? { title: `VPN branché : ${p.name ?? ""}`, icon: "🔐", priority: "low", key: `net-vpn-${p.name}` }
            : { title: `VPN coupé : ${p.name ?? ""}`, body: "Les ressources internes ne sont plus joignables.", icon: "🔓", priority: "normal", key: `net-vpn-${p.name}` },
        );
      }),
      api.on("nettools.host", (msg) => {
        const p = (msg.payload ?? {}) as { host?: string; up?: boolean };
        api.notify(
          p.up
            ? { title: `${p.host} répond de nouveau`, icon: "✅", priority: "low", key: `net-host-${p.host}` }
            : { title: `${p.host} ne répond plus`, body: "Pas de réponse depuis deux minutes.", icon: "🖥️", priority: "normal", key: `net-host-${p.host}` },
        );
      }),
      api.on("nettools.public-ip", (msg) => {
        const p = (msg.payload ?? {}) as { ip?: string; previous?: string };
        api.notify({ title: "Votre adresse IP publique a changé", body: `${p.previous ?? "?"} → ${p.ip ?? "?"}`, icon: "🌍", priority: "low", key: "net-public-ip" });
      }),
      // Services IA (ai.ts) : un service tombe ou revient, et la note pendant un incident.
      wireAi(api),
    ];
    return () => offs.forEach((off) => off());
  },

  views: {
    expanded(root, api: ModuleApi) {
      const host = el("input", {
        class: "clip-input net-host",
        type: "text",
        placeholder: "Nom ou adresse (google.fr, 192.168.1.1…)",
        spellcheck: "false",
        autocomplete: "off",
        maxlength: 253,
      }) as HTMLInputElement;
      const port = el("input", { class: "clip-input net-port", type: "text", inputmode: "numeric", placeholder: "Port", maxlength: 5 }) as HTMLInputElement;
      const pingBtn = el("button", { class: "btn small", title: "Ping chaque seconde (Entrée)" }, "📶 Ping");
      const portBtn = el("button", { class: "btn small", title: "Le port répond-il ?" }, "🔌 Port");
      const dnsBtn = el("button", { class: "btn small", title: "Nom → adresses, ou adresse IPv4 → nom" }, "🔎 DNS");
      const chips = el(
        "div",
        { class: "net-chips" },
        ...PORTS.map(([p, label]) =>
          el("button", { class: "net-chip", title: `Tester le port ${p}`, onclick: api.handler(() => ((port.value = String(p)), testPort())) }, `${label} ${p}`),
        ),
      );
      const out = el("div", { class: "net-out" });
      // L'état surveillé en fond : Internet, VPN, IP publique (si activée).
      const status = el("div", { class: "net-status muted" });
      // Services IA (réglage aiStatus) : une pastille par service, et les pannes de la semaine.
      const ai = aiCard(api);
      root.append(el("div", { class: "net" }, el("div", { class: "net-head" }, host, port, pingBtn, portBtn, dnsBtn), chips, status, ai.node, out));
      api
        .invoke<{ internet: boolean | null; vpns: string[]; publicIp: string | null }>("status")
        .then((st) => {
          const parts = [st.internet == null ? "" : st.internet ? "🌐 Internet OK" : "📵 Pas d'Internet"];
          if (st.vpns.length) parts.push(`🔐 VPN : ${st.vpns.join(", ")}`);
          if (st.publicIp) parts.push(`🌍 IP publique : ${st.publicIp}`);
          // Un morceau par élément : chacun garde son pictogramme et sa traduction.
          status.replaceChildren(...parts.filter(Boolean).flatMap((x, i) => [i ? "  ·  " : "", el("span", {}, x)]));
        })
        .catch(() => {});

      const target = () => host.value.trim();
      const problem = (err: unknown) => out.replaceChildren(el("p", { class: "net-bad" }, `⚠️ ${errorText(err)}`));
      const needHost = () => {
        if (target()) return true;
        host.focus();
        return false;
      };

      // ── Ping en continu ────────────────────────────────────────────────────
      let pingTimer = 0;
      let busy = false;
      const stopPing = () => {
        window.clearInterval(pingTimer);
        pingTimer = 0;
        setLabel(pingBtn, "📶 Ping");
        pingBtn.classList.remove("primary");
      };
      const startPing = () => {
        if (pingTimer) return stopPing();
        if (!needHost()) return;
        const name = target();
        const times: (number | null)[] = [];
        const big = el("b", { class: "net-big" }, "…");
        const info = el("span", { class: "muted" }, `Ping ${name}`);
        const stats = el("small", { class: "muted" });
        const graph = el("div", { class: "net-graph" });
        out.replaceChildren(el("div", { class: "net-ping" }, el("div", { class: "net-ping-top" }, big, info), graph, stats));
        setLabel(pingBtn, "⏹ Arrêter");
        pingBtn.classList.add("primary");

        const once = async () => {
          if (busy) return; // la réponse d'avant n'est pas encore là
          busy = true;
          try {
            const r = await api.invoke<PingReply>("ping", { host: name });
            times.push(r.ms);
            info.textContent = `${name}${r.ip !== name ? ` (${r.ip})` : ""}${r.ttl ? ` · TTL ${r.ttl}` : ""}`;
            big.textContent = r.ms === null ? "pas de réponse" : `${r.ms} ms`;
            big.classList.toggle("net-bad", r.ms === null);
            draw(times, graph, stats);
          } catch (err) {
            stopPing();
            problem(err);
          } finally {
            busy = false;
          }
        };
        void once();
        pingTimer = window.setInterval(() => void once(), PING_EVERY_MS);
      };

      // ── Port ───────────────────────────────────────────────────────────────
      const testPort = async () => {
        stopPing();
        if (!needHost()) return;
        if (!port.value.trim()) return port.focus();
        out.replaceChildren(el("p", { class: "muted" }, `Test du port ${port.value} sur ${target()}…`));
        try {
          const r = await api.invoke<{ ip: string; state: "open" | "closed" | "silent"; ms?: number }>("port", { host: target(), port: port.value });
          const text = {
            open: `✅ Port ${port.value} ouvert sur ${r.ip} (${r.ms} ms)`,
            closed: `⛔ Port ${port.value} fermé : ${r.ip} répond, mais rien n'écoute sur ce port`,
            silent: `⏳ Pas de réponse de ${r.ip} sur le port ${port.value} : serveur éteint, ou un pare-feu bloque`,
          }[r.state];
          out.replaceChildren(el("p", { class: `net-result ${r.state}` }, text));
        } catch (err) {
          problem(err);
        }
      };

      // ── DNS ────────────────────────────────────────────────────────────────
      const lookup = async () => {
        stopPing();
        if (!needHost()) return;
        out.replaceChildren(el("p", { class: "muted" }, `Recherche de ${target()}…`));
        try {
          const r = await api.invoke<{ reverse: boolean; names?: string[]; addrs?: string[]; ms: number }>("dns", { host: target() });
          const lines = (r.reverse ? r.names : r.addrs) ?? [];
          out.replaceChildren(
            el("small", { class: "muted" }, r.reverse ? `Nom de ${target()} (${r.ms} ms)` : `Adresses de ${target()} (${r.ms} ms)`),
            lines.length
              ? el("ul", { class: "net-list" }, ...lines.map((l) => el("li", {}, l)))
              : el("p", { class: "net-bad" }, "Aucun nom enregistré pour cette adresse."),
          );
        } catch (err) {
          problem(err);
        }
      };

      pingBtn.addEventListener("click", api.handler(startPing));
      portBtn.addEventListener("click", api.handler(testPort));
      dnsBtn.addEventListener("click", api.handler(lookup));
      host.addEventListener(
        "keydown",
        api.handler((e: KeyboardEvent) => {
          if (e.key === "Enter") startPing();
        }),
      );
      port.addEventListener(
        "keydown",
        api.handler((e: KeyboardEvent) => {
          if (e.key === "Enter") return testPort();
        }),
      );
      out.append(el("p", { class: "muted" }, "Tapez une adresse, puis Ping, Port ou DNS."));
      return () => {
        stopPing();
        ai.stop();
      };
    },
  },
};

/** Les barres (hauteur = temps de réponse, rouge = perdu) et les chiffres. */
function draw(times: (number | null)[], graph: HTMLElement, stats: HTMLElement) {
  const last = times.slice(-BARS);
  const ok = times.filter((t): t is number => t !== null);
  const top = Math.max(20, ...last.filter((t): t is number => t !== null));
  // On garde les barres existantes (la nouvelle « pousse », les autres glissent).
  while (graph.children.length < last.length) graph.append(el("i", {}));
  while (graph.children.length > last.length) graph.firstElementChild?.remove();
  last.forEach((t, i) => {
    const bar = graph.children[i] as HTMLElement;
    bar.classList.toggle("lost", t === null);
    bar.style.height = t === null ? "100%" : `${Math.max(6, (t / top) * 100)}%`;
    bar.title = t === null ? "perdu" : `${t} ms`;
  });
  const lost = times.length - ok.length;
  const avg = ok.length ? Math.round(ok.reduce((a, b) => a + b, 0) / ok.length) : 0;
  stats.textContent =
    `${times.length} envoyés · ${Math.round((lost / times.length) * 100)} % perdus` +
    (ok.length ? ` · min ${Math.min(...ok)} / moy ${avg} / max ${Math.max(...ok)} ms` : "");
}
