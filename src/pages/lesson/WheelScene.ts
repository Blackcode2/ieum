import {
  CanvasTexture,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OrthographicCamera,
  RepeatWrapping,
  SRGBColorSpace,
  Scene,
  Vector2,
  WebGLRenderer,
} from 'three';
import type { ClayShape } from '../../cv/clay';

/** The wheel is seen from slightly above, so the rim reads as an opening and the pot as a solid. */
const TILT = 0.24;
const RADIAL_SEGMENTS = 64;
const SPIN_TURNS_PER_SECOND = 1.1;
/** The spin is drawn at camera rate; the tracker needs the rest of each frame. */
const FRAME_MS = 30;

/**
 * Draws the pottery wheel and the clay over the camera picture.
 *
 * Scene units are the tracked view's height units, the same as the clay's: x runs 0..aspect across
 * the panel and y runs 0..1 upwards. The picture is mirrored like the camera preview, so the clay's
 * un-mirrored x is flipped here.
 */
export class WheelScene {
  private readonly renderer: WebGLRenderer;
  private readonly canvas: HTMLCanvasElement;
  private readonly scene = new Scene();
  private readonly camera: OrthographicCamera;
  private readonly pivot = new Group();
  private readonly clay: Mesh<LatheGeometry, MeshStandardMaterial>;
  private readonly wheel: Mesh<CylinderGeometry, MeshStandardMaterial>;
  private readonly shadow: Mesh<CylinderGeometry, MeshBasicMaterial>;
  private readonly rings: CanvasTexture;
  private readonly aspect: number;
  private frame = 0;
  private lastRender = 0;
  private disposed = false;

  /**
   * Creates its own canvas inside `host` (a box laid over the camera picture), so that leaving the
   * screen can give the WebGL context back. Throws if WebGL is not available; the lesson then runs
   * without the wheel.
   */
  constructor(host: HTMLElement, aspect: number, pixelWidth: number, pixelHeight: number) {
    this.aspect = aspect;
    this.canvas = document.createElement('canvas');
    this.canvas.width = pixelWidth;
    this.canvas.height = pixelHeight;
    this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
    this.canvas.dataset.testid = 'wheel-scene';
    this.renderer = new WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true });
    host.appendChild(this.canvas);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.setSize(pixelWidth, pixelHeight, false);

    this.camera = new OrthographicCamera(0, aspect, 1, 0, -10, 10);
    this.camera.position.z = 5;

    this.scene.add(new HemisphereLight(0xffffff, 0x6f675c, 1.15));
    const key = new DirectionalLight(0xfff4e6, 2.1);
    key.position.set(-0.7, 1.3, 1.6);
    this.scene.add(key);
    const fill = new DirectionalLight(0xdfe8ff, 0.55);
    fill.position.set(1.2, 0.3, 0.8);
    this.scene.add(fill);

    // Tilted towards the viewer and stretched back, so heights on screen still match the hands'.
    this.pivot.rotation.x = TILT;
    this.pivot.scale.y = 1 / Math.cos(TILT);
    this.pivot.visible = false;
    this.scene.add(this.pivot);

    this.rings = throwingRings();
    this.clay = new Mesh(
      new LatheGeometry([new Vector2(0.1, 0), new Vector2(0.1, 0.1)], RADIAL_SEGMENTS),
      new MeshStandardMaterial({
        color: 0xe2dcd1,
        roughness: 0.7,
        metalness: 0,
        side: DoubleSide,
        bumpMap: this.rings,
        bumpScale: 2.2,
      }),
    );
    this.wheel = new Mesh(
      new CylinderGeometry(1, 1, 1, 72),
      new MeshStandardMaterial({ color: 0xc4c8ce, roughness: 0.55, metalness: 0.15, map: wheelMarks() }),
    );
    this.shadow = new Mesh(
      new CylinderGeometry(1, 1, 0.001, 48),
      new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28 }),
    );
    this.pivot.add(this.wheel, this.shadow, this.clay);

    const tick = (now: number) => {
      if (this.disposed) return;
      this.frame = requestAnimationFrame(tick);
      if (now - this.lastRender < FRAME_MS) return;
      this.lastRender = now;
      const turn = (now / 1000) * SPIN_TURNS_PER_SECOND;
      this.rings.offset.x = -turn;
      this.wheel.rotation.y = turn * Math.PI * 2;
      this.renderer.render(this.scene, this.camera);
    };
    this.frame = requestAnimationFrame(tick);
  }

  /** Shows the clay in its current shape, or hides the wheel when there is none. */
  setClay(shape: ClayShape | null): void {
    if (!shape || shape.radii.length === 0) {
      this.pivot.visible = false;
      return;
    }
    this.pivot.visible = true;
    this.pivot.position.set(this.aspect - shape.axisX, 1 - shape.baseY, 0);

    const head = shape.startRadius * 1.5;
    const thickness = shape.startRadius * 0.16;
    this.wheel.scale.set(head, thickness, head);
    this.wheel.position.y = -thickness / 2;
    this.shadow.scale.set(shape.startRadius * 1.25, 1, shape.startRadius * 1.25);
    this.shadow.position.y = 0.0006;

    this.clay.geometry.dispose();
    this.clay.geometry = new LatheGeometry(profile(shape), RADIAL_SEGMENTS);
    // Rings keep their real spacing as the pot grows taller.
    this.rings.repeat.set(3, Math.max(1, shape.height / (shape.startRadius * 0.9)));
  }

  /** Draws the wheel and the pot as they are right now into a 2D canvas, for the visitor's photo. */
  drawTo(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number): void {
    // Rendered here and now: the drawing buffer is not kept from one frame to the next.
    this.renderer.render(this.scene, this.camera);
    context.drawImage(this.canvas, x, y, width, height);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.clay.geometry.dispose();
    this.clay.material.dispose();
    this.wheel.geometry.dispose();
    this.wheel.material.map?.dispose();
    this.wheel.material.dispose();
    this.shadow.geometry.dispose();
    this.shadow.material.dispose();
    this.rings.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }
}

