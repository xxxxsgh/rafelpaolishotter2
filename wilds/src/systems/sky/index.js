// sky system — placeholder baseline lighting. See src/main.js for the contract.
export async function init(ctx) {
  const { THREE, scene, uniforms } = ctx;
  scene.background = new THREE.Color(0x8fb8e8);
  scene.fog = new THREE.FogExp2(0xa8c4dc, 0.0006);
  const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x5a5236, 0.9);
  const sun = new THREE.DirectionalLight(0xfff1d8, 2.2);
  scene.add(hemi, sun, sun.target);
  let hour = 10;
  const api = {
    setTime(h) { hour = h; const a = (h - 6) / 12 * Math.PI; uniforms.uSunDir.value.set(Math.cos(a), Math.sin(a), 0.3).normalize(); },
    setWeather() {},
    getTime: () => hour,
    update() { sun.position.copy(ctx.focus).addScaledVector(uniforms.uSunDir.value, 300); sun.target.position.copy(ctx.focus); },
  };
  api.setTime(hour);
  return api;
}
