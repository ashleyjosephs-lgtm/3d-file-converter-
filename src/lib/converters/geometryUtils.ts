import * as THREE from 'three';
import type { ScaleUnit, UpAxis } from '../../types/converter';

export interface ExtractedMaterial {
  id: string;
  name: string;
  color: [number, number, number];
  emissive: [number, number, number];
  opacity: number;
  roughness: number;
  metalness: number;
  diffuseTextureName?: string;
}

export interface ExtractedMeshData {
  name: string;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  materialIndex: number;
}

export interface ExtractedTexture {
  filename: string;
  data: Uint8Array;
}

export interface PreparedSceneData {
  meshes: ExtractedMeshData[];
  materials: ExtractedMaterial[];
  textures: ExtractedTexture[];
}

export function getScaleFactor(unit: ScaleUnit): number {
  switch (unit) {
    case 'meters':
      return 1.0;
    case 'centimeters':
      return 100.0;
    case 'millimeters':
      return 1000.0;
    case 'inches':
      return 39.3700787;
  }
}

export function sanitizeIdentifier(raw: string, fallback: string): string {
  const cleaned = (raw || fallback)
    .trim()
    .replace(/[^a-zA-Z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned.length > 0 ? cleaned : fallback;
}

async function textureToPngBytes(
  texture: THREE.Texture
): Promise<Uint8Array | null> {
  const img = texture.image as
    | HTMLImageElement
    | HTMLCanvasElement
    | ImageBitmap
    | { width: number; height: number; data?: Uint8Array }
    | undefined;

  if (!img || !img.width || !img.height) {
    return null;
  }

  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  if ('data' in img && img.data instanceof Uint8Array) {
    const imgData = new ImageData(
      new Uint8ClampedArray(img.data),
      img.width,
      img.height
    );
    ctx.putImageData(imgData, 0, 0);
  } else {
    ctx.drawImage(
      img as HTMLImageElement | HTMLCanvasElement | ImageBitmap,
      0,
      0
    );
  }

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/png')
  );
  if (!blob) return null;
  const buf = await blob.arrayBuffer();
  return new Uint8Array(buf);
}

export async function prepareSceneForExport(
  root: THREE.Object3D,
  scaleUnit: ScaleUnit,
  upAxis: UpAxis,
  includeMaterials: boolean
): Promise<PreparedSceneData> {
  root.updateMatrixWorld(true);

  const scale = getScaleFactor(scaleUnit);
  const axisMatrix = new THREE.Matrix4();
  if (upAxis === 'z-up') {
    // Rotate +90 deg around X so +Y becomes +Z (standard Z-up CAD/SketchUp/Blender)
    axisMatrix.makeRotationX(Math.PI / 2);
  }
  const scaleMatrix = new THREE.Matrix4().makeScale(scale, scale, scale);
  const rootTransform = new THREE.Matrix4().multiplyMatrices(
    scaleMatrix,
    axisMatrix
  );

  const materials: ExtractedMaterial[] = [];
  const materialUuidToIndex = new Map<string, number>();
  const textures: ExtractedTexture[] = [];
  const textureUuidToFilename = new Map<string, string>();
  const usedNames = new Set<string>();

  const ensureUniqueName = (base: string, fallback: string): string => {
    const clean = sanitizeIdentifier(base, fallback);
    if (!usedNames.has(clean)) {
      usedNames.add(clean);
      return clean;
    }
    let idx = 2;
    while (usedNames.has(`${clean}_${idx}`)) {
      idx += 1;
    }
    const unique = `${clean}_${idx}`;
    usedNames.add(unique);
    return unique;
  };

  const registerMaterial = async (
    mat: THREE.Material | undefined
  ): Promise<number> => {
    if (!includeMaterials || !mat) {
      if (!materialUuidToIndex.has('__default__')) {
        materialUuidToIndex.set('__default__', materials.length);
        materials.push({
          id: 'default_material',
          name: 'DefaultMaterial',
          color: [0.8, 0.82, 0.85],
          emissive: [0, 0, 0],
          opacity: 1,
          roughness: 0.5,
          metalness: 0.1,
        });
      }
      return materialUuidToIndex.get('__default__')!;
    }

    if (materialUuidToIndex.has(mat.uuid)) {
      return materialUuidToIndex.get(mat.uuid)!;
    }

    const std = mat as THREE.MeshStandardMaterial;
    const color = std.color
      ? [std.color.r, std.color.g, std.color.b]
      : [0.8, 0.8, 0.8];
    const emissive = std.emissive
      ? [std.emissive.r, std.emissive.g, std.emissive.b]
      : [0, 0, 0];

    let diffuseTextureName: string | undefined;
    if (std.map) {
      if (textureUuidToFilename.has(std.map.uuid)) {
        diffuseTextureName = textureUuidToFilename.get(std.map.uuid);
      } else {
        const pngBytes = await textureToPngBytes(std.map);
        if (pngBytes) {
          const texName = `${sanitizeIdentifier(
            std.map.name || mat.name,
            `texture_${textures.length + 1}`
          )}.png`;
          textures.push({ filename: texName, data: pngBytes });
          textureUuidToFilename.set(std.map.uuid, texName);
          diffuseTextureName = texName;
        }
      }
    }

    const matIndex = materials.length;
    const matName = ensureUniqueName(mat.name, `Material_${matIndex + 1}`);
    materials.push({
      id: `mat_${matIndex}`,
      name: matName,
      color: color as [number, number, number],
      emissive: emissive as [number, number, number],
      opacity: typeof std.opacity === 'number' ? std.opacity : 1,
      roughness: typeof std.roughness === 'number' ? std.roughness : 0.5,
      metalness: typeof std.metalness === 'number' ? std.metalness : 0.0,
      diffuseTextureName,
    });
    materialUuidToIndex.set(mat.uuid, matIndex);
    return matIndex;
  };

  const meshes: ExtractedMeshData[] = [];
  const tempVec = new THREE.Vector3();
  const tempNorm = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3();
  const meshNameSet = new Set<string>();

  const meshNodes: THREE.Mesh[] = [];
  root.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) {
      meshNodes.push(obj as THREE.Mesh);
    }
  });

  for (let mIdx = 0; mIdx < meshNodes.length; mIdx++) {
    const mesh = meshNodes[mIdx];
    const srcGeo = mesh.geometry;
    if (!srcGeo) continue;

    const posAttr = srcGeo.getAttribute('position');
    if (!posAttr || posAttr.count === 0) continue;

    const geo = srcGeo.clone();
    if (!geo.getAttribute('normal')) {
      geo.computeVertexNormals();
    }

    const combinedMatrix = new THREE.Matrix4().multiplyMatrices(
      rootTransform,
      mesh.matrixWorld
    );
    normalMatrix.getNormalMatrix(combinedMatrix);

    const clonedPos = geo.getAttribute('position');
    const positions = new Float32Array(clonedPos.count * 3);
    for (let i = 0; i < clonedPos.count; i++) {
      tempVec.fromBufferAttribute(clonedPos, i).applyMatrix4(combinedMatrix);
      positions[i * 3] = tempVec.x;
      positions[i * 3 + 1] = tempVec.y;
      positions[i * 3 + 2] = tempVec.z;
    }

    const normAttr = geo.getAttribute('normal');
    const normals = new Float32Array(clonedPos.count * 3);
    for (let i = 0; i < clonedPos.count; i++) {
      if (normAttr) {
        tempNorm
          .fromBufferAttribute(normAttr, i)
          .applyMatrix3(normalMatrix)
          .normalize();
      } else {
        tempNorm.set(0, 1, 0);
      }
      normals[i * 3] = tempNorm.x;
      normals[i * 3 + 1] = tempNorm.y;
      normals[i * 3 + 2] = tempNorm.z;
    }

    const uvAttr = geo.getAttribute('uv');
    const uvs = new Float32Array(clonedPos.count * 2);
    for (let i = 0; i < clonedPos.count; i++) {
      if (uvAttr) {
        uvs[i * 2] = uvAttr.getX(i);
        uvs[i * 2 + 1] = uvAttr.getY(i);
      } else {
        uvs[i * 2] = 0;
        uvs[i * 2 + 1] = 0;
      }
    }

    // Handle multi-material geometry groups if present
    const matArray = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];

    const groups =
      geo.groups && geo.groups.length > 0 && matArray.length > 1
        ? geo.groups
        : [
            {
              start: 0,
              count: geo.index ? geo.index.count : clonedPos.count,
              materialIndex: 0,
            },
          ];

    for (let gIdx = 0; gIdx < groups.length; gIdx++) {
      const grp = groups[gIdx];
      const mat = matArray[grp.materialIndex ?? 0] ?? matArray[0];
      const materialIndex = await registerMaterial(mat);

      const triIndices: number[] = [];
      if (geo.index) {
        const end = Math.min(grp.start + grp.count, geo.index.count);
        for (let k = grp.start; k + 2 < end; k += 3) {
          triIndices.push(
            geo.index.getX(k),
            geo.index.getX(k + 1),
            geo.index.getX(k + 2)
          );
        }
      } else {
        const end = Math.min(grp.start + grp.count, clonedPos.count);
        for (let k = grp.start; k + 2 < end; k += 3) {
          triIndices.push(k, k + 1, k + 2);
        }
      }

      if (triIndices.length === 0) continue;

      let rawName = sanitizeIdentifier(
        mesh.name || `Mesh_${mIdx + 1}`,
        `Mesh_${mIdx + 1}`
      );
      if (groups.length > 1) {
        rawName = `${rawName}_part${gIdx + 1}`;
      }
      let finalName = rawName;
      let suffix = 2;
      while (meshNameSet.has(finalName)) {
        finalName = `${rawName}_${suffix}`;
        suffix += 1;
      }
      meshNameSet.add(finalName);

      meshes.push({
        name: finalName,
        positions,
        normals,
        uvs,
        indices: new Uint32Array(triIndices),
        materialIndex,
      });
    }

    geo.dispose();
  }

  return { meshes, materials, textures };
}
