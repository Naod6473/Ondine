import manifest from './manifest.json';
import type { IslandModule, ModuleManifest } from '../../core/module-types';
import { lazyView } from '../../core/lazy-view';

export const terminal: IslandModule = {
  manifest: manifest as ModuleManifest,
  views: {
    expanded: lazyView(() => import('./view').then(m => m.terminal.views!.expanded!)),
    drop: (api) => api.settings().showDrop ? [{ id: 'terminal-here', label: 'Terminal ici', icon: '🖥️', onDrop: async (paths) => { await api.invoke('open', { path: paths[0] }); api.closeIsland(); } }] : [],
  },
};
