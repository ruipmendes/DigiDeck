import { keyboard } from '@nut-tree-fork/nut-js';

export async function execText(text: string): Promise<void> {
  await keyboard.type(text);
}
