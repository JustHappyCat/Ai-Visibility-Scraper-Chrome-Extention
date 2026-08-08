import { readFile } from "node:fs/promises";
import vm from "node:vm";

export async function runContentScript(context, file) {
  vm.runInContext(await readFile(file, "utf8"), context, { filename: file });
  return context;
}

export async function loadContentScript(file, overrides = {}) {
  const listeners = [];
  const storageWrites = [];
  const context = {
    URL,
    Date,
    Math,
    Promise,
    Error,
    Object,
    Set,
    console,
    setTimeout,
    clearTimeout,
    location: { href: "https://example.test/page" },
    document: {
      querySelectorAll: () => [],
    },
    chrome: {
      runtime: {
        onMessage: {
          addListener(listener) {
            listeners.push(listener);
          },
        },
      },
      storage: {
        local: {
          set(value) {
            storageWrites.push(value);
            return Promise.resolve();
          },
        },
      },
    },
    ...overrides,
  };

  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  await runContentScript(context, file);

  return { context, listeners, storageWrites };
}
