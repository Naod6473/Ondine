// Les outils IA que l'onglet Agents IA sait lancer et brancher, sans DOM ni
// Tauri (testé dans tests/front/agents.test.ts). Le pendant Rust est
// src-tauri/src/modules/agents_tools.rs : même liste, mêmes identifiants.
//
//   - lancement + reprise + hooks installés automatiquement : Claude Code,
//     Codex, Gemini CLI, GitHub Copilot CLI, Cursor CLI, Qwen Code, Goose ;
//   - lancement (+ reprise quand l'outil la propose) seulement : OpenCode,
//     Kiro CLI, Hermes, Aider, Amp ;
//   - « Autre outil » : le mot de commande du réglage `otherTool`.

/** Un outil qu'on sait lancer (identifiant = réglage « Proposer … » côté Rust). */
export interface LaunchInfo {
  /** Le nom affiché sur le bouton. */
  name: string;
  /** Le prénom des notifications (« Copilot a fini »). */
  who: string;
  /** La source des hooks (« claude-code »), si l'outil en a. */
  source?: string;
  /** La reprise de la dernière session est proposée (« ↻ Reprendre »). */
  resume: boolean;
  /** Le titre du bouton « Reprendre ». */
  resumeTitle?: string;
}

export const LAUNCH: Record<string, LaunchInfo> = {
  claude: { name: "Claude Code", who: "Claude", source: "claude-code", resume: true, resumeTitle: "Continuer la dernière conversation (claude --continue)" },
  codex: { name: "Codex", who: "Codex", source: "codex", resume: true, resumeTitle: "Reprendre la dernière session (codex resume --last)" },
  gemini: { name: "Gemini CLI", who: "Gemini", source: "gemini", resume: false },
  copilot: { name: "GitHub Copilot CLI", who: "Copilot", source: "copilot", resume: true, resumeTitle: "Reprendre la dernière session (copilot --continue)" },
  cursor: { name: "Cursor CLI", who: "Cursor", source: "cursor", resume: true, resumeTitle: "Reprendre la dernière session (agent --continue)" },
  qwen: { name: "Qwen Code", who: "Qwen", source: "qwen", resume: true, resumeTitle: "Reprendre la dernière session (qwen --continue)" },
  goose: { name: "Goose", who: "Goose", source: "goose", resume: true, resumeTitle: "Reprendre la dernière session (goose session --resume)" },
  opencode: { name: "OpenCode", who: "OpenCode", resume: true, resumeTitle: "Reprendre la dernière session (opencode --continue)" },
  kiro: { name: "Kiro CLI", who: "Kiro", resume: true, resumeTitle: "Reprendre la dernière session (kiro-cli chat --resume)" },
  hermes: { name: "Hermes", who: "Hermes", resume: true, resumeTitle: "Reprendre la dernière session (hermes --continue)" },
  aider: { name: "Aider", who: "Aider", resume: false },
  amp: { name: "Amp", who: "Amp", resume: false },
  other: { name: "Autre outil", who: "L'outil", source: "other", resume: false },
};

/** Le nom affiché d'un outil à lancer (« other » : le mot du réglage). */
export function launchName(tool: string, otherWord = ""): string {
  if (tool === "other") return otherWord.trim() || LAUNCH.other.name;
  return LAUNCH[tool]?.name ?? tool;
}

/** Le prénom affiché d'une source de hooks (« claude-code » → « Claude »). */
export function sourceName(source: string): string {
  for (const info of Object.values(LAUNCH)) if (info.source === source) return info.who;
  return source;
}

/** Un outil dont les hooks s'installent depuis l'onglet (guide « Brancher »). */
export interface HookGuide {
  name: string;
  /** Le fichier de configuration, forme %USERPROFILE% (le Rust donne le vrai chemin). */
  file: string;
  /** La marche à suivre « à la main ». */
  steps: string;
  /** Ce qu'il faut faire après l'installation automatique. */
  restart: string;
  /** L'outil accepte aussi l'île comme serveur MCP et le hook d'autorisation (les trois premiers). */
  mcp: boolean;
}

export const HOOK_TOOLS: Record<string, HookGuide> = {
  "claude-code": {
    name: "Claude Code",
    file: "%USERPROFILE%\\.claude\\settings.json",
    steps: "Collez le bloc « hooks » (fusionnez-le s'il en existe déjà un), puis relancez Claude Code.",
    restart: "Relancez Claude Code pour les activer.",
    mcp: true,
  },
  codex: {
    name: "Codex",
    file: "%USERPROFILE%\\.codex\\config.toml",
    steps: "Collez les lignes à la fin du fichier, relancez Codex, puis tapez /hooks pour les approuver (Codex le demande une fois).",
    restart: "Relancez Codex, puis tapez /hooks pour les approuver (Codex le demande une fois).",
    mcp: true,
  },
  gemini: {
    name: "Gemini CLI",
    file: "%USERPROFILE%\\.gemini\\settings.json",
    steps: "Collez le bloc « hooks » (version 0.26 ou plus récente), puis relancez Gemini CLI.",
    restart: "Relancez Gemini CLI pour les activer.",
    mcp: true,
  },
  copilot: {
    name: "GitHub Copilot CLI",
    file: "%USERPROFILE%\\.copilot\\hooks\\ondine.json",
    steps: "Enregistrez le bloc tel quel dans ce fichier (Copilot CLI lit tous les .json de son dossier hooks), puis relancez Copilot CLI.",
    restart: "Relancez Copilot CLI pour les activer.",
    mcp: false,
  },
  cursor: {
    name: "Cursor CLI",
    file: "%USERPROFILE%\\.cursor\\hooks.json",
    steps: "Collez le bloc « hooks » (fusionnez-le s'il en existe déjà un), puis relancez l'agent Cursor.",
    restart: "Relancez l'agent Cursor (commande « agent ») pour les activer.",
    mcp: false,
  },
  qwen: {
    name: "Qwen Code",
    file: "%USERPROFILE%\\.qwen\\settings.json",
    steps: "Collez le bloc « hooks » (fusionnez-le s'il en existe déjà un), puis relancez Qwen Code.",
    restart: "Relancez Qwen Code pour les activer.",
    mcp: false,
  },
  goose: {
    name: "Goose",
    file: "%USERPROFILE%\\.agents\\plugins\\ondine\\hooks\\hooks.json",
    steps: "Enregistrez le bloc dans ce fichier, avec un plugin.json à côté du dossier hooks (« Installer automatiquement » l'écrit pour vous), puis relancez Goose.",
    restart: "Relancez Goose pour les activer.",
    mcp: false,
  },
};

/** Un fichier changé du dépôt (commande « report_files »). */
export interface FileChange {
  path: string;
  added: number;
  removed: number;
  untracked: boolean;
  exists: boolean;
}

/** « +12 −3 », « nouveau, +40 », « supprimé ». */
export function fileCounts(f: FileChange): string {
  if (!f.exists) return "supprimé";
  if (f.untracked) return `nouveau, +${f.added}`;
  return `+${f.added} −${f.removed}`;
}

/** La dernière phrase d'un agent, sur une ligne, 200 caractères au plus. */
export function summaryLine(text: string, max = 200): string {
  const one = text.replace(/\s+/g, " ").trim();
  const chars = [...one];
  return chars.length <= max ? one : `${chars.slice(0, max - 1).join("").trimEnd()}…`;
}
