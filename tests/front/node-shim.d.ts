// Les quelques fonctions de Node utilisées par les tests, décrites à la main.
// (Le paquet @types/node n'est pas installé : on n'ajoute pas de dépendance npm
// juste pour ça.) Si un test a besoin d'autre chose, l'ajouter ici.

declare module "node:test" {
  type Fn = () => void | Promise<void>;
  export function describe(name: string, fn: Fn): void;
  export function test(name: string, fn: Fn): void;
  export function beforeEach(fn: Fn): void;
  export function afterEach(fn: Fn): void;
  export const mock: {
    timers: {
      enable(options?: { apis?: string[]; now?: number }): void;
      tick(ms: number): void;
      reset(): void;
    };
  };
}

declare module "node:assert/strict" {
  interface Assert {
    (value: unknown, message?: string): asserts value;
    ok(value: unknown, message?: string): asserts value;
    equal(actual: unknown, expected: unknown, message?: string): void;
    notEqual(actual: unknown, expected: unknown, message?: string): void;
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
    match(value: string, rx: RegExp, message?: string): void;
    throws(fn: () => unknown, expected?: RegExp | (new (...args: never[]) => Error), message?: string): void;
    fail(message?: string): never;
  }
  const assert: Assert;
  export default assert;
}

declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function readdirSync(path: string, options: { withFileTypes: true }): { name: string; isDirectory(): boolean }[];
}

declare module "node:path" {
  export function join(...parts: string[]): string;
}
