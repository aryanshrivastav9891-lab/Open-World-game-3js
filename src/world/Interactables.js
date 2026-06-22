// Finds the nearest in-range trigger to the player so the HUD can prompt
// and the Game can act on it. Triggers come from the ChunkManager (door /
// sign zones) outdoors, or from the active interior (exit zones).
export class Interactables {
  constructor() {
    this.active = null;
  }

  // triggers: array of { kind, x, z, r, label, ... }
  update(playerPos, triggers) {
    let best = null;
    let bestD = Infinity;
    for (const t of triggers) {
      const dx = playerPos.x - t.x;
      const dz = playerPos.z - t.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < t.r * t.r && d2 < bestD) {
        bestD = d2;
        best = t;
      }
    }
    this.active = best;
    return best;
  }

  clear() {
    this.active = null;
  }
}
