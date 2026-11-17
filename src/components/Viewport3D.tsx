import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  Box,
  ChevronDown,
  ChevronUp,
  Grid3x3,
  RotateCcw,
  RefreshCw,
  Upload,
} from 'lucide-react';
import type { ModelStats } from '../types/converter';

interface Viewport3DProps {
  modelScene: THREE.Group | null;
  modelName: string;
  modelStats: ModelStats | null;
  isLoading: boolean;
  onDropFiles: (files: FileList) => void;
  onOpenFilePicker: () => void;
}

type CameraPreset = 'iso' | 'front' | 'top';

function detectSoftwareGl(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

function createContactShadowTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createRadialGradient(
      size / 2,
      size / 2,
      0,
      size / 2,
      size / 2,
      size / 2
    );
    grad.addColorStop(0, 'rgba(0, 0, 0, 0.55)');
    grad.addColorStop(0.5, 'rgba(0, 0, 0, 0.22)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export const Viewport3D: React.FC<Viewport3DProps> = ({
  modelScene,
  modelName,
  modelStats,
  isLoading,
  onDropFiles,
  onOpenFilePicker,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [wireframe, setWireframe] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [autoRotate, setAutoRotate] = useState(false);
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [contextLost, setContextLost] = useState(false);

  const sceneStateRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    controls: OrbitControls;
    modelHolder: THREE.Group;
    grid: THREE.GridHelper;
    shadowPlane: THREE.Mesh;
    isSoftwareGl: boolean;
    requestRender: () => void;
    frameCameraToObject: (preset?: CameraPreset, immediate?: boolean) => void;
    cameraTargetPos: THREE.Vector3;
    controlsTargetPos: THREE.Vector3;
    transitioning: boolean;
  } | null>(null);

  const wireframeRef = useRef(wireframe);
  wireframeRef.current = wireframe;

  const autoRotateRef = useRef(autoRotate);
  autoRotateRef.current = autoRotate;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (e.key === 'h' || e.key === 'H') {
        setDockCollapsed((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Initialize Three.js WebGL context once
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = detectSoftwareGl();
    const width = Math.max(container.clientWidth, 300);
    const height = Math.max(container.clientHeight, 300);

    const scene = new THREE.Scene();
    const bgColor = new THREE.Color(0x161a20);
    scene.background = bgColor;
    scene.fog = new THREE.Fog(0x161a20, 14, 38);

    const camera = new THREE.PerspectiveCamera(40, width / height, 0.02, 200);
    camera.position.set(2.8, 2.1, 3.2);

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.setPixelRatio(
      isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2)
    );
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';

    container.appendChild(renderer.domElement);

    const handleContextLost = (e: Event) => {
      e.preventDefault();
      setContextLost(true);
    };
    const handleContextRestored = () => {
      setContextLost(false);
    };
    renderer.domElement.addEventListener('webglcontextlost', handleContextLost);
    renderer.domElement.addEventListener(
      'webglcontextrestored',
      handleContextRestored
    );

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    const envTarget = pmremGenerator.fromScene(roomEnv, 0.04);
    scene.environment = envTarget.texture;
    roomEnv.dispose();
    pmremGenerator.dispose();

    // 3-point calibrated studio lighting
    const hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x1e293b, 0.65);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff5e8, 2.2);
    keyLight.position.set(4.5, 7.5, 5.0);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 25;
    const d = 3.5;
    keyLight.shadow.camera.left = -d;
    keyLight.shadow.camera.right = d;
    keyLight.shadow.camera.top = d;
    keyLight.shadow.camera.bottom = -d;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0xc7d2fe, 0.85);
    rimLight.position.set(-4.5, 3.2, -4.5);
    scene.add(rimLight);

    // Subtle CAD studio grid
    const grid = new THREE.GridHelper(12, 24, 0x3b4454, 0x242a34);
    grid.position.y = -0.002;
    scene.add(grid);

    // Soft contact shadow plane
    const shadowTex = createContactShadowTexture();
    const shadowGeo = new THREE.PlaneGeometry(4, 4);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.55,
    });
    const shadowPlane = new THREE.Mesh(shadowGeo, shadowMat);
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.position.y = -0.004;
    scene.add(shadowPlane);

    const modelHolder = new THREE.Group();
    scene.add(modelHolder);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.08;
    controls.minDistance = 0.35;
    controls.maxDistance = 40;
    controls.maxPolarAngle = Math.PI * 0.495;
    controls.autoRotateSpeed = 1.6;

    const cameraTargetPos = camera.position.clone();
    const controlsTargetPos = new THREE.Vector3(0, 0.5, 0);
    let transitioning = false;

    let frameId = 0;
    let renderBusy = false;
    let renderDirty = false;
    let lastTime = performance.now();

    function afterDraw(cb: () => void) {
      try {
        const gl = renderer.getContext() as WebGL2RenderingContext;
        if (!gl || typeof gl.fenceSync !== 'function') {
          frameId = window.setTimeout(cb, 80);
          return;
        }
        const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl.flush();
        const poll = () => {
          const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
          if (state === gl.UNSIGNALED) {
            frameId = window.setTimeout(poll, 5);
          } else {
            if (sync) gl.deleteSync(sync);
            frameId = window.setTimeout(cb, 80);
          }
        };
        frameId = window.setTimeout(poll, 5);
      } catch {
        frameId = window.setTimeout(cb, 80);
      }
    }

    function requestRender() {
      if (renderBusy) {
        renderDirty = true;
        return;
      }
      renderBusy = true;
      frameId = requestAnimationFrame((now) => {
        renderDirty = false;
        const delta = Math.min((now - lastTime) / 1000, 0.1);
        lastTime = now;

        const state = sceneStateRef.current;
        if (state && state.transitioning) {
          camera.position.x = THREE.MathUtils.damp(
            camera.position.x,
            state.cameraTargetPos.x,
            8,
            delta
          );
          camera.position.y = THREE.MathUtils.damp(
            camera.position.y,
            state.cameraTargetPos.y,
            8,
            delta
          );
          camera.position.z = THREE.MathUtils.damp(
            camera.position.z,
            state.cameraTargetPos.z,
            8,
            delta
          );
          controls.target.x = THREE.MathUtils.damp(
            controls.target.x,
            state.controlsTargetPos.x,
            8,
            delta
          );
          controls.target.y = THREE.MathUtils.damp(
            controls.target.y,
            state.controlsTargetPos.y,
            8,
            delta
          );
          controls.target.z = THREE.MathUtils.damp(
            controls.target.z,
            state.controlsTargetPos.z,
            8,
            delta
          );
          const dist =
            camera.position.distanceTo(state.cameraTargetPos) +
            controls.target.distanceTo(state.controlsTargetPos);
          if (dist < 0.005) {
            camera.position.copy(state.cameraTargetPos);
            controls.target.copy(state.controlsTargetPos);
            state.transitioning = false;
          } else {
            renderDirty = true;
          }
        }

        controls.autoRotate = !isSoftwareGl && autoRotateRef.current;
        controls.update();
        if (controls.autoRotate) {
          renderDirty = true;
        }

        renderer.render(scene, camera);

        const done = () => {
          renderBusy = false;
          if (renderDirty) {
            requestRender();
          }
        };

        if (isSoftwareGl) {
          afterDraw(done);
        } else {
          done();
        }
      });
    }

    const onControlsStart = () => {
      if (sceneStateRef.current) {
        sceneStateRef.current.transitioning = false;
      }
    };
    const onControlsChange = () => {
      requestRender();
    };
    controls.addEventListener('start', onControlsStart);
    controls.addEventListener('change', onControlsChange);

    function frameCameraToObject(
      preset: CameraPreset = 'iso',
      immediate = false
    ) {
      const box = new THREE.Box3().setFromObject(modelHolder);
      if (box.isEmpty()) {
        controlsTargetPos.set(0, 0.5, 0);
        cameraTargetPos.set(2.8, 2.0, 3.2);
      } else {
        const center = new THREE.Vector3();
        const size = new THREE.Vector3();
        box.getCenter(center);
        box.getSize(size);

        const maxDim = Math.max(size.x, size.y, size.z, 0.4);
        const dist = maxDim * 2.15;

        controlsTargetPos.copy(center);
        if (preset === 'front') {
          cameraTargetPos.set(center.x, center.y + maxDim * 0.12, center.z + dist);
        } else if (preset === 'top') {
          cameraTargetPos.set(center.x, center.y + dist * 1.15, center.z + 0.01);
        } else {
          cameraTargetPos.set(
            center.x + dist * 0.72,
            center.y + dist * 0.48,
            center.z + dist * 0.8
          );
        }
      }

      if (immediate || isSoftwareGl) {
        camera.position.copy(cameraTargetPos);
        controls.target.copy(controlsTargetPos);
        if (sceneStateRef.current) {
          sceneStateRef.current.transitioning = false;
        }
        controls.update();
      } else if (sceneStateRef.current) {
        sceneStateRef.current.transitioning = true;
      }
      requestRender();
    }

    sceneStateRef.current = {
      scene,
      camera,
      renderer,
      controls,
      modelHolder,
      grid,
      shadowPlane,
      isSoftwareGl,
      requestRender,
      frameCameraToObject,
      cameraTargetPos,
      controlsTargetPos,
      transitioning,
    };

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.max(entry.contentRect.width, 100);
        const h = Math.max(entry.contentRect.height, 100);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
        requestRender();
      }
    });
    resizeObserver.observe(container);

    requestRender();

    return () => {
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      resizeObserver.disconnect();
      controls.removeEventListener('start', onControlsStart);
      controls.removeEventListener('change', onControlsChange);
      controls.dispose();
      renderer.domElement.removeEventListener(
        'webglcontextlost',
        handleContextLost
      );
      renderer.domElement.removeEventListener(
        'webglcontextrestored',
        handleContextRestored
      );
      shadowGeo.dispose();
      shadowMat.dispose();
      shadowTex.dispose();
      envTarget.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
      sceneStateRef.current = null;
    };
  }, []);

  // Swap model inside modelHolder cleanly without tearing down renderer
  useEffect(() => {
    const state = sceneStateRef.current;
    if (!state) return;

    while (state.modelHolder.children.length > 0) {
      state.modelHolder.remove(state.modelHolder.children[0]);
    }

    if (modelScene) {
      const displayClone = modelScene.clone(true);

      // Compute bounds to normalize preview scale & sit flush on Y=0
      const box = new THREE.Box3().setFromObject(displayClone);
      if (!box.isEmpty()) {
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);

        const maxDim = Math.max(size.x, size.y, size.z, 0.001);
        const normScale = 2.2 / maxDim;

        displayClone.scale.multiplyScalar(normScale);
        displayClone.updateMatrixWorld(true);

        const scaledBox = new THREE.Box3().setFromObject(displayClone);
        const scaledCenter = new THREE.Vector3();
        scaledBox.getCenter(scaledCenter);

        displayClone.position.x -= scaledCenter.x;
        displayClone.position.z -= scaledCenter.z;
        displayClone.position.y -= scaledBox.min.y;

        const scaledSize = new THREE.Vector3();
        scaledBox.getSize(scaledSize);
        const shadowScale = Math.max(scaledSize.x, scaledSize.z, 0.8) * 1.15;
        state.shadowPlane.scale.set(shadowScale, shadowScale, 1);
      }

      displayClone.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          mesh.castShadow = !state.isSoftwareGl;
          mesh.receiveShadow = !state.isSoftwareGl;
          const mats = Array.isArray(mesh.material)
            ? mesh.material
            : [mesh.material];
          mats.forEach((m) => {
            if (m && 'wireframe' in m) {
              (m as THREE.MeshStandardMaterial).wireframe =
                wireframeRef.current;
            }
          });
        }
      });

      state.modelHolder.add(displayClone);
      state.frameCameraToObject('iso', true);
    } else {
      state.requestRender();
    }
  }, [modelScene]);

  // Toggle wireframe without rebuilding model
  useEffect(() => {
    const state = sceneStateRef.current;
    if (!state) return;
    state.modelHolder.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        const mats = Array.isArray(mesh.material)
          ? mesh.material
          : [mesh.material];
        mats.forEach((m) => {
          if (m && 'wireframe' in m) {
            (m as THREE.MeshStandardMaterial).wireframe = wireframe;
          }
        });
      }
    });
    state.requestRender();
  }, [wireframe]);

  // Toggle grid
  useEffect(() => {
    const state = sceneStateRef.current;
    if (!state) return;
    state.grid.visible = showGrid;
    state.requestRender();
  }, [showGrid]);

  // Toggle auto-rotate
  useEffect(() => {
    const state = sceneStateRef.current;
    if (!state) return;
    state.requestRender();
  }, [autoRotate]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onDropFiles(e.dataTransfer.files);
    }
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="relative w-full h-full min-h-[420px] bg-[#161A20] overflow-hidden select-none"
    >
      {/* Isolated WebGL canvas mount */}
      <div ref={mountRef} className="w-full h-full" />

      {/* Top-left clean unboxed model telemetry readout (no pills, no dots) */}
      {modelStats && (
        <div className="pointer-events-none absolute top-4 left-5 z-10 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-300">
          <span className="font-medium text-white truncate max-w-[240px]">
            {modelName}
          </span>
          <span aria-hidden="true" className="text-slate-500">
            ·
          </span>
          <span className="font-mono-tabular text-slate-300">
            {modelStats.triangleCount.toLocaleString()} tris
          </span>
          <span aria-hidden="true" className="text-slate-500">
            ·
          </span>
          <span className="font-mono-tabular text-slate-400">
            {modelStats.dimensions.x} × {modelStats.dimensions.y} ×{' '}
            {modelStats.dimensions.z} m
          </span>
        </div>
      )}

      {/* Loading indicator */}
      {isLoading && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#161A20]/85 text-slate-200 gap-3">
          <RefreshCw
            className="w-6 h-6 animate-spin text-blue-400"
            aria-hidden="true"
          />
          <p className="text-sm font-medium">Parsing GLB geometry...</p>
        </div>
      )}

      {/* Empty state if no model loaded */}
      {!modelScene && !isLoading && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center p-6 text-center">
          <div className="max-w-sm border border-dashed border-slate-600 rounded-xl p-8 bg-[#1B2028]">
            <Box
              className="w-9 h-9 text-slate-400 mx-auto mb-3"
              aria-hidden="true"
            />
            <h2 className="font-display text-base font-semibold text-white mb-1">
              Drop a GLB model to preview
            </h2>
            <p className="text-xs text-slate-400 mb-5">
              Inspect meshes, materials, and bounding dimensions before exporting
              to FBX, OBJ, or SketchUp.
            </p>
            <button
              type="button"
              onClick={onOpenFilePicker}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Browse GLB Files</span>
            </button>
          </div>
        </div>
      )}

      {/* Drag-over highlight */}
      {isDragOver && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-blue-950/75 border-2 border-dashed border-blue-400 m-3 rounded-xl pointer-events-none">
          <div className="text-center text-white">
            <Upload className="w-8 h-8 mx-auto mb-2 text-blue-300" />
            <p className="font-display text-base font-semibold">
              Drop .GLB or .GLTF file to add
            </p>
          </div>
        </div>
      )}

      {/* WebGL Context Lost Fallback */}
      {contextLost && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#161A20] text-slate-200 p-6 text-center">
          <div>
            <p className="font-display text-base font-semibold mb-1">
              3D Viewport Paused
            </p>
            <p className="text-xs text-slate-400">
              WebGL context was interrupted. Conversion still works normally.
            </p>
          </div>
        </div>
      )}

      {/* Collapsible Bottom Control Dock (Zero backdrop-filter over WebGL) */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center max-w-[94vw]">
        <button
          type="button"
          onClick={() => setDockCollapsed((v) => !v)}
          title="Toggle viewport controls (H)"
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-t-lg bg-[#1F252E] border border-b-0 border-slate-700/80 text-[11px] font-medium text-slate-300 hover:text-white transition-colors cursor-pointer"
        >
          {dockCollapsed ? (
            <>
              <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Show Controls</span>
            </>
          ) : (
            <>
              <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Hide Controls</span>
            </>
          )}
        </button>

        {!dockCollapsed && (
          <div className="flex flex-wrap items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-[#1F252E] border border-slate-700/80 shadow-lg">
            <button
              type="button"
              onClick={() => setWireframe((v) => !v)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                wireframe
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-300 hover:bg-slate-700/70 hover:text-white'
              }`}
            >
              Wireframe
            </button>

            <button
              type="button"
              onClick={() => setShowGrid((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                showGrid
                  ? 'bg-slate-700 text-white'
                  : 'text-slate-300 hover:bg-slate-700/70 hover:text-white'
              }`}
            >
              <Grid3x3 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Grid</span>
            </button>

            <button
              type="button"
              onClick={() => setAutoRotate((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                autoRotate
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-300 hover:bg-slate-700/70 hover:text-white'
              }`}
            >
              <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Auto-Orbit</span>
            </button>

            <span
              aria-hidden="true"
              className="h-4 w-px bg-slate-700 mx-1 hidden sm:block"
            />

            <button
              type="button"
              onClick={() => sceneStateRef.current?.frameCameraToObject('iso')}
              className="px-2.5 py-1.5 rounded-md text-xs font-medium text-slate-300 hover:bg-slate-700/70 hover:text-white whitespace-nowrap shrink-0 transition-colors cursor-pointer"
            >
              Iso
            </button>
            <button
              type="button"
              onClick={() => sceneStateRef.current?.frameCameraToObject('front')}
              className="px-2.5 py-1.5 rounded-md text-xs font-medium text-slate-300 hover:bg-slate-700/70 hover:text-white whitespace-nowrap shrink-0 transition-colors cursor-pointer"
            >
              Front
            </button>
            <button
              type="button"
              onClick={() => sceneStateRef.current?.frameCameraToObject('top')}
              className="px-2.5 py-1.5 rounded-md text-xs font-medium text-slate-300 hover:bg-slate-700/70 hover:text-white whitespace-nowrap shrink-0 transition-colors cursor-pointer"
            >
              Top
            </button>
            <button
              type="button"
              onClick={() => sceneStateRef.current?.frameCameraToObject('iso')}
              title="Reset camera view"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium text-slate-300 hover:bg-slate-700/70 hover:text-white whitespace-nowrap shrink-0 transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Reset</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
