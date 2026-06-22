// Recursively dispose a node that is *uniquely owned* (not sharing geometry
// or materials with anything else). Use ONLY for one-off meshes — never on
// objects that reference the shared Assets library, or you'll free buffers
// other chunks still use.
export function disposeNode(obj) {
  obj.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    const mat = child.material;
    if (Array.isArray(mat)) mat.forEach(disposeMaterial);
    else if (mat) disposeMaterial(mat);
  });
}

function disposeMaterial(mat) {
  for (const key of Object.keys(mat)) {
    const value = mat[key];
    if (value && value.isTexture) value.dispose();
  }
  mat.dispose();
}
