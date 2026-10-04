// Rain streaks + snowflakes in a wrapped volume around the camera.
// All motion happens in the vertex shader (time + camera wrap) -> zero CPU cost.
import * as THREE from 'three';

function makeField({ count, box, rain }) {
  const base = new THREE.PlaneGeometry(1, 1);
  base.translate(0, -0.5, 0);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.getAttribute('position'));
  geo.setAttribute('uv', base.getAttribute('uv'));
  const seed = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    seed[i * 4] = Math.random(); seed[i * 4 + 1] = Math.random(); seed[i * 4 + 2] = Math.random(); seed[i * 4 + 3] = Math.random();
  }
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
  geo.instanceCount = count;
  const uniforms = {
    uTime: { value: 0 },
    uAmount: { value: 0 },
    uBox: { value: new THREE.Vector3(...box) },
    uWind: { value: new THREE.Vector3() },
    uColor: { value: new THREE.Color(1, 1, 1) },
    uFlash: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      attribute vec4 aSeed;
      uniform float uTime, uAmount;
      uniform vec3 uBox, uWind;
      varying vec2 vUv;
      varying float vA;
      void main() {
        vUv = uv;
        float on = step(aSeed.w, uAmount * ${rain ? '0.55' : '1.0'});
        ${rain ? `
        float speed = 17.0 + aSeed.x * 6.0;
        vec3 vel = vec3(uWind.x, -speed, uWind.z);
        ` : `
        float speed = 1.1 + aSeed.x * 0.7;
        vec3 vel = vec3(uWind.x * 0.6, -speed, uWind.z * 0.6);
        `}
        vec3 p = aSeed.xyz * uBox + vel * uTime;
        ${rain ? '' : 'p.x += sin(uTime * (0.8 + aSeed.y) + aSeed.z * 30.0) * 0.6; p.z += cos(uTime * (0.7 + aSeed.x) + aSeed.y * 20.0) * 0.6;'}
        // wrap around the camera
        vec3 rel = mod(p - cameraPosition + uBox * 0.5, uBox) - uBox * 0.5;
        vec3 center = cameraPosition + rel;
        vec3 toCam = normalize(cameraPosition - center);
        ${rain ? `
        vec3 axis = normalize(vel);
        vec3 side = normalize(cross(axis, toCam));
        float len = 0.8 + aSeed.y * 0.7;
        vec3 wp = center + side * (position.x * 0.02) + axis * (-position.y * len);
        ` : `
        vec3 side = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
        vec3 up = cross(toCam, side);
        float s = 0.05 + aSeed.y * 0.05;
        vec3 wp = center + (side * position.x + up * (position.y + 0.5)) * s;
        `}
        float dist = length(rel);
        vA = on * (1.0 - smoothstep(uBox.x * 0.3, uBox.x * 0.5, dist)) * smoothstep(1.5, 4.0, dist);
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor;
      uniform float uFlash;
      varying vec2 vUv;
      varying float vA;
      void main() {
        ${rain ? `
        float a = smoothstep(0.0, 0.5, 1.0 - abs(vUv.x - 0.5) * 2.0) * smoothstep(0.0, 0.25, vUv.y) * (1.0 - smoothstep(0.6, 1.0, vUv.y));
        a *= 0.3;
        ` : `
        float r = length(vUv - 0.5) * 2.0;
        float a = (1.0 - smoothstep(0.3, 1.0, r)) * 0.9;
        `}
        a *= vA;
        if (a < 0.003) discard;
        gl_FragColor = vec4(uColor * (1.0 + uFlash * 3.0), a);
      }`,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 20000;
  return { mesh, uniforms };
}

export function createPrecip(scene) {
  const rain = makeField({ count: 9000, box: [44, 26, 44], rain: true });
  const snow = makeField({ count: 7000, box: [40, 22, 40], rain: false });
  scene.add(rain.mesh, snow.mesh);
  return {
    update(time, rainAmt, snowAmt, wind, lightCol, flash) {
      rain.uniforms.uTime.value = time;
      snow.uniforms.uTime.value = time;
      rain.uniforms.uAmount.value = rainAmt;
      snow.uniforms.uAmount.value = snowAmt;
      rain.mesh.visible = rainAmt > 0.01;
      snow.mesh.visible = snowAmt > 0.01;
      rain.uniforms.uWind.value.copy(wind);
      snow.uniforms.uWind.value.copy(wind);
      rain.uniforms.uColor.value.copy(lightCol).multiplyScalar(1.6);
      snow.uniforms.uColor.value.copy(lightCol).multiplyScalar(1.15);
      rain.uniforms.uFlash.value = flash;
      snow.uniforms.uFlash.value = flash;
    },
  };
}
