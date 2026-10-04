// Journal côté front : écrit dans le même fichier que le Rust
// (%LOCALAPPDATA%\Island\logs\island.log), avec la source "ui:<qui>".
// Jamais de contenu sensible (texte copié, contenu de fichier, clé…).

import { Bridge } from "./bridge";

type Level = "error" | "warn" | "info" | "debug";

function write(level: Level, source: string, message: string) {
  const line = `[${source}] ${message}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
  void Bridge.log(level, source, message);
}

export interface Logger {
  error(message: string): void;
  warn(message: string): void;
  info(message: string): void;
  debug(message: string): void;
}

export function logger(source: string): Logger {
  return {
    error: (m) => write("error", source, m),
    warn: (m) => write("warn", source, m),
    info: (m) => write("info", source, m),
    debug: (m) => write("debug", source, m),
  };
}

/** Message lisible d'une erreur quelconque. */
export function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
