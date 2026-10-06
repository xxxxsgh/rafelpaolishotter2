// Bakes the terrain heightfield into a float grid for the water shaders (depth -> colour,
// foam, transparency). Runs off the main thread; posts a Float32Array of R*R heights.
import { getHeight, WORLD_SIZE } from '../../world/heightfield.js';

self.onmessage = (e) => {
  const { R } = e.data;
  const out = new Float32Array(R * R);
  const cell = WORLD_SIZE / R, half = WORLD_SIZE / 2;
  for (let j = 0; j < R; j++) {
    const z = (j + 0.5) * cell - half;
    for (let i = 0; i < R; i++) out[j * R + i] = getHeight((i + 0.5) * cell - half, z);
  }
  self.postMessage({ R, data: out }, [out.buffer]);
};
