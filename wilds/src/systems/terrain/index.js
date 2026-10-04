// terrain system — placeholder single mesh. See src/main.js for the contract.
export async function init(ctx) {
  const { THREE, scene, world } = ctx;
  const size = 3000, seg = 300;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, world.getHeight(p.getX(i), p.getZ(i)));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x6f9a4a, roughness: 1 }));
  mesh.receiveShadow = true;
  scene.add(mesh);
  return {};
}
