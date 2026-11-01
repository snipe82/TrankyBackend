import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function isMainModule(metaUrl) {
  if (!process.argv[1]) return false;
  const normalize = (p) => path.resolve(p).toLowerCase();
  return normalize(fileURLToPath(metaUrl)) === normalize(process.argv[1]);
}
