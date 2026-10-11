import type { ViewMount } from "./module-types";

/** Le cache garde le code chargé ; le démontage empêche un import tardif de
 * monter une vue quittée entre-temps. Ses abonnements ne vivent que visibles. */
export function lazyView(load: () => Promise<ViewMount>): ViewMount {
  let ready: ViewMount | null = null;
  let loading: Promise<ViewMount> | null = null;
  return (root, api) => {
    if (ready) return ready(root, api);
    let alive = true;
    let dispose: void | (() => void);
    root.setAttribute("aria-busy", "true");
    const status = document.createElement("p");
    status.className = "muted";
    status.setAttribute("role", "status");
    status.textContent = "Chargement…";
    root.append(status);
    loading ??= load().then(view => { ready = view; return view; }).catch(error => { loading = null; throw error; });
    void loading.then(view => {
      if (!alive) return;
      status.remove();
      root.removeAttribute("aria-busy");
      dispose = view(root, api);
    }).catch(error => {
      if (!alive) return;
      root.removeAttribute("aria-busy");
      status.textContent = "Cette vue a rencontré une erreur.";
      root.replaceChildren(status);
      api.log.error(String(error));
    });
    return () => { alive = false; dispose?.(); root.removeAttribute("aria-busy"); };
  };
}