/** Half outline for the lathe: up the outer wall, over the rim, down the inner wall and across the floor. */
function profile(shape: ClayShape): Vector2[] {
  const { radii, height, wall } = shape;
  const step = height / radii.length;
  const inner = (radius: number) => Math.max(radius * 0.1, radius - wall);
  const points: Vector2[] = [new Vector2(0, 0), new Vector2(radii[0], 0)];
  for (let i = 0; i < radii.length; i++) points.push(new Vector2(radii[i], (i + 0.5) * step));

  const rim = radii[radii.length - 1];
  const lip = Math.min(wall * 0.3, height * 0.03);
  points.push(new Vector2(rim, height));
  points.push(new Vector2((rim + inner(rim)) / 2, height + lip));
  points.push(new Vector2(inner(rim), height));

  // The pot's floor is as thick as its wall, but never so high that the opening looks filled in.
  const floor = Math.min(Math.max(wall, height * 0.1), height * 0.5);
  let last = inner(rim);
  for (let i = radii.length - 1; i >= 0 && (i + 0.5) * step > floor; i -= 2) {
    last = inner(radii[i]);
    points.push(new Vector2(last, (i + 0.5) * step));
  }
  points.push(new Vector2(last, floor), new Vector2(0, floor));
  return points;
}

/** Faint horizontal grooves with a few vertical streaks, so the spin can be seen. Used as a bump map. */
function throwingRings(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#808080';
  context.fillRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < canvas.height; y += 8) {
    const shade = 108 + ((y * 37) % 40);
    context.fillStyle = `rgb(${shade}, ${shade}, ${shade})`;
    context.fillRect(0, y, canvas.width, 3);
  }
  for (let i = 0; i < 26; i++) {
    const x = (i * 97) % canvas.width;
    const shade = 96 + ((i * 53) % 70);
    context.fillStyle = `rgba(${shade}, ${shade}, ${shade}, 0.5)`;
    context.fillRect(x, 0, 2 + (i % 3), canvas.height);
  }
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  return texture;
}

/** Concentric grooves and a few radial marks for the wheel head, so its turning shows. */
function wheelMarks(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#b9bdc3';
  context.fillRect(0, 0, 256, 256);
  context.strokeStyle = 'rgba(70, 74, 80, 0.55)';
  for (let r = 16; r < 128; r += 14) {
    context.lineWidth = 1.5;
    context.beginPath();
    context.arc(128, 128, r, 0, Math.PI * 2);
    context.stroke();
  }
  context.lineWidth = 3;
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2 + 0.3;
    context.beginPath();
    context.moveTo(128 + Math.cos(angle) * 30, 128 + Math.sin(angle) * 30);
    context.lineTo(128 + Math.cos(angle) * 124, 128 + Math.sin(angle) * 124);
    context.stroke();
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
