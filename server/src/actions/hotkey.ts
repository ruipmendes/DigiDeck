import { keyboard, Key } from '@nut-tree-fork/nut-js';

export async function execHotkey(keyNames: string[]): Promise<void> {
  if (keyNames.length === 0) throw new Error('hotkey: empty key list');
  const keys = keyNames.map(resolveKey);
  await keyboard.pressKey(...keys);
  await keyboard.releaseKey(...keys);
}

function resolveKey(name: string): Key {
  const k = (Key as Record<string, unknown>)[name];
  if (typeof k !== 'number') {
    throw new Error(
      `hotkey: unknown key "${name}". Use names from nut-js Key enum (e.g. LeftControl, LeftShift, A, F1, AudioVolUp).`,
    );
  }
  return k as Key;
}
