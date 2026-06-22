# /src/assets

This folder is intentionally (almost) empty.

**The game runs with zero external model or texture files.** Every building,
tree, lantern, prop, the player character, and even the signage text are
generated procedurally from primitives at runtime (see
[`../world/Assets.js`](../world/Assets.js) and
[`../world/Interiors.js`](../world/Interiors.js)).

## Want to use real art instead?

Drop `.glb` / `.gltf` (optionally DRACO-compressed) and `.ktx2` textures in
here, then load them through the pre-configured loaders in
[`Loaders.js`](./Loaders.js):

```js
import { tryLoadGLB } from './assets/Loaders.js';

const gltf = await tryLoadGLB(new URL('./assets/hero.glb', import.meta.url), renderer);
if (gltf) {
  // use gltf.scene / gltf.animations
} else {
  // tryLoadGLB returns null on a missing/failed asset — fall back to procedural
}
```

`Loaders.js` wires up `GLTFLoader` + `DRACOLoader` + `KTX2Loader` and resolves
to `null` on failure so callers always have a procedural fallback path.
