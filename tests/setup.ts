// The plugin calls window.setTimeout and friends, as Obsidian asks plugins to.
// Node has the same timers on globalThis.
(globalThis as { window?: unknown }).window = globalThis;
