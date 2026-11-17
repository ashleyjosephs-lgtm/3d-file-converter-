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
  diffuseTextureData?: Uint8Array;
  normalTextureName?: string;
  normalTextureData?: Uint8Array;
  emissiveTextureName?: string;
  emissiveTextureData?: Uint8Array;
  specularTextureName?: string;
  specularTextureData?: Uint8Array;
  alphaTextureName?: string;
  alphaTextureData?: Uint8Array;
  wrapU: 0 | 1;
  wrapV: 0 | 1;
}

export interface ExtractedMeshData {
  name: string;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  uvs2?: Float32Array;
  colors?: Float32Array;
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
  const rawFallback =
    texture.userData?.rawBytes instanceof Uint8Array
      ? (texture.userData.rawBytes as Uint8Array)
      : null;

  // If the embedded GLB texture is already a standard PNG, preserve its exact lossless bytes
  // without re-encoding through a 2D canvas (avoids alpha premultiplication / normal-map color shift).
  if (
    rawFallback &&
    rawFallback.length > 8 &&
    rawFallback[0] === 0x89 &&
    rawFallback[1] === 0x50 &&
    rawFallback[2] === 0x4e &&
    rawFallback[3] === 0x47
  ) {
    return rawFallback;
  }

  const sourceData =
    (texture.source && (texture.source.data as unknown)) ||
    (texture.image as unknown);

  const img = sourceData as
    | HTMLImageElement
    | HTMLCanvasElement
    | ImageBitmap
    | OffscreenCanvas
    | { width: number; height: number; data?: Uint8Array | Uint8ClampedArray }
    | undefined;

  if (!img || !img.width || !img.height) {
    return rawFallback;
  }

  if (typeof document === 'undefined') {
    return rawFallback;
  }

  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return rawFallback;

  if (
    'data' in img &&
    (img.data instanceof Uint8Array || img.data instanceof Uint8ClampedArray)
  ) {
    const clamped =
      img.data instanceof Uint8ClampedArray
        ? new Uint8ClampedArray(
            img.data.buffer.slice(
              img.data.byteOffset,
              img.data.byteOffset + img.data.byteLength
            ) as ArrayBuffer
          )
        : new Uint8ClampedArray(img.data);
    const imgData = new ImageData(clamped, img.width, img.height);
    ctx.putImageData(imgData, 0, 0);
  } else {
    ctx.drawImage(
      img as HTMLImageElement | HTMLCanvasElement | ImageBitmap,
      0,
      0,
      img.width,
      img.height
    );
  }

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/png')
  );
  if (!blob) return rawFallback;
  const buf = await blob.arrayBuffer();
  return new Uint8Array(buf);
}

function generateBoxProjectedUvs(
  localPosAttr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  localNormAttr:
    | THREE.BufferAttribute
    | THREE.InterleavedBufferAttribute
    | undefined
): Float32Array {
  const count = localPosAttr.count;
  const uvs = new Float32Array(count * 2);
  if (count === 0) return uvs;

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (let i = 0; i < count; i++) {
    const x = localPosAttr.getX(i);
    const y = localPosAttr.getY(i);
    const z = localPosAttr.getZ(i);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }

  const spanX = Math.max(1e-5, maxX - minX);
  const spanY = Math.max(1e-5, maxY - minY);
  const spanZ = Math.max(1e-5, maxZ - minZ);

  for (let i = 0; i < count; i++) {
    const nx = localNormAttr ? Math.abs(localNormAttr.getX(i)) : 0;
    const ny = localNormAttr ? Math.abs(localNormAttr.getY(i)) : 1;
    const nz = localNormAttr ? Math.abs(localNormAttr.getZ(i)) : 0;

    const uX = (localPosAttr.getX(i) - minX) / spanX;
    const uY = (localPosAttr.getY(i) - minY) / spanY;
    const uZ = (localPosAttr.getZ(i) - minZ) / spanZ;

    if (nx >= ny && nx >= nz) {
      uvs[i * 2] = uZ;
      uvs[i * 2 + 1] = uY;
    } else if (ny >= nx && ny >= nz) {
      uvs[i * 2] = uX;
      uvs[i * 2 + 1] = uZ;
    } else {
      uvs[i * 2] = uX;
      uvs[i * 2 + 1] = uY;
    }
  }

  return uvs;
}

