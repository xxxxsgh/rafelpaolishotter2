// Terrain chunk build worker (module worker). Receives {id, x0, z0, size, N}.
import { buildChunk } from './chunkBuilder.js';

self.onmessage = (e) => {
  const { id, x0, z0, size, N } = e.data;
  try {
    const r = buildChunk(x0, z0, size, N);
    self.postMessage({ id, ...r }, [r.pos.buffer, r.nor.buffer, r.morph.buffer, r.surf.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.stack || err) });
  }
};
self.postMessage({ ready: true });
