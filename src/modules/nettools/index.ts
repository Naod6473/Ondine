import manifest from './manifest.json';
import type { IslandModule, ModuleManifest } from '../../core/module-types';
import { lazyView } from '../../core/lazy-view';
import { wireAi } from './ai';
import { onSpeed } from './speed-state';
import type { SpeedNews } from './speed-logic';
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
      // Test de débit (Rust nettools_speed.rs) : chaque nouvelle.
      api.on("nettools.speed", (msg) => onSpeed((msg.payload ?? { phase: "error" }) as SpeedNews)),
    ];
    return () => offs.forEach((off) => off());
  },

  views: {
    expanded: lazyView(() => import('./view').then(m => m.nettools.views!.expanded!)),
  },
};
