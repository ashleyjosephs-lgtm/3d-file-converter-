import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import type { ModelStats } from '../types/converter';

let sharedDracoLoader: DRACOLoader | null = null;

function getDracoLoader(): DRACOLoader {
  if (!sharedDracoLoader) {
    sharedDracoLoader = new DRACOLoader();
    sharedDracoLoader.setDecoderPath(
      'https://www.gstatic.com/draco/versioned/decoders/1.5.7/'
    );
  }
  return sharedDracoLoader;
}

export function extractModelStats(gltf: GLTF): ModelStats {
  const root = gltf.scene;
  root.updateMatrixWorld(true);

  let meshCount = 0;
  let vertexCount = 0;
  let triangleCount = 0;
  const materialIds = new Set<string>();
  const textureIds = new Set<string>();

  root.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) {
      const mesh = obj as THREE.Mesh;
      meshCount += 1;

      const geo = mesh.geometry;
      if (geo) {
        const pos = geo.getAttribute('position');
        if (pos) {
          vertexCount += pos.count;
        }
        if (geo.index) {
          triangleCount += Math.floor(geo.index.count / 3);
        } else if (pos) {
          triangleCount += Math.floor(pos.count / 3);
        }
      }

      const materials = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];

      for (const mat of materials) {
        if (!mat) continue;
        materialIds.add(mat.uuid);
        const std = mat as THREE.MeshStandardMaterial;
        const possibleTextures = [
          std.map,
          std.normalMap,
          std.roughnessMap,
          std.metalnessMap,
          std.aoMap,
          std.emissiveMap,
        ];
        for (const tex of possibleTextures) {
          if (tex && tex.uuid) {
            textureIds.add(tex.uuid);
          }
        }
      }
    }
  });

  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  if (!box.isEmpty()) {
    box.getSize(size);
  }

  const asset = gltf.asset as { generator?: string } | undefined;

  return {
    meshCount,
    vertexCount,
    triangleCount,
    materialCount: materialIds.size,
    textureCount: textureIds.size,
    animationCount: gltf.animations?.length ?? 0,
    dimensions: {
      x: Number(size.x.toFixed(3)),
      y: Number(size.y.toFixed(3)),
      z: Number(size.z.toFixed(3)),
    },
    generator: asset?.generator,
  };
}

export async function parseGlbBuffer(
  buffer: ArrayBuffer
): Promise<{ scene: THREE.Group; stats: ModelStats }> {
  const loader = new GLTFLoader();
  loader.setDRACOLoader(getDracoLoader());

  const gltf = await new Promise<GLTF>((resolve, reject) => {
    loader.parse(
      buffer,
      '',
      (parsed) => resolve(parsed),
      (err) =>
        reject(
          err instanceof Error
            ? err
            : new Error('Unable to parse GLB/GLTF binary file.')
        )
    );
  });

  const stats = extractModelStats(gltf);

  if (stats.meshCount === 0) {
    throw new Error('This GLB file contains no exportable 3D mesh geometry.');
  }

  return {
    scene: gltf.scene,
    stats,
  };
}

export function disposeObject3D(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) {
      const mesh = obj as THREE.Mesh;
      mesh.geometry?.dispose();
      const mats = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      for (const mat of mats) {
        if (!mat) continue;
        const std = mat as THREE.MeshStandardMaterial;
        std.map?.dispose();
        std.normalMap?.dispose();
        std.roughnessMap?.dispose();
        std.metalnessMap?.dispose();
        std.aoMap?.dispose();
        std.emissiveMap?.dispose();
        mat.dispose();
      }
    }
  });
}
