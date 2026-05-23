import { keyboard, Key } from '@nut-tree-fork/nut-js';

export async function execVolume(params: { delta?: number; mute?: boolean }): Promise<void> {
  if (params.mute) {
    await keyboard.pressKey(Key.AudioMute);
    await keyboard.releaseKey(Key.AudioMute);
    return;
  }
  const delta = params.delta ?? 0;
  if (delta === 0) return;
  const key = delta > 0 ? Key.AudioVolUp : Key.AudioVolDown;
  for (let i = 0; i < Math.abs(delta); i++) {
    await keyboard.pressKey(key);
    await keyboard.releaseKey(key);
  }
}
