import { useEffect, useImperativeHandle, useRef, useState, type RefObject } from "react";
import * as THREE from "three";
import { Artwork, bookArtUrl } from "../art";
import { BOOK_ART } from "./scenes";
import { chapterMotion, pageTurn } from "./motion";

export type BookActions = { redraw: () => void };
type Props = { progress: RefObject<number>; actionsRef: RefObject<BookActions | null>; scene: number; reduced: boolean };
const W = 1.7, H = 2.3;

/** Subdivided paper bends from a sewn hinge. Draw only on scroll, resize or asset arrival. */
export default function Storybook({ progress, actionsRef, scene: sceneIndex, reduced }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const reduceRef = useRef(reduced); reduceRef.current = reduced;
  const redrawRef = useRef<() => void>(() => {});
  const [ready, setReady] = useState(false);
  useImperativeHandle(actionsRef, () => ({ redraw: () => redrawRef.current() }), []);
  useEffect(() => {
    const container = host.current!;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" }); }
    catch { return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.setClearColor(0, 0);
    renderer.domElement.setAttribute("aria-hidden", "true");
    container.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-2, 2, 1.4, -1.4, .1, 80);
    const book = new THREE.Group(); scene.add(book);
    scene.add(new THREE.AmbientLight(0xfff0d4, .85));
    const key = new THREE.DirectionalLight(0xffe8ba, 1.7); key.position.set(-3, 5, 7); scene.add(key);
    const fill = new THREE.DirectionalLight(0x8dd6c7, .4); fill.position.set(4, -1, 3); scene.add(fill);
    const resources: { dispose: () => void }[] = [];
    const bookMaterials = new Set<THREE.Material>();
    const material = (color: number) => { const m = new THREE.MeshStandardMaterial({ color, roughness: .8, metalness: .03, transparent: true }); resources.push(m); bookMaterials.add(m); return m; };
    const cloth = material(0x183e43), paper = material(0xf4dfb3), gold = material(0xc99d50);
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) => {
      const geometry = new THREE.BoxGeometry(w, h, d); resources.push(geometry);
      const mesh = new THREE.Mesh(geometry, m); mesh.position.set(x, y, z); book.add(mesh); return mesh;
    };
    for (const side of [-1, 1]) {
      box(W + .055, H + .075, .06, side * W / 2, 0, -.25, cloth);
      box(W - .04, H - .04, .19, side * W / 2, 0, -.12, paper);
      for (let i = 0; i < 12; i++) {
        box(W - .025, .006, .006, side * W / 2, -H / 2 + .024, -.025 - i * .014, gold);
        box(.006, H - .045, .005, side * (W - .02), 0, -.025 - i * .014, paper);
      }
    }
    box(.055, H + .07, .23, 0, 0, -.13, cloth);
    const blank = new THREE.DataTexture(new Uint8Array([238, 217, 176, 255]), 1, 1); blank.needsUpdate = true; blank.colorSpace = THREE.SRGBColorSpace; resources.push(blank);
    const textures = new Map<number, THREE.Texture>();
    const loader = new THREE.TextureLoader();
    let disposed = false, frame = 0, dirty = true, lastProgress = -1, lastReduced = reduceRef.current;
    const makeSurface = (front: number, back: number, bending = false) => {
      const m = new THREE.ShaderMaterial({
        side: THREE.DoubleSide, transparent: true,
        uniforms: { pageOpacity: { value: 1 }, bendTurn: { value: 0 }, bending: { value: bending ? 1 : 0 }, front: { value: blank }, back: { value: blank }, frontAspect: { value: 1 }, backAspect: { value: 1 } },
        vertexShader: `uniform float bendTurn;uniform float bending;varying vec2 uv0;varying vec3 normal0;
          void main(){uv0=uv;vec3 p=position;vec3 n=normal;
          if(bending>.5){float a=bendTurn*3.14159265;float u=p.x/1.7;float curl=sin(a)*sin(u*3.14159265)*.23;
          float slope=sin(a)*cos(u*3.14159265)*.23*3.14159265/1.7;
          p=vec3(p.x*cos(a)-curl*sin(a),p.y,p.x*sin(a)+curl*cos(a));
          n=normalize(vec3(-sin(a)-slope*cos(a),0.,cos(a)-slope*sin(a)));}
          normal0=normalize(normalMatrix*n);gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}`,
        fragmentShader: `uniform float pageOpacity;uniform sampler2D front;uniform sampler2D back;uniform float frontAspect;uniform float backAspect;varying vec2 uv0;varying vec3 normal0;
          void main(){vec2 uv=gl_FrontFacing?uv0:vec2(1.-uv0.x,uv0.y);float border=.045;
          vec3 col=vec3(.94,.85,.68);if(uv.x>border&&uv.x<1.-border&&uv.y>border&&uv.y<1.-border){vec2 q=(uv-border)/(1.-2.*border);float aspect=gl_FrontFacing?frontAspect:backAspect;float pageAspect=.73913;if(aspect>pageAspect)q.x=(q.x-.5)*pageAspect/aspect+.5;else q.y=(q.y-.5)*aspect/pageAspect+.5;col=gl_FrontFacing?texture2D(front,q).rgb:texture2D(back,q).rgb;}
          float shade=.86+.14*abs(dot(normalize(normal0),normalize(vec3(-.3,.6,1.))));col*=shade*(.9+.1*smoothstep(0.,.09,uv0.x));gl_FragColor=vec4(col,pageOpacity);
          #include <colorspace_fragment>
          }`,
      });
      resources.push(m); bookMaterials.add(m);
      const bind = () => {
        if (disposed) return;
        for (const [key, index] of [["front", front], ["back", back]] as const) {
          const texture = textures.get(index);
          if (texture) { const image = texture.image as { width: number; height: number }; m.uniforms[key].value = texture; m.uniforms[`${key}Aspect`].value = image.width / image.height; }
        }
        redraw(true);
      };
      binders.push(bind);
      return m;
    };
    const binders: (() => void)[] = [];
    const baseGeo = new THREE.PlaneGeometry(W, H); resources.push(baseGeo);
    const left = new THREE.Mesh(baseGeo, makeSurface(0, 0)); left.position.set(-W / 2, 0, .005); book.add(left);
    const right = new THREE.Mesh(baseGeo, makeSurface(11, 11)); right.position.set(W / 2, 0, .005); book.add(right);
    const leaves = Array.from({ length: 5 }, (_, i) => {
      const geometry = new THREE.PlaneGeometry(W, H, 32, 4); geometry.translate(W / 2, 0, 0); resources.push(geometry);

      const mesh = new THREE.Mesh(geometry, makeSurface(i * 2 + 1, i * 2 + 2, true));
      book.add(mesh); return { mesh, geometry, index: i };
    });
    // The world grows from the book's own horizon in this camera, not in the off-screen Atlas.
    const worldGeometry = new THREE.SphereGeometry(1, 80, 56);
    const worldMaterial = new THREE.MeshPhongMaterial({ color: 0x326b6d, transparent: true, opacity: 0, shininess: 15, specular: 0x416e73, depthWrite: false });
    const world = new THREE.Mesh(worldGeometry, worldMaterial); world.position.z = .3; scene.add(world);
    resources.push(worldGeometry, worldMaterial);
    const atmosphereMaterial = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.BackSide,
      uniforms: { reveal: { value: 0 } },
      vertexShader: `varying vec3 n;varying vec3 eye;void main(){vec4 p=modelViewMatrix*vec4(position,1.);n=normalize(normalMatrix*normal);eye=-p.xyz;gl_Position=projectionMatrix*p;}`,
      fragmentShader: `uniform float reveal;varying vec3 n;varying vec3 eye;void main(){float rim=pow(1.-abs(dot(normalize(n),normalize(eye))),3.);gl_FragColor=vec4(.35,.72,.68,rim*.3*reveal);}`
    });
    resources.push(atmosphereMaterial);
    const atmosphere = new THREE.Mesh(worldGeometry, atmosphereMaterial); world.add(atmosphere); atmosphere.scale.setScalar(1.02);
    let worldRequested = false;
    const requestWorld = () => {
      if (worldRequested) return; worldRequested = true;
      loader.load(`${import.meta.env.BASE_URL}landing/earth-surface.webp`, texture => {
        if (disposed) { texture.dispose(); return; }
        texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = Math.min(2, renderer.capabilities.getMaxAnisotropy());
        resources.push(texture); worldMaterial.color.set(0xffffff); worldMaterial.map = texture; worldMaterial.needsUpdate = true; redraw(true);
      }, undefined, () => { worldMaterial.color.set(0x326b6d); redraw(true); });
    };
    const draw = () => {
      frame = 0; if (disposed) return;
      const p = progress.current;
      if (p === lastProgress && lastReduced === reduceRef.current && !dirty) return;
      lastProgress = p; lastReduced = reduceRef.current; dirty = false;
      const state = chapterMotion(p);
      if (p > .57) requestWorld();
      book.visible = state.book > 0;
      bookMaterials.forEach(m => {
        m.opacity = state.book; m.depthWrite = state.book > .99;
        if (m instanceof THREE.ShaderMaterial) m.uniforms.pageOpacity.value = state.book;
      });
      world.visible = state.earth > 0;
      world.scale.set(1.2, .025 + state.earth * 1.175, 1.2);
      world.rotation.set(.22, -.7 + state.earth * .32, 0);
      worldMaterial.opacity = state.earth;
      atmosphereMaterial.uniforms.reveal.value = state.earth;
      book.rotation.set(.18 - state.collapse * 1.72, .015, -.025 * (1 - state.collapse));
      book.position.set(0, 0, 0);
      book.scale.set(1 - state.collapse * .2, 1, 1 - state.collapse * .85);
      for (const leaf of leaves) {
        const turn = reduceRef.current ? Math.round(pageTurn(p, leaf.index)) : pageTurn(p, leaf.index);
        (leaf.mesh.material as THREE.ShaderMaterial).uniforms.bendTurn.value = turn;
        leaf.mesh.position.z = turn < .5 ? .035 + (5 - leaf.index) * .004 : .035 + leaf.index * .004;
      }
      renderer.render(scene, camera);
    };
    const redraw = (force = false) => { dirty ||= force; if (!disposed && !frame) frame = requestAnimationFrame(draw); };
    redrawRef.current = redraw;
    const resize = new ResizeObserver(() => {
      const w = container.clientWidth, h = container.clientHeight;
      if (!w || !h) return;
      const aspect = w / h, halfHeight = Math.max(H / 2 + .16, (W + .12) / aspect);
      camera.left = -halfHeight * aspect; camera.right = halfHeight * aspect;
      camera.top = halfHeight; camera.bottom = -halfHeight;
      camera.position.set(0, .35, 8); camera.lookAt(0, 0, 0); camera.updateProjectionMatrix(); renderer.setSize(w, h); redraw(true);
    });
    resize.observe(container);
    // Keep image decoding and upload bounded. First spread always wins the queue.
    const queue = BOOK_ART.map((name, index) => ({ name, index }));
    const loadNext = () => {
      if (disposed) return;
      const item = queue.shift(); if (!item) return;
      loader.load(bookArtUrl(item.name), texture => {
        if (disposed) { texture.dispose(); return; }
        texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = Math.min(2, renderer.capabilities.getMaxAnisotropy());
        textures.set(item.index, texture); binders.forEach(bind => bind());
        if (textures.has(0) && textures.has(1)) setReady(true);
        loadNext();
      }, undefined, loadNext);
    };
    loadNext(); loadNext();
    const lost = (e: Event) => { e.preventDefault(); setReady(false); };
    renderer.domElement.addEventListener("webglcontextlost", lost);
    return () => {
      disposed = true; resize.disconnect(); cancelAnimationFrame(frame); redrawRef.current = () => {};
      renderer.domElement.removeEventListener("webglcontextlost", lost);
      resources.forEach(r => r.dispose()); textures.forEach(t => t.dispose()); renderer.dispose(); renderer.domElement.remove();
    };
  }, [progress]);
  return <div className={`storybook-object${ready ? " is-ready" : ""}`} aria-hidden="true">
    <div className="book-canvas" ref={host} />
    {sceneIndex === 5 && <div className="book-world-fallback"><img src={`${import.meta.env.BASE_URL}landing/earth-surface.webp`} alt="" loading="lazy" decoding="async" /></div>}
    <div className="book-static"><Artwork name={BOOK_ART[sceneIndex * 2]} variant="book" eager /><Artwork name={BOOK_ART[sceneIndex * 2 + 1]} variant="book" eager /></div>
  </div>;
}