function extractUvBufferForMaterial(
  geo: THREE.BufferGeometry,
  uvAttr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  primaryTex: THREE.Texture | undefined
): Float32Array {
  const count = uvAttr.count;
  const uvs = new Float32Array(count * 2);
  const tempUv = new THREE.Vector2();

  let hasUvTransform = false;
  if (primaryTex) {
    if (primaryTex.matrixAutoUpdate) {
      primaryTex.updateMatrix();
    }
    const el = primaryTex.matrix.elements;
    hasUvTransform =
      Math.abs(el[0] - 1) > 1e-6 ||
      Math.abs(el[1]) > 1e-6 ||
      Math.abs(el[3]) > 1e-6 ||
      Math.abs(el[4] - 1) > 1e-6 ||
      Math.abs(el[6]) > 1e-6 ||
      Math.abs(el[7]) > 1e-6;
  }

  // glTF 2.0 defines UV origin (0,0) at the top-left of the image (texture.flipY === false).
  // 3ds Max / FBX, Wavefront OBJ, and COLLADA define UV origin (0,0) at the bottom-left.
  // Flipping V (1.0 - v) after applying any glTF KHR_texture_transform aligns UV islands with the PNG texture.
  const shouldFlipV = primaryTex ? primaryTex.flipY === false : true;

  for (let i = 0; i < count; i++) {
    tempUv.set(uvAttr.getX(i), uvAttr.getY(i));
    if (hasUvTransform && primaryTex) {
      tempUv.applyMatrix3(primaryTex.matrix);
    }
    uvs[i * 2] = Number.isFinite(tempUv.x) ? tempUv.x : 0;
    const v = Number.isFinite(tempUv.y) ? tempUv.y : 0;
    uvs[i * 2 + 1] = shouldFlipV ? 1.0 - v : v;
  }

  return uvs;
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
    // Rotate +90 deg around X so +Y becomes +Z (standard Z-up CAD/3ds Max/SketchUp/Blender)
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
  const textureUuidToAsset = new Map<
    string,
    { filename: string; data: Uint8Array }
  >();
  const usedNames = new Set<string>();
  const usedTextureFilenames = new Set<string>();

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

  const ensureUniqueTextureFilename = (
    base: string,
    fallback: string
  ): string => {
    const cleanBase = sanitizeIdentifier(
      base.replace(/\.(png|jpg|jpeg|webp|bmp|tga)$/i, ''),
      fallback
    );
    let candidate = `${cleanBase}.png`;
    let idx = 2;
    while (usedTextureFilenames.has(candidate.toLowerCase())) {
      candidate = `${cleanBase}_${idx}.png`;
      idx += 1;
    }
    usedTextureFilenames.add(candidate.toLowerCase());
    return candidate;
  };

  const extractTextureSlot = async (
    tex: THREE.Texture | null | undefined,
    matName: string,
    slotSuffix: string
  ): Promise<{ filename: string; data: Uint8Array } | undefined> => {
    if (!tex) return undefined;
    const cached = textureUuidToAsset.get(tex.uuid);
    if (cached) return cached;

    const pngBytes = await textureToPngBytes(tex);
    if (!pngBytes) return undefined;

    const rawLabel = tex.name || `${matName}_${slotSuffix}`;
    const texFilename = ensureUniqueTextureFilename(
      rawLabel,
      `texture_${textures.length + 1}_${slotSuffix}`
    );
    const asset = { filename: texFilename, data: pngBytes };
    textures.push(asset);
    textureUuidToAsset.set(tex.uuid, asset);
    return asset;
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
          wrapU: 0,
          wrapV: 0,
        });
      }
      return materialUuidToIndex.get('__default__')!;
    }

    if (materialUuidToIndex.has(mat.uuid)) {
      return materialUuidToIndex.get(mat.uuid)!;
    }

    const std = mat as THREE.MeshStandardMaterial;
    const matIndex = materials.length;
    const matName = ensureUniqueName(mat.name, `Material_${matIndex + 1}`);

    // Convert Three.js working Linear-sRGB color back to sRGB for FBX/OBJ/DAE material definitions
    const srgbColor = std.color
      ? std.color.clone().convertLinearToSRGB()
      : new THREE.Color(0.8, 0.8, 0.8);
    const srgbEmissive = std.emissive
      ? std.emissive.clone().convertLinearToSRGB()
      : new THREE.Color(0, 0, 0);

    const diffuseAsset = await extractTextureSlot(std.map, matName, 'BaseColor');
    const normalAsset = await extractTextureSlot(
      std.normalMap,
      matName,
      'Normal'
    );
    const emissiveAsset = await extractTextureSlot(
      std.emissiveMap,
      matName,
      'Emissive'
    );
    const specularAsset = await extractTextureSlot(
      std.roughnessMap || std.metalnessMap,
      matName,
      'Roughness'
    );
    const alphaAsset = await extractTextureSlot(
      std.alphaMap,
      matName,
      'Opacity'
    );

    // Prevent zeroed baseColorFactor from multiplying a valid diffuse texture to black in 3ds Max
    let r = Math.min(1, Math.max(0, srgbColor.r));
    let g = Math.min(1, Math.max(0, srgbColor.g));
    let b = Math.min(1, Math.max(0, srgbColor.b));
    if (diffuseAsset && r < 0.02 && g < 0.02 && b < 0.02) {
      r = 1;
      g = 1;
      b = 1;
    }

    let er = Math.min(1, Math.max(0, srgbEmissive.r));
    let eg = Math.min(1, Math.max(0, srgbEmissive.g));
    let eb = Math.min(1, Math.max(0, srgbEmissive.b));
    if (emissiveAsset && er < 0.02 && eg < 0.02 && eb < 0.02) {
      er = 1;
      eg = 1;
      eb = 1;
    }

    const primaryTex =
      std.map ||
      std.normalMap ||
      std.emissiveMap ||
      std.roughnessMap ||
      std.metalnessMap;
    const wrapU: 0 | 1 =
      primaryTex && primaryTex.wrapS === THREE.ClampToEdgeWrapping ? 1 : 0;
    const wrapV: 0 | 1 =
      primaryTex && primaryTex.wrapT === THREE.ClampToEdgeWrapping ? 1 : 0;

    materials.push({
      id: `mat_${matIndex}`,
      name: matName,
      color: [r, g, b],
      emissive: [er, eg, eb],
      opacity: typeof std.opacity === 'number' ? std.opacity : 1,
      roughness: typeof std.roughness === 'number' ? std.roughness : 0.5,
      metalness: typeof std.metalness === 'number' ? std.metalness : 0.0,
      diffuseTextureName: diffuseAsset?.filename,
      diffuseTextureData: diffuseAsset?.data,
      normalTextureName: normalAsset?.filename,
      normalTextureData: normalAsset?.data,
      emissiveTextureName: emissiveAsset?.filename,
      emissiveTextureData: emissiveAsset?.data,
      specularTextureName: specularAsset?.filename,
      specularTextureData: specularAsset?.data,
      alphaTextureName: alphaAsset?.filename,
      alphaTextureData: alphaAsset?.data,
      wrapU,
      wrapV,
    });
    materialUuidToIndex.set(mat.uuid, matIndex);
    return matIndex;
  };

  const meshes: ExtractedMeshData[] = [];
  const tempVec = new THREE.Vector3();
  const tempNorm = new THREE.Vector3();
  const tempColor = new THREE.Color();
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

    // Extract optional vertex colors (COLOR_0) converted to sRGB
    const colorAttr = geo.getAttribute('color');
    let colors: Float32Array | undefined;
    if (colorAttr && colorAttr.count === clonedPos.count) {
      colors = new Float32Array(clonedPos.count * 4);
      for (let i = 0; i < clonedPos.count; i++) {
        tempColor
          .setRGB(colorAttr.getX(i), colorAttr.getY(i), colorAttr.getZ(i))
          .convertLinearToSRGB();
        const alpha =
          colorAttr.itemSize >= 4 ? colorAttr.getW(i) : 1.0;
        colors[i * 4] = Math.min(1, Math.max(0, tempColor.r));
        colors[i * 4 + 1] = Math.min(1, Math.max(0, tempColor.g));
        colors[i * 4 + 2] = Math.min(1, Math.max(0, tempColor.b));
        colors[i * 4 + 3] = Math.min(1, Math.max(0, alpha));
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

      const stdMat = mat as THREE.MeshStandardMaterial | undefined;
      const primaryTex =
        stdMat?.map ||
        stdMat?.normalMap ||
        stdMat?.emissiveMap ||
        stdMat?.roughnessMap ||
        stdMat?.metalnessMap ||
        stdMat?.aoMap ||
        undefined;

      const requestedUvChannel =
        primaryTex && typeof primaryTex.channel === 'number' && primaryTex.channel > 0
          ? `uv${primaryTex.channel}`
          : 'uv';

      const primaryUvAttr =
        geo.getAttribute(requestedUvChannel) ||
        geo.getAttribute('uv') ||
        geo.getAttribute('uv1');

      const uvs = primaryUvAttr
        ? extractUvBufferForMaterial(geo, primaryUvAttr, primaryTex)
        : generateBoxProjectedUvs(clonedPos, normAttr);

      const secondaryUvAttr =
        requestedUvChannel === 'uv' ? geo.getAttribute('uv1') : undefined;
      const uvs2 = secondaryUvAttr
        ? extractUvBufferForMaterial(geo, secondaryUvAttr, undefined)
        : undefined;

      const flipWinding = combinedMatrix.determinant() < 0;
      const triIndices: number[] = [];
      if (geo.index) {
        const end = Math.min(grp.start + grp.count, geo.index.count);
        for (let k = grp.start; k + 2 < end; k += 3) {
          const i0 = geo.index.getX(k);
          const i1 = geo.index.getX(k + 1);
          const i2 = geo.index.getX(k + 2);
          if (flipWinding) {
            triIndices.push(i0, i2, i1);
          } else {
            triIndices.push(i0, i1, i2);
          }
        }
      } else {
        const end = Math.min(grp.start + grp.count, clonedPos.count);
        for (let k = grp.start; k + 2 < end; k += 3) {
          if (flipWinding) {
            triIndices.push(k, k + 2, k + 1);
          } else {
            triIndices.push(k, k + 1, k + 2);
          }
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
        uvs2,
        colors,
        indices: new Uint32Array(triIndices),
        materialIndex,
      });
    }

    geo.dispose();
  }

  return { meshes, materials, textures };
}
