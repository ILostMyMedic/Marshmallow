import { describe, expect, it } from 'vitest';
import { act, createRoot, extend } from '@react-three/fiber';
import * as THREE from 'three';
import { OnBone, type BodyRig } from './RigBody';

// Rendered for real through react-three-fiber (no WebGL: a stand-in renderer that draws nothing), because what broke
// was R3F's portal itself: given a new container, it kept mounting into the old one.

/** A renderer that does nothing, for a root that never draws. */
function nullRenderer() {
  const noop = () => {};
  return {
    render: noop,
    setSize: noop,
    setPixelRatio: noop,
    getPixelRatio: () => 1,
    setClearColor: noop,
    dispose: noop,
    compile: noop,
    domElement: { style: {}, addEventListener: noop, removeEventListener: noop },
    shadowMap: { enabled: false, type: 0, needsUpdate: false },
    xr: { enabled: false, addEventListener: noop, removeEventListener: noop, setAnimationLoop: noop, isPresenting: false },
    info: { render: { frame: 0 } },
    setAnimationLoop: noop,
    outputColorSpace: '',
    toneMapping: 0,
  } as unknown as THREE.WebGLRenderer;
}

/** Just enough of a body for OnBone: a skeleton's bones under a root. */
function fakeBody(): BodyRig {
  const root = new THREE.Bone();
  const bones = Array.from({ length: 20 }, () => new THREE.Bone());
  bones.forEach((b, i) => (i ? bones[i - 1] : root).add(b));
  return { bones, root } as unknown as BodyRig;
}

const headIn = (bone: THREE.Object3D) => bone.children.some((c) => c.name === 'head');

// what <Canvas> does for a root of its own: three.js's classes as JSX, and React's act() switched on
extend(THREE as unknown as Parameters<typeof extend>[0]);
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('OnBone', () => {
  it('moves what rides a bone onto the new skeleton when the body is rebuilt (a change of body style)', async () => {
    const canvas = { style: {}, addEventListener: () => {}, removeEventListener: () => {}, width: 100, height: 100, getContext: () => null } as unknown as HTMLCanvasElement;
    const root = createRoot(canvas);
    await root.configure({ gl: nullRenderer(), size: { width: 100, height: 100, top: 0, left: 0 }, frameloop: 'never', events: undefined, dpr: 1 });
    const human = fakeBody();
    const chibi = fakeBody();
    const draw = (body: BodyRig) =>
      act(async () =>
        root.render(
          <OnBone body={body} bone="head">
            <group name="head" />
          </OnBone>,
        ),
      );
    await draw(human);
    expect(headIn(human.bones[5])).toBe(true);
    // live switches, both ways: the head goes with the new head bone every time, and leaves the old one
    await draw(chibi);
    expect(headIn(chibi.bones[5])).toBe(true);
    expect(headIn(human.bones[5])).toBe(false);
    await draw(human);
    expect(headIn(human.bones[5])).toBe(true);
    expect(headIn(chibi.bones[5])).toBe(false);
    await act(async () => root.unmount());
  });
});
