import manifest from "./manifest.json";
import type { IslandModule, ModuleManifest } from "../../core/module-types";
import { lazyView } from "../../core/lazy-view";

export const home: IslandModule = {
  manifest: manifest as ModuleManifest,
  views: {
    expanded: lazyView(() => import("./view").then(m => m.home.views!.expanded!)),
  },
};
