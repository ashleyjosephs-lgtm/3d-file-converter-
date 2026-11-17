import JSZip from 'jszip';
import * as THREE from 'three';
import type { ExportOptions, ScaleUnit } from '../../types/converter';
import {
  prepareSceneForExport,
  type ExtractedMeshData,
} from './geometryUtils';

type FbxProp =
  | { type: 'C'; value: boolean }
  | { type: 'Y'; value: number }
  | { type: 'I'; value: number }
  | { type: 'L'; value: number | bigint }
  | { type: 'F'; value: number }
  | { type: 'D'; value: number }
  | { type: 'S'; value: string }
  | { type: 'R'; value: Uint8Array }
  | { type: 'i'; value: Int32Array }
  | { type: 'd'; value: Float64Array }
  | { type: 'f'; value: Float32Array };

interface FbxNode {
  name: string;
  props?: FbxProp[];
  children?: FbxNode[];
  forceContainer?: boolean;
}

const FBX_VERSION = 7400;
const FBX_HEADER_MAGIC = 'Kaydara FBX Binary  \0';
// Autodesk FBX SDK validates an anti-tamper hash linking CreationTime + FileId -> FooterId.
// These exact matched constants (used by Blender io_scene_fbx & Assimp FBXExporter) are
// required so 3ds Max / Maya / MotionBuilder (libfbxsdk) accept the binary stream.
const FBX_CREATION_TIME = '1970-01-01 10:00:00:000';
const FBX_FILE_ID = new Uint8Array([
  0x28, 0xb3, 0x2a, 0xeb, 0xb6, 0x24, 0xcc, 0xc2,
  0xbf, 0xc8, 0xb0, 0x2a, 0xa9, 0x2b, 0xfc, 0xf1,
]);
const FBX_FOOTER_ID = new Uint8Array([
  0xfa, 0xbc, 0xab, 0x09, 0xd0, 0xc8, 0xd4, 0x66,
  0xb1, 0x76, 0xfb, 0x83, 0x1c, 0xf7, 0x26, 0x7e,
]);
const FBX_FOOTER_EXTENSION = new Uint8Array([
  0xf8, 0x5a, 0x8c, 0x6a, 0xde, 0xf5, 0xd9, 0x7e,
  0xec, 0xe9, 0x0c, 0xe3, 0x75, 0x8f, 0x29, 0x0b,
]);

const textEncoder = new TextEncoder();

class FbxBinaryWriter {
  private buf: Uint8Array;
  private dv: DataView;
  private offset = 0;

  constructor(initialCapacity = 65536) {
    this.buf = new Uint8Array(initialCapacity);
    this.dv = new DataView(this.buf.buffer);
  }

  private ensureCapacity(extraBytes: number): void {
    const needed = this.offset + extraBytes;
    if (needed <= this.buf.length) return;
    let nextSize = this.buf.length * 2;
    while (nextSize < needed) {
      nextSize *= 2;
    }
    const next = new Uint8Array(nextSize);
    next.set(this.buf.subarray(0, this.offset));
    this.buf = next;
    this.dv = new DataView(this.buf.buffer);
  }

  writeUint8(v: number): void {
    this.ensureCapacity(1);
    this.buf[this.offset++] = v & 0xff;
  }

  writeInt16(v: number): void {
    this.ensureCapacity(2);
    this.dv.setInt16(this.offset, v, true);
    this.offset += 2;
  }

  writeUint32(v: number): void {
    this.ensureCapacity(4);
    this.dv.setUint32(this.offset, v >>> 0, true);
    this.offset += 4;
  }

  writeInt32(v: number): void {
    this.ensureCapacity(4);
    this.dv.setInt32(this.offset, v | 0, true);
    this.offset += 4;
  }

  writeInt64(v: number | bigint): void {
    this.ensureCapacity(8);
    this.dv.setBigInt64(this.offset, BigInt(v), true);
    this.offset += 8;
  }

  writeFloat32(v: number): void {
    this.ensureCapacity(4);
    this.dv.setFloat32(this.offset, v, true);
    this.offset += 4;
  }

  writeFloat64(v: number): void {
    this.ensureCapacity(8);
    this.dv.setFloat64(this.offset, v, true);
    this.offset += 8;
  }

  writeBytes(bytes: Uint8Array): void {
    this.ensureCapacity(bytes.length);
    this.buf.set(bytes, this.offset);
    this.offset += bytes.length;
  }

  writeZeros(count: number): void {
    this.ensureCapacity(count);
    this.buf.fill(0, this.offset, this.offset + count);
    this.offset += count;
  }

  writeAscii(str: string): void {
    const bytes = textEncoder.encode(str);
    this.writeBytes(bytes);
  }

  patchUint32(pos: number, v: number): void {
    this.dv.setUint32(pos, v >>> 0, true);
  }

  getOffset(): number {
    return this.offset;
  }

  private writeProp(prop: FbxProp): void {
    this.writeUint8(prop.type.charCodeAt(0));
    switch (prop.type) {
      case 'C':
        this.writeUint8(prop.value ? 1 : 0);
        break;
      case 'Y':
        this.writeInt16(prop.value);
        break;
      case 'I':
        this.writeInt32(prop.value);
        break;
      case 'L':
        this.writeInt64(prop.value);
        break;
      case 'F':
        this.writeFloat32(prop.value);
        break;
      case 'D':
        this.writeFloat64(prop.value);
        break;
      case 'S': {
        const bytes = textEncoder.encode(prop.value);
        this.writeUint32(bytes.length);
        this.writeBytes(bytes);
        break;
      }
      case 'R':
        this.writeUint32(prop.value.length);
        this.writeBytes(prop.value);
        break;
      case 'i': {
        const arr = prop.value;
        this.writeUint32(arr.length);
        this.writeUint32(0); // uncompressed
        this.writeUint32(arr.length * 4);
        this.ensureCapacity(arr.length * 4);
        for (let k = 0; k < arr.length; k++) {
          this.dv.setInt32(this.offset, arr[k], true);
          this.offset += 4;
        }
        break;
      }
      case 'f': {
        const arr = prop.value;
        this.writeUint32(arr.length);
        this.writeUint32(0); // uncompressed
        this.writeUint32(arr.length * 4);
        this.ensureCapacity(arr.length * 4);
        for (let k = 0; k < arr.length; k++) {
          this.dv.setFloat32(this.offset, arr[k], true);
          this.offset += 4;
        }
        break;
      }
      case 'd': {
        const arr = prop.value;
        this.writeUint32(arr.length);
        this.writeUint32(0); // uncompressed
        this.writeUint32(arr.length * 8);
        this.ensureCapacity(arr.length * 8);
        for (let k = 0; k < arr.length; k++) {
          this.dv.setFloat64(this.offset, arr[k], true);
          this.offset += 8;
        }
        break;
      }
    }
  }

  writeNode(node: FbxNode): void {
    const nameBytes = textEncoder.encode(node.name);
    const props = node.props ?? [];
    const children = node.children ?? [];
    const hasChildren = children.length > 0 || Boolean(node.forceContainer);

    const headerPos = this.offset;
    // endOffset (4), numProperties (4), propertyListLen (4), nameLen (1)
    this.writeZeros(13);
    this.writeBytes(nameBytes);

    const propsStart = this.offset;
    for (const prop of props) {
      this.writeProp(prop);
    }
    const propsLen = this.offset - propsStart;

    if (hasChildren) {
      for (const child of children) {
        this.writeNode(child);
      }
      // 13-byte NULL sentinel closing container node
      this.writeZeros(13);
    }

    const endOffset = this.offset;
    this.patchUint32(headerPos, endOffset);
    this.patchUint32(headerPos + 4, props.length);
    this.patchUint32(headerPos + 8, propsLen);
    this.buf[headerPos + 12] = nameBytes.length & 0xff;
  }

  finish(): Uint8Array {
    return this.buf.slice(0, this.offset);
  }
}

function getFbxUnitScaleFactor(unit: ScaleUnit): number {
  switch (unit) {
    case 'meters':
      return 100.0;
    case 'centimeters':
      return 1.0;
    case 'millimeters':
      return 0.1;
    case 'inches':
      return 2.54;
  }
}

function safeNum(v: number, fallback = 0): number {
  return Number.isFinite(v) ? v : fallback;
}

const P = (...props: FbxProp[]): FbxNode => ({ name: 'P', props });

interface CompactedMeshArrays {
  vertices: Float64Array;
  polygonVertexIndex: Int32Array;
  edges: Int32Array;
  normals: Float64Array;
  uvs: Float64Array;
  uvIndices: Int32Array;
  uvs2?: Float64Array;
  colors?: Float64Array;
  smoothing: Int32Array;
  bboxMin: [number, number, number];
  bboxMax: [number, number, number];
}

function buildCompactMeshArrays(
  mesh: ExtractedMeshData
): CompactedMeshArrays | null {
  const srcVertCount = Math.floor(mesh.positions.length / 3);
  if (srcVertCount === 0 || mesh.indices.length < 3) {
    return null;
  }

  const hasUv2 = Boolean(mesh.uvs2 && mesh.uvs2.length >= srcVertCount * 2);
  const hasColors = Boolean(
    mesh.colors && mesh.colors.length >= srcVertCount * 4
  );

  // Remap only vertices referenced by valid non-degenerate triangles
  const srcToDst = new Int32Array(srcVertCount).fill(-1);
  const compactVertCoords: number[] = [];
  const compactUvCoords: number[] = [];
  const compactUv2Coords: number[] = [];
  const polyIndices: number[] = [];
  const normValues: number[] = [];
  const uvIndexValues: number[] = [];
  const colorValues: number[] = [];

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  let dstCount = 0;
  const mapVertex = (srcIdx: number): number => {
    const existing = srcToDst[srcIdx];
    if (existing >= 0) return existing;

    const px = safeNum(mesh.positions[srcIdx * 3]);
    const py = safeNum(mesh.positions[srcIdx * 3 + 1]);
    const pz = safeNum(mesh.positions[srcIdx * 3 + 2]);
    compactVertCoords.push(px, py, pz);

    if (px < minX) minX = px;
    if (py < minY) minY = py;
    if (pz < minZ) minZ = pz;
    if (px > maxX) maxX = px;
    if (py > maxY) maxY = py;
    if (pz > maxZ) maxZ = pz;

    const u = safeNum(mesh.uvs[srcIdx * 2]);
    const v = safeNum(mesh.uvs[srcIdx * 2 + 1]);
    compactUvCoords.push(u, v);

    if (hasUv2 && mesh.uvs2) {
      const u2 = safeNum(mesh.uvs2[srcIdx * 2]);
      const v2 = safeNum(mesh.uvs2[srcIdx * 2 + 1]);
      compactUv2Coords.push(u2, v2);
    }

    srcToDst[srcIdx] = dstCount;
    dstCount += 1;
    return dstCount - 1;
  };

  // Track unique undirected edges using first PolygonVertexIndex position
  const seenEdges = new Set<string>();
  const edgeIndices: number[] = [];

  for (let i = 0; i + 2 < mesh.indices.length; i += 3) {
    const sa = mesh.indices[i];
    const sb = mesh.indices[i + 1];
    const sc = mesh.indices[i + 2];

    if (
      sa >= srcVertCount ||
      sb >= srcVertCount ||
      sc >= srcVertCount ||
      sa === sb ||
      sb === sc ||
      sa === sc
    ) {
      continue;
    }

    const a = mapVertex(sa);
    const b = mapVertex(sb);
    const c = mapVertex(sc);

    const polyBase = polyIndices.length;
    polyIndices.push(a, b, -(c + 1));

    const triEdges: Array<[number, number, number]> = [
      [a, b, polyBase],
      [b, c, polyBase + 1],
      [c, a, polyBase + 2],
    ];
    for (const [e0, e1, polyPos] of triEdges) {
      const key = e0 < e1 ? `${e0}:${e1}` : `${e1}:${e0}`;
      if (!seenEdges.has(key)) {
        seenEdges.add(key);
        edgeIndices.push(polyPos);
      }
    }

    for (const [srcIdx, dstIdx] of [
      [sa, a],
      [sb, b],
      [sc, c],
    ] as const) {
      const nx = safeNum(mesh.normals[srcIdx * 3], 0);
      const ny = safeNum(mesh.normals[srcIdx * 3 + 1], 1);
      const nz = safeNum(mesh.normals[srcIdx * 3 + 2], 0);
      normValues.push(nx, ny, nz);
      uvIndexValues.push(dstIdx);

      if (hasColors && mesh.colors) {
        const cr = safeNum(mesh.colors[srcIdx * 4], 1);
        const cg = safeNum(mesh.colors[srcIdx * 4 + 1], 1);
        const cb = safeNum(mesh.colors[srcIdx * 4 + 2], 1);
        const ca = safeNum(mesh.colors[srcIdx * 4 + 3], 1);
        colorValues.push(cr, cg, cb, ca);
      }
    }
  }

  if (polyIndices.length === 0 || dstCount === 0) {
    return null;
  }

  const triCount = Math.floor(polyIndices.length / 3);
  const smoothing = new Int32Array(triCount).fill(1);

  return {
    vertices: new Float64Array(compactVertCoords),
    polygonVertexIndex: new Int32Array(polyIndices),
    edges: new Int32Array(edgeIndices),
    normals: new Float64Array(normValues),
    uvs: new Float64Array(compactUvCoords),
    uvIndices: new Int32Array(uvIndexValues),
    uvs2: hasUv2 ? new Float64Array(compactUv2Coords) : undefined,
    colors: hasColors ? new Float64Array(colorValues) : undefined,
    smoothing,
    bboxMin: [minX, minY, minZ],
    bboxMax: [maxX, maxY, maxZ],
  };
}

export async function convertToFbx(
  root: THREE.Object3D,
  baseName: string,
  options: ExportOptions
): Promise<{ blob: Blob; filename: string; includedFiles: string[] }> {
  const prepared = await prepareSceneForExport(
    root,
    options.scaleUnit,
    options.upAxis,
    options.includeMaterials
  );

  let nextId = 1000001;
  const allocId = () => nextId++;

  const isZUp = options.upAxis === 'z-up';
  const unitScale = getFbxUnitScaleFactor(options.scaleUnit);

  const meshEntries: Array<{
    mesh: ExtractedMeshData;
    arrays: CompactedMeshArrays;
    geometryId: number;
    modelId: number;
  }> = [];

  for (const mesh of prepared.meshes) {
    const arrays = buildCompactMeshArrays(mesh);
    if (!arrays) continue;
    meshEntries.push({
      mesh,
      arrays,
      geometryId: allocId(),
      modelId: allocId(),
    });
  }

  if (meshEntries.length === 0) {
    throw new Error(
      'No valid non-degenerate 3D triangle geometry found to export to FBX.'
    );
  }

  const materialEntries = prepared.materials.map((mat) => ({
    mat,
    materialId: allocId(),
  }));

  interface FbxTextureBinding {
    materialId: number;
    property: string;
  }

  interface FbxTextureEntry {
    textureId: number;
    videoId: number;
    name: string;
    filename: string;
    relPath: string;
    pngData?: Uint8Array;
    wrapU: 0 | 1;
    wrapV: 0 | 1;
    isNormalMap: boolean;
    bindings: FbxTextureBinding[];
  }

  const textureEntries: FbxTextureEntry[] = [];

  if (options.includeMaterials) {
    const texByKey = new Map<string, FbxTextureEntry>();

    const registerTexBinding = (
      texFilename: string | undefined,
      texData: Uint8Array | undefined,
      materialId: number,
      property: string,
      wrapU: 0 | 1,
      wrapV: 0 | 1,
      isNormalMap: boolean
    ) => {
      if (!texFilename) return;
      const key = `${texFilename}::${isNormalMap ? 'normal' : 'std'}`;
      let entry = texByKey.get(key);
      if (!entry) {
        entry = {
          textureId: allocId(),
          videoId: allocId(),
          name: texFilename.replace(/\.png$/i, ''),
          filename: texFilename,
          relPath: options.packageAsZip
            ? `textures/${texFilename}`
            : texFilename,
          pngData: texData,
          wrapU,
          wrapV,
          isNormalMap,
          bindings: [],
        };
        texByKey.set(key, entry);
        textureEntries.push(entry);
      }
      entry.bindings.push({ materialId, property });
    };

    for (const mEntry of materialEntries) {
      const { mat, materialId } = mEntry;
      registerTexBinding(
        mat.diffuseTextureName,
        mat.diffuseTextureData,
        materialId,
        'DiffuseColor',
        mat.wrapU,
        mat.wrapV,
        false
      );
      if (mat.normalTextureName) {
        registerTexBinding(
          mat.normalTextureName,
          mat.normalTextureData,
          materialId,
          'NormalMap',
          mat.wrapU,
          mat.wrapV,
          true
        );
        registerTexBinding(
          mat.normalTextureName,
          mat.normalTextureData,
          materialId,
          'Bump',
          mat.wrapU,
          mat.wrapV,
          true
        );
      }
      registerTexBinding(
        mat.emissiveTextureName,
        mat.emissiveTextureData,
        materialId,
        'EmissiveColor',
        mat.wrapU,
        mat.wrapV,
        false
      );
      registerTexBinding(
        mat.specularTextureName,
        mat.specularTextureData,
        materialId,
        'SpecularColor',
        mat.wrapU,
        mat.wrapV,
        false
      );
      registerTexBinding(
        mat.alphaTextureName,
        mat.alphaTextureData,
        materialId,
        'TransparentColor',
        mat.wrapU,
        mat.wrapV,
        false
      );
    }
  }

  const fbxDocUrl = `${baseName}.fbx`;

  const headerExtensionNode: FbxNode = {
    name: 'FBXHeaderExtension',
    children: [
      { name: 'FBXHeaderVersion', props: [{ type: 'I', value: 1003 }] },
      { name: 'FBXVersion', props: [{ type: 'I', value: FBX_VERSION }] },
      { name: 'EncryptionType', props: [{ type: 'I', value: 0 }] },
      {
        name: 'CreationTimeStamp',
        children: [
          { name: 'Version', props: [{ type: 'I', value: 1000 }] },
          { name: 'Year', props: [{ type: 'I', value: 1970 }] },
          { name: 'Month', props: [{ type: 'I', value: 1 }] },
          { name: 'Day', props: [{ type: 'I', value: 1 }] },
          { name: 'Hour', props: [{ type: 'I', value: 10 }] },
          { name: 'Minute', props: [{ type: 'I', value: 0 }] },
          { name: 'Second', props: [{ type: 'I', value: 0 }] },
          { name: 'Millisecond', props: [{ type: 'I', value: 0 }] },
        ],
      },
      { name: 'Creator', props: [{ type: 'S', value: 'MeshShift 3D Converter' }] },
      {
        name: 'SceneInfo',
        props: [
          { type: 'S', value: 'GlobalInfo\x00\x01SceneInfo' },
          { type: 'S', value: 'UserData' },
        ],
        children: [
          { name: 'Type', props: [{ type: 'S', value: 'UserData' }] },
          { name: 'Version', props: [{ type: 'I', value: 100 }] },
          {
            name: 'MetaData',
            children: [
              { name: 'Version', props: [{ type: 'I', value: 100 }] },
              { name: 'Title', props: [{ type: 'S', value: baseName }] },
              { name: 'Subject', props: [{ type: 'S', value: '' }] },
              { name: 'Author', props: [{ type: 'S', value: 'MeshShift' }] },
              { name: 'Keywords', props: [{ type: 'S', value: '' }] },
              { name: 'Revision', props: [{ type: 'S', value: '' }] },
              { name: 'Comment', props: [{ type: 'S', value: '' }] },
            ],
          },
          {
            name: 'Properties70',
            children: [
              P(
                { type: 'S', value: 'DocumentUrl' },
                { type: 'S', value: 'KString' },
                { type: 'S', value: 'Url' },
                { type: 'S', value: '' },
                { type: 'S', value: fbxDocUrl }
              ),
              P(
                { type: 'S', value: 'SrcDocumentUrl' },
                { type: 'S', value: 'KString' },
                { type: 'S', value: 'Url' },
                { type: 'S', value: '' },
                { type: 'S', value: fbxDocUrl }
              ),
              P(
                { type: 'S', value: 'Original' },
                { type: 'S', value: 'Compound' },
                { type: 'S', value: '' },
                { type: 'S', value: '' }
              ),
              P(
                { type: 'S', value: 'Original|ApplicationVendor' },
                { type: 'S', value: 'KString' },
                { type: 'S', value: '' },
                { type: 'S', value: '' },
                { type: 'S', value: 'MeshShift' }
              ),
              P(
                { type: 'S', value: 'Original|ApplicationName' },
                { type: 'S', value: 'KString' },
                { type: 'S', value: '' },
                { type: 'S', value: '' },
                { type: 'S', value: 'MeshShift 3D Converter' }
              ),
              P(
                { type: 'S', value: 'Original|ApplicationVersion' },
                { type: 'S', value: 'KString' },
                { type: 'S', value: '' },
                { type: 'S', value: '' },
                { type: 'S', value: '1.0' }
              ),
              P(
                { type: 'S', value: 'LastSaved' },
                { type: 'S', value: 'Compound' },
                { type: 'S', value: '' },
                { type: 'S', value: '' }
              ),
              P(
                { type: 'S', value: 'LastSaved|ApplicationVendor' },
                { type: 'S', value: 'KString' },
                { type: 'S', value: '' },
                { type: 'S', value: '' },
                { type: 'S', value: 'MeshShift' }
              ),
              P(
                { type: 'S', value: 'LastSaved|ApplicationName' },
                { type: 'S', value: 'KString' },
                { type: 'S', value: '' },
                { type: 'S', value: '' },
                { type: 'S', value: 'MeshShift 3D Converter' }
              ),
              P(
                { type: 'S', value: 'LastSaved|ApplicationVersion' },
                { type: 'S', value: 'KString' },
                { type: 'S', value: '' },
                { type: 'S', value: '' },
                { type: 'S', value: '1.0' }
              ),
            ],
          },
        ],
      },
    ],
  };

  const globalSettingsNode: FbxNode = {
    name: 'GlobalSettings',
    children: [
      { name: 'Version', props: [{ type: 'I', value: 1000 }] },
      {
        name: 'Properties70',
        children: [
          P(
            { type: 'S', value: 'UpAxis' },
            { type: 'S', value: 'int' },
            { type: 'S', value: 'Integer' },
            { type: 'S', value: '' },
            { type: 'I', value: isZUp ? 2 : 1 }
          ),
          P(
            { type: 'S', value: 'UpAxisSign' },
            { type: 'S', value: 'int' },
            { type: 'S', value: 'Integer' },
            { type: 'S', value: '' },
            { type: 'I', value: 1 }
          ),
          P(
            { type: 'S', value: 'FrontAxis' },
            { type: 'S', value: 'int' },
            { type: 'S', value: 'Integer' },
            { type: 'S', value: '' },
            { type: 'I', value: isZUp ? 1 : 2 }
          ),
          P(
            { type: 'S', value: 'FrontAxisSign' },
            { type: 'S', value: 'int' },
            { type: 'S', value: 'Integer' },
            { type: 'S', value: '' },
            { type: 'I', value: isZUp ? -1 : 1 }
          ),
          P(
            { type: 'S', value: 'CoordAxis' },
            { type: 'S', value: 'int' },
            { type: 'S', value: 'Integer' },
            { type: 'S', value: '' },
            { type: 'I', value: 0 }
          ),
          P(
            { type: 'S', value: 'CoordAxisSign' },
            { type: 'S', value: 'int' },
            { type: 'S', value: 'Integer' },
            { type: 'S', value: '' },
            { type: 'I', value: 1 }
          ),
          P(
            { type: 'S', value: 'OriginalUpAxis' },
            { type: 'S', value: 'int' },
            { type: 'S', value: 'Integer' },
            { type: 'S', value: '' },
            { type: 'I', value: isZUp ? 2 : 1 }
          ),
          P(
            { type: 'S', value: 'OriginalUpAxisSign' },
            { type: 'S', value: 'int' },
            { type: 'S', value: 'Integer' },
            { type: 'S', value: '' },
            { type: 'I', value: 1 }
          ),
          P(
            { type: 'S', value: 'UnitScaleFactor' },
            { type: 'S', value: 'double' },
            { type: 'S', value: 'Number' },
            { type: 'S', value: '' },
            { type: 'D', value: unitScale }
          ),
          P(
            { type: 'S', value: 'OriginalUnitScaleFactor' },
            { type: 'S', value: 'double' },
            { type: 'S', value: 'Number' },
            { type: 'S', value: '' },
            { type: 'D', value: unitScale }
          ),
          P(
            { type: 'S', value: 'AmbientColor' },
            { type: 'S', value: 'ColorRGB' },
            { type: 'S', value: 'Color' },
            { type: 'S', value: '' },
            { type: 'D', value: 0 },
            { type: 'D', value: 0 },
            { type: 'D', value: 0 }
          ),
          P(
            { type: 'S', value: 'DefaultCamera' },
            { type: 'S', value: 'KString' },
            { type: 'S', value: '' },
            { type: 'S', value: '' },
            { type: 'S', value: 'Producer Perspective' }
          ),
          P(
            { type: 'S', value: 'TimeMode' },
            { type: 'S', value: 'enum' },
            { type: 'S', value: '' },
            { type: 'S', value: '' },
            { type: 'I', value: 11 }
          ),
          P(
            { type: 'S', value: 'TimeSpanStart' },
            { type: 'S', value: 'KTime' },
            { type: 'S', value: 'Time' },
            { type: 'S', value: '' },
            { type: 'L', value: 0n }
          ),
          P(
            { type: 'S', value: 'TimeSpanStop' },
            { type: 'S', value: 'KTime' },
            { type: 'S', value: 'Time' },
            { type: 'S', value: '' },
            { type: 'L', value: 46186158000n }
          ),
          P(
            { type: 'S', value: 'CustomFrameRate' },
            { type: 'S', value: 'double' },
            { type: 'S', value: 'Number' },
            { type: 'S', value: '' },
            { type: 'D', value: -1 }
          ),
        ],
      },
    ],
  };

  const documentsNode: FbxNode = {
    name: 'Documents',
    children: [
      { name: 'Count', props: [{ type: 'I', value: 1 }] },
      {
        name: 'Document',
        props: [
          { type: 'L', value: 1000000 },
          { type: 'S', value: 'Scene' },
          { type: 'S', value: 'Scene' },
        ],
        children: [
          {
            name: 'Properties70',
            children: [
              P(
                { type: 'S', value: 'SourceObject' },
                { type: 'S', value: 'object' },
                { type: 'S', value: '' },
                { type: 'S', value: '' }
              ),
              P(
                { type: 'S', value: 'ActiveAnimStackName' },
                { type: 'S', value: 'KString' },
                { type: 'S', value: '' },
                { type: 'S', value: '' },
                { type: 'S', value: '' }
              ),
            ],
          },
          { name: 'RootNode', props: [{ type: 'L', value: 0 }] },
        ],
      },
    ],
  };

  const defCount =
    1 +
    meshEntries.length * 2 +
    materialEntries.length +
    textureEntries.length * 2;

  const definitionChildren: FbxNode[] = [
    { name: 'Version', props: [{ type: 'I', value: 100 }] },
    { name: 'Count', props: [{ type: 'I', value: defCount }] },
    {
      name: 'ObjectType',
      props: [{ type: 'S', value: 'GlobalSettings' }],
      children: [{ name: 'Count', props: [{ type: 'I', value: 1 }] }],
    },
    {
      name: 'ObjectType',
      props: [{ type: 'S', value: 'Geometry' }],
      children: [
        { name: 'Count', props: [{ type: 'I', value: meshEntries.length }] },
        {
          name: 'PropertyTemplate',
          props: [{ type: 'S', value: 'FbxMesh' }],
          children: [
            {
              name: 'Properties70',
              children: [
                P(
                  { type: 'S', value: 'Color' },
                  { type: 'S', value: 'ColorRGB' },
                  { type: 'S', value: 'Color' },
                  { type: 'S', value: '' },
                  { type: 'D', value: 0.8 },
                  { type: 'D', value: 0.8 },
                  { type: 'D', value: 0.8 }
                ),
                P(
                  { type: 'S', value: 'BBoxMin' },
                  { type: 'S', value: 'Vector3D' },
                  { type: 'S', value: 'Vector' },
                  { type: 'S', value: '' },
                  { type: 'D', value: 0 },
                  { type: 'D', value: 0 },
                  { type: 'D', value: 0 }
                ),
                P(
                  { type: 'S', value: 'BBoxMax' },
                  { type: 'S', value: 'Vector3D' },
                  { type: 'S', value: 'Vector' },
                  { type: 'S', value: '' },
                  { type: 'D', value: 0 },
                  { type: 'D', value: 0 },
                  { type: 'D', value: 0 }
                ),
                P(
                  { type: 'S', value: 'Primary Visibility' },
                  { type: 'S', value: 'bool' },
                  { type: 'S', value: '' },
                  { type: 'S', value: '' },
                  { type: 'I', value: 1 }
                ),
                P(
                  { type: 'S', value: 'Casts Shadows' },
                  { type: 'S', value: 'bool' },
                  { type: 'S', value: '' },
                  { type: 'S', value: '' },
                  { type: 'I', value: 1 }
                ),
                P(
                  { type: 'S', value: 'Receive Shadows' },
                  { type: 'S', value: 'bool' },
                  { type: 'S', value: '' },
                  { type: 'S', value: '' },
                  { type: 'I', value: 1 }
                ),
              ],
            },
          ],
        },
      ],
    },
    {
      name: 'ObjectType',
      props: [{ type: 'S', value: 'Model' }],
      children: [
        { name: 'Count', props: [{ type: 'I', value: meshEntries.length }] },
        {
          name: 'PropertyTemplate',
          props: [{ type: 'S', value: 'FbxNode' }],
          children: [
            {
              name: 'Properties70',
              children: [
                P(
                  { type: 'S', value: 'QuaternionInterpolate' },
                  { type: 'S', value: 'enum' },
                  { type: 'S', value: '' },
                  { type: 'S', value: '' },
                  { type: 'I', value: 0 }
                ),
                P(
                  { type: 'S', value: 'RotationOrder' },
                  { type: 'S', value: 'enum' },
                  { type: 'S', value: '' },
                  { type: 'S', value: '' },
                  { type: 'I', value: 0 }
                ),
                P(
                  { type: 'S', value: 'RotationActive' },
                  { type: 'S', value: 'bool' },
                  { type: 'S', value: '' },
                  { type: 'S', value: '' },
                  { type: 'I', value: 0 }
                ),
                P(
                  { type: 'S', value: 'InheritType' },
                  { type: 'S', value: 'enum' },
                  { type: 'S', value: '' },
                  { type: 'S', value: '' },
                  { type: 'I', value: 0 }
                ),
                P(
                  { type: 'S', value: 'ScalingMax' },
                  { type: 'S', value: 'Vector3D' },
                  { type: 'S', value: 'Vector' },
                  { type: 'S', value: '' },
                  { type: 'D', value: 0 },
                  { type: 'D', value: 0 },
                  { type: 'D', value: 0 }
                ),
                P(
                  { type: 'S', value: 'Show' },
                  { type: 'S', value: 'bool' },
                  { type: 'S', value: '' },
                  { type: 'S', value: '' },
                  { type: 'I', value: 1 }
                ),
                P(
                  { type: 'S', value: 'NegativePercentShapeSupport' },
                  { type: 'S', value: 'bool' },
                  { type: 'S', value: '' },
                  { type: 'S', value: '' },
                  { type: 'I', value: 1 }
                ),
                P(
                  { type: 'S', value: 'DefaultAttributeIndex' },
                  { type: 'S', value: 'int' },
                  { type: 'S', value: 'Integer' },
                  { type: 'S', value: '' },
                  { type: 'I', value: 0 }
                ),
                P(
                  { type: 'S', value: 'Freeze' },
                  { type: 'S', value: 'bool' },
                  { type: 'S', value: '' },
                  { type: 'S', value: '' },
                  { type: 'I', value: 0 }
                ),
                P(
                  { type: 'S', value: 'LODBox' },
                  { type: 'S', value: 'bool' },
                  { type: 'S', value: '' },
                  { type: 'S', value: '' },
                  { type: 'I', value: 0 }
                ),
                P(
                  { type: 'S', value: 'Lcl Translation' },
                  { type: 'S', value: 'Lcl Translation' },
                  { type: 'S', value: '' },
                  { type: 'S', value: 'A' },
                  { type: 'D', value: 0 },
                  { type: 'D', value: 0 },
                  { type: 'D', value: 0 }
                ),
                P(
                  { type: 'S', value: 'Lcl Rotation' },
                  { type: 'S', value: 'Lcl Rotation' },
                  { type: 'S', value: '' },
                  { type: 'S', value: 'A' },
                  { type: 'D', value: 0 },
                  { type: 'D', value: 0 },
                  { type: 'D', value: 0 }
                ),
                P(
                  { type: 'S', value: 'Lcl Scaling' },
                  { type: 'S', value: 'Lcl Scaling' },
                  { type: 'S', value: '' },
                  { type: 'S', value: 'A' },
                  { type: 'D', value: 1 },
                  { type: 'D', value: 1 },
                  { type: 'D', value: 1 }
                ),
                P(
                  { type: 'S', value: 'Visibility' },
                  { type: 'S', value: 'Visibility' },
                  { type: 'S', value: '' },
                  { type: 'S', value: 'A' },
                  { type: 'D', value: 1 }
                ),
                P(
                  { type: 'S', value: 'Visibility Inheritance' },
                  { type: 'S', value: 'Visibility Inheritance' },
                  { type: 'S', value: '' },
                  { type: 'S', value: '' },
                  { type: 'I', value: 1 }
                ),
              ],
            },
          ],
        },
      ],
    },
  ];

  if (materialEntries.length > 0) {
    definitionChildren.push({
      name: 'ObjectType',
      props: [{ type: 'S', value: 'Material' }],
      children: [
        { name: 'Count', props: [{ type: 'I', value: materialEntries.length }] },
        {
          name: 'PropertyTemplate',
          props: [{ type: 'S', value: 'FbxSurfacePhong' }],
          children: [
            {
              name: 'Properties70',
              children: [
                P(
                  { type: 'S', value: 'ShadingModel' },
                  { type: 'S', value: 'KString' },
                  { type: 'S', value: '' },
                  { type: 'S', value: '' },
                  { type: 'S', value: 'Phong' }
                ),
                P(
                  { type: 'S', value: 'MultiLayer' },
                  { type: 'S', value: 'bool' },
                  { type: 'S', value: '' },
                  { type: 'S', value: '' },
                  { type: 'I', value: 0 }
                ),
                P(
                  { type: 'S', value: 'EmissiveColor' },
                  { type: 'S', value: 'Color' },
                  { type: 'S', value: '' },
                  { type: 'S', value: 'A' },
                  { type: 'D', value: 0 },
                  { type: 'D', value: 0 },
                  { type: 'D', value: 0 }
                ),
                P(
                  { type: 'S', value: 'EmissiveFactor' },
                  { type: 'S', value: 'Number' },
                  { type: 'S', value: '' },
                  { type: 'S', value: 'A' },
                  { type: 'D', value: 1 }
                ),
                P(
                  { type: 'S', value: 'AmbientColor' },
                  { type: 'S', value: 'Color' },
                  { type: 'S', value: '' },
                  { type: 'S', value: 'A' },
                  { type: 'D', value: 0.2 },
                  { type: 'D', value: 0.2 },
                  { type: 'D', value: 0.2 }
                ),
                P(
                  { type: 'S', value: 'AmbientFactor' },
                  { type: 'S', value: 'Number' },
                  { type: 'S', value: '' },
                  { type: 'S', value: 'A' },
                  { type: 'D', value: 1 }
                ),
                P(
                  { type: 'S', value: 'DiffuseColor' },
                  { type: 'S', value: 'Color' },
                  { type: 'S', value: '' },
                  { type: 'S', value: 'A' },
                  { type: 'D', value: 0.8 },
                  { type: 'D', value: 0.8 },
                  { type: 'D', value: 0.8 }
                ),
                P(
                  { type: 'S', value: 'DiffuseFactor' },
                  { type: 'S', value: 'Number' },
                  { type: 'S', value: '' },
                  { type: 'S', value: 'A' },
                  { type: 'D', value: 1 }
                ),
                P(
                  { type: 'S', value: 'Bump' },
                  { type: 'S', value: 'Vector3D' },
                  { type: 'S', value: 'Vector' },
                  { type: 'S', value: '' },
                  { type: 'D', value: 0 },
                  { type: 'D', value: 0 },
                  { type: 'D', value: 0 }
                ),
                P(
                  { type: 'S', value: 'NormalMap' },
                  { type: 'S', value: 'Vector3D' },
                  { type: 'S', value: 'Vector' },
                  { type: 'S', value: '' },
                  { type: 'D', value: 0 },
                  { type: 'D', value: 0 },
                  { type: 'D', value: 0 }
                ),
                P(
                  { type: 'S', value: 'BumpFactor' },
                  { type: 'S', value: 'double' },
                  { type: 'S', value: 'Number' },
                  { type: 'S', value: '' },
                  { type: 'D', value: 1 }
                ),
                P(
                  { type: 'S', value: 'TransparentColor' },
                  { type: 'S', value: 'Color' },
                  { type: 'S', value: '' },
                  { type: 'S', value: 'A' },
                  { type: 'D', value: 0 },
                  { type: 'D', value: 0 },
                  { type: 'D', value: 0 }
                ),
                P(
                  { type: 'S', value: 'TransparencyFactor' },
                  { type: 'S', value: 'Number' },
                  { type: 'S', value: '' },
                  { type: 'S', value: 'A' },
                  { type: 'D', value: 0 }
                ),
                P(
                  { type: 'S', value: 'Opacity' },
                  { type: 'S', value: 'Number' },
                  { type: 'S', value: '' },
                  { type: 'S', value: 'A' },
                  { type: 'D', value: 1 }
                ),
                P(
                  { type: 'S', value: 'SpecularColor' },
                  { type: 'S', value: 'Color' },
                  { type: 'S', value: '' },
                  { type: 'S', value: 'A' },
                  { type: 'D', value: 0.2 },
                  { type: 'D', value: 0.2 },
                  { type: 'D', value: 0.2 }
                ),
                P(
                  { type: 'S', value: 'SpecularFactor' },
                  { type: 'S', value: 'Number' },
                  { type: 'S', value: '' },
                  { type: 'S', value: 'A' },
                  { type: 'D', value: 0.5 }
                ),
                P(
                  { type: 'S', value: 'Shininess' },
                  { type: 'S', value: 'Number' },
                  { type: 'S', value: '' },
                  { type: 'S', value: 'A' },
                  { type: 'D', value: 20 }
                ),
                P(
                  { type: 'S', value: 'ShininessExponent' },
                  { type: 'S', value: 'Number' },
                  { type: 'S', value: '' },
                  { type: 'S', value: 'A' },
                  { type: 'D', value: 20 }
                ),
                P(
                  { type: 'S', value: 'ReflectionColor' },
                  { type: 'S', value: 'Color' },
                  { type: 'S', value: '' },
                  { type: 'S', value: 'A' },
                  { type: 'D', value: 0 },
                  { type: 'D', value: 0 },
                  { type: 'D', value: 0 }
                ),
                P(
                  { type: 'S', value: 'ReflectionFactor' },
                  { type: 'S', value: 'Number' },
                  { type: 'S', value: '' },
                  { type: 'S', value: 'A' },
                  { type: 'D', value: 0 }
                ),
              ],
            },
          ],
        },
      ],
    });
  }

  if (textureEntries.length > 0) {
    definitionChildren.push({
      name: 'ObjectType',
      props: [{ type: 'S', value: 'Texture' }],
      children: [
        { name: 'Count', props: [{ type: 'I', value: textureEntries.length }] },
        {
          name: 'PropertyTemplate',
          props: [{ type: 'S', value: 'FbxFileTexture' }],
          children: [
            {
              name: 'Properties70',
              children: [
                P(
                  { type: 'S', value: 'TextureTypeUse' },
                  { type: 'S', value: 'enum' },
                  { type: 'S', value: '' },
                  { type: 'S', value: '' },
                  { type: 'I', value: 0 }
                ),
                P(
                  { type: 'S', value: 'Texture alpha' },
                  { type: 'S', value: 'Number' },
                  { type: 'S', value: '' },
                  { type: 'S', value: 'A' },
                  { type: 'D', value: 1 }
                ),
                P(
                  { type: 'S', value: 'CurrentMappingType' },
                  { type: 'S', value: 'enum' },
                  { type: 'S', value: '' },
                  { type: 'S', value: '' },
                  { type: 'I', value: 0 }
                ),
                P(
                  { type: 'S', value: 'WrapModeU' },
                  { type: 'S', value: 'enum' },
                  { type: 'S', value: '' },
                  { type: 'S', value: '' },
                  { type: 'I', value: 0 }
                ),
                P(
                  { type: 'S', value: 'WrapModeV' },
                  { type: 'S', value: 'enum' },
                  { type: 'S', value: '' },
                  { type: 'S', value: '' },
                  { type: 'I', value: 0 }
                ),
                P(
                  { type: 'S', value: 'UVSwap' },
                  { type: 'S', value: 'bool' },
                  { type: 'S', value: '' },
                  { type: 'S', value: '' },
                  { type: 'I', value: 0 }
                ),
                P(
                  { type: 'S', value: 'PremultiplyAlpha' },
                  { type: 'S', value: 'bool' },
                  { type: 'S', value: '' },
                  { type: 'S', value: '' },
                  { type: 'I', value: 1 }
                ),
                P(
                  { type: 'S', value: 'Translation' },
                  { type: 'S', value: 'Vector' },
                  { type: 'S', value: '' },
                  { type: 'S', value: 'A' },
                  { type: 'D', value: 0 },
                  { type: 'D', value: 0 },
                  { type: 'D', value: 0 }
                ),
                P(
                  { type: 'S', value: 'Rotation' },
                  { type: 'S', value: 'Vector' },
                  { type: 'S', value: '' },
                  { type: 'S', value: 'A' },
                  { type: 'D', value: 0 },
                  { type: 'D', value: 0 },
                  { type: 'D', value: 0 }
                ),
                P(
                  { type: 'S', value: 'Scaling' },
                  { type: 'S', value: 'Vector' },
                  { type: 'S', value: '' },
                  { type: 'S', value: 'A' },
                  { type: 'D', value: 1 },
                  { type: 'D', value: 1 },
                  { type: 'D', value: 1 }
                ),
                P(
                  { type: 'S', value: 'TextureRotationPivot' },
                  { type: 'S', value: 'Vector3D' },
                  { type: 'S', value: 'Vector' },
                  { type: 'S', value: '' },
                  { type: 'D', value: 0 },
                  { type: 'D', value: 0 },
                  { type: 'D', value: 0 }
                ),
                P(
                  { type: 'S', value: 'TextureScalingPivot' },
                  { type: 'S', value: 'Vector3D' },
                  { type: 'S', value: 'Vector' },
                  { type: 'S', value: '' },
                  { type: 'D', value: 0 },
                  { type: 'D', value: 0 },
                  { type: 'D', value: 0 }
                ),
                P(
                  { type: 'S', value: 'CurrentTextureBlendMode' },
                  { type: 'S', value: 'enum' },
                  { type: 'S', value: '' },
                  { type: 'S', value: '' },
                  { type: 'I', value: 1 }
                ),
                P(
                  { type: 'S', value: 'UVSet' },
                  { type: 'S', value: 'KString' },
                  { type: 'S', value: '' },
                  { type: 'S', value: '' },
                  { type: 'S', value: 'UVMap' }
                ),
                P(
                  { type: 'S', value: 'UseMaterial' },
                  { type: 'S', value: 'bool' },
                  { type: 'S', value: '' },
                  { type: 'S', value: '' },
                  { type: 'I', value: 1 }
                ),
                P(
                  { type: 'S', value: 'UseMipMap' },
                  { type: 'S', value: 'bool' },
                  { type: 'S', value: '' },
                  { type: 'S', value: '' },
                  { type: 'I', value: 0 }
                ),
              ],
            },
          ],
        },
      ],
    });
    definitionChildren.push({
      name: 'ObjectType',
      props: [{ type: 'S', value: 'Video' }],
      children: [
        { name: 'Count', props: [{ type: 'I', value: textureEntries.length }] },
        {
          name: 'PropertyTemplate',
          props: [{ type: 'S', value: 'FbxVideo' }],
          children: [
            {
              name: 'Properties70',
              children: [
                P(
                  { type: 'S', value: 'ImageSequence' },
                  { type: 'S', value: 'bool' },
                  { type: 'S', value: '' },
                  { type: 'S', value: '' },
                  { type: 'I', value: 0 }
                ),
                P(
                  { type: 'S', value: 'Width' },
                  { type: 'S', value: 'int' },
                  { type: 'S', value: 'Integer' },
                  { type: 'S', value: '' },
                  { type: 'I', value: 0 }
                ),
                P(
                  { type: 'S', value: 'Height' },
                  { type: 'S', value: 'int' },
                  { type: 'S', value: 'Integer' },
                  { type: 'S', value: '' },
                  { type: 'I', value: 0 }
                ),
              ],
            },
          ],
        },
      ],
    });
  }

  const definitionsNode: FbxNode = {
    name: 'Definitions',
    children: definitionChildren,
  };

  const objectChildren: FbxNode[] = [];

  for (const entry of meshEntries) {
    const { mesh, arrays, geometryId, modelId } = entry;

    objectChildren.push({
      name: 'Model',
      props: [
        { type: 'L', value: modelId },
        { type: 'S', value: `${mesh.name}\x00\x01Model` },
        { type: 'S', value: 'Mesh' },
      ],
      children: [
        { name: 'Version', props: [{ type: 'I', value: 232 }] },
        {
          name: 'Properties70',
          children: [
            P(
              { type: 'S', value: 'RotationActive' },
              { type: 'S', value: 'bool' },
              { type: 'S', value: '' },
              { type: 'S', value: '' },
              { type: 'I', value: 1 }
            ),
            P(
              { type: 'S', value: 'InheritType' },
              { type: 'S', value: 'enum' },
              { type: 'S', value: '' },
              { type: 'S', value: '' },
              { type: 'I', value: 1 }
            ),
            P(
              { type: 'S', value: 'ScalingMax' },
              { type: 'S', value: 'Vector3D' },
              { type: 'S', value: 'Vector' },
              { type: 'S', value: '' },
              { type: 'D', value: 0 },
              { type: 'D', value: 0 },
              { type: 'D', value: 0 }
            ),
            P(
              { type: 'S', value: 'DefaultAttributeIndex' },
              { type: 'S', value: 'int' },
              { type: 'S', value: 'Integer' },
              { type: 'S', value: '' },
              { type: 'I', value: 0 }
            ),
            P(
              { type: 'S', value: 'Lcl Translation' },
              { type: 'S', value: 'Lcl Translation' },
              { type: 'S', value: '' },
              { type: 'S', value: 'A' },
              { type: 'D', value: 0 },
              { type: 'D', value: 0 },
              { type: 'D', value: 0 }
            ),
            P(
              { type: 'S', value: 'Lcl Rotation' },
              { type: 'S', value: 'Lcl Rotation' },
              { type: 'S', value: '' },
              { type: 'S', value: 'A' },
              { type: 'D', value: 0 },
              { type: 'D', value: 0 },
              { type: 'D', value: 0 }
            ),
            P(
              { type: 'S', value: 'Lcl Scaling' },
              { type: 'S', value: 'Lcl Scaling' },
              { type: 'S', value: '' },
              { type: 'S', value: 'A' },
              { type: 'D', value: 1 },
              { type: 'D', value: 1 },
              { type: 'D', value: 1 }
            ),
          ],
        },
        { name: 'MultiLayer', props: [{ type: 'I', value: 0 }] },
        { name: 'MultiTake', props: [{ type: 'I', value: 0 }] },
        { name: 'Shading', props: [{ type: 'C', value: true }] },
        { name: 'Culling', props: [{ type: 'S', value: 'CullingOff' }] },
      ],
    });

    const layer0Elements: FbxNode[] = [
      {
        name: 'LayerElement',
        children: [
          {
            name: 'Type',
            props: [{ type: 'S', value: 'LayerElementNormal' }],
          },
          { name: 'TypedIndex', props: [{ type: 'I', value: 0 }] },
        ],
      },
      {
        name: 'LayerElement',
        children: [
          {
            name: 'Type',
            props: [{ type: 'S', value: 'LayerElementSmoothing' }],
          },
          { name: 'TypedIndex', props: [{ type: 'I', value: 0 }] },
        ],
      },
      {
        name: 'LayerElement',
        children: [
          {
            name: 'Type',
            props: [{ type: 'S', value: 'LayerElementMaterial' }],
          },
          { name: 'TypedIndex', props: [{ type: 'I', value: 0 }] },
        ],
      },
      {
        name: 'LayerElement',
        children: [
          {
            name: 'Type',
            props: [{ type: 'S', value: 'LayerElementUV' }],
          },
          { name: 'TypedIndex', props: [{ type: 'I', value: 0 }] },
        ],
      },
    ];

    const geomChildren: FbxNode[] = [
      {
        name: 'Properties70',
        children: [
          P(
            { type: 'S', value: 'Color' },
            { type: 'S', value: 'ColorRGB' },
            { type: 'S', value: 'Color' },
            { type: 'S', value: '' },
            { type: 'D', value: 0.8 },
            { type: 'D', value: 0.8 },
            { type: 'D', value: 0.8 }
          ),
          P(
            { type: 'S', value: 'BBoxMin' },
            { type: 'S', value: 'Vector3D' },
            { type: 'S', value: 'Vector' },
            { type: 'S', value: '' },
            { type: 'D', value: arrays.bboxMin[0] },
            { type: 'D', value: arrays.bboxMin[1] },
            { type: 'D', value: arrays.bboxMin[2] }
          ),
          P(
            { type: 'S', value: 'BBoxMax' },
            { type: 'S', value: 'Vector3D' },
            { type: 'S', value: 'Vector' },
            { type: 'S', value: '' },
            { type: 'D', value: arrays.bboxMax[0] },
            { type: 'D', value: arrays.bboxMax[1] },
            { type: 'D', value: arrays.bboxMax[2] }
          ),
        ],
      },
      { name: 'Vertices', props: [{ type: 'd', value: arrays.vertices }] },
      {
        name: 'PolygonVertexIndex',
        props: [{ type: 'i', value: arrays.polygonVertexIndex }],
      },
      { name: 'Edges', props: [{ type: 'i', value: arrays.edges }] },
      { name: 'GeometryVersion', props: [{ type: 'I', value: 124 }] },
      {
        name: 'LayerElementNormal',
        props: [{ type: 'I', value: 0 }],
        children: [
          { name: 'Version', props: [{ type: 'I', value: 101 }] },
          { name: 'Name', props: [{ type: 'S', value: '' }] },
          {
            name: 'MappingInformationType',
            props: [{ type: 'S', value: 'ByPolygonVertex' }],
          },
          {
            name: 'ReferenceInformationType',
            props: [{ type: 'S', value: 'Direct' }],
          },
          { name: 'Normals', props: [{ type: 'd', value: arrays.normals }] },
        ],
      },
      {
        name: 'LayerElementSmoothing',
        props: [{ type: 'I', value: 0 }],
        children: [
          { name: 'Version', props: [{ type: 'I', value: 102 }] },
          { name: 'Name', props: [{ type: 'S', value: '' }] },
          {
            name: 'MappingInformationType',
            props: [{ type: 'S', value: 'ByPolygon' }],
          },
          {
            name: 'ReferenceInformationType',
            props: [{ type: 'S', value: 'Direct' }],
          },
          {
            name: 'Smoothing',
            props: [{ type: 'i', value: arrays.smoothing }],
          },
        ],
      },
    ];

    if (arrays.colors) {
      geomChildren.push({
        name: 'LayerElementColor',
        props: [{ type: 'I', value: 0 }],
        children: [
          { name: 'Version', props: [{ type: 'I', value: 101 }] },
          { name: 'Name', props: [{ type: 'S', value: 'Col' }] },
          {
            name: 'MappingInformationType',
            props: [{ type: 'S', value: 'ByPolygonVertex' }],
          },
          {
            name: 'ReferenceInformationType',
            props: [{ type: 'S', value: 'Direct' }],
          },
          { name: 'Colors', props: [{ type: 'd', value: arrays.colors }] },
        ],
      });
      layer0Elements.push({
        name: 'LayerElement',
        children: [
          {
            name: 'Type',
            props: [{ type: 'S', value: 'LayerElementColor' }],
          },
          { name: 'TypedIndex', props: [{ type: 'I', value: 0 }] },
        ],
      });
    }

    geomChildren.push({
      name: 'LayerElementUV',
      props: [{ type: 'I', value: 0 }],
      children: [
        { name: 'Version', props: [{ type: 'I', value: 101 }] },
        { name: 'Name', props: [{ type: 'S', value: 'UVMap' }] },
        {
          name: 'MappingInformationType',
          props: [{ type: 'S', value: 'ByPolygonVertex' }],
        },
        {
          name: 'ReferenceInformationType',
          props: [{ type: 'S', value: 'IndexToDirect' }],
        },
        { name: 'UV', props: [{ type: 'd', value: arrays.uvs }] },
        { name: 'UVIndex', props: [{ type: 'i', value: arrays.uvIndices }] },
      ],
    });

    if (arrays.uvs2) {
      geomChildren.push({
        name: 'LayerElementUV',
        props: [{ type: 'I', value: 1 }],
        children: [
          { name: 'Version', props: [{ type: 'I', value: 101 }] },
          { name: 'Name', props: [{ type: 'S', value: 'UVMap_2' }] },
          {
            name: 'MappingInformationType',
            props: [{ type: 'S', value: 'ByPolygonVertex' }],
          },
          {
            name: 'ReferenceInformationType',
            props: [{ type: 'S', value: 'IndexToDirect' }],
          },
          { name: 'UV', props: [{ type: 'd', value: arrays.uvs2 }] },
          { name: 'UVIndex', props: [{ type: 'i', value: arrays.uvIndices }] },
        ],
      });
    }

    geomChildren.push({
      name: 'LayerElementMaterial',
      props: [{ type: 'I', value: 0 }],
      children: [
        { name: 'Version', props: [{ type: 'I', value: 101 }] },
        { name: 'Name', props: [{ type: 'S', value: '' }] },
        {
          name: 'MappingInformationType',
          props: [{ type: 'S', value: 'AllSame' }],
        },
        {
          name: 'ReferenceInformationType',
          props: [{ type: 'S', value: 'IndexToDirect' }],
        },
        {
          name: 'Materials',
          props: [{ type: 'i', value: new Int32Array([0]) }],
        },
      ],
    });

    geomChildren.push({
      name: 'Layer',
      props: [{ type: 'I', value: 0 }],
      children: [
        { name: 'Version', props: [{ type: 'I', value: 100 }] },
        ...layer0Elements,
      ],
    });

    if (arrays.uvs2) {
      geomChildren.push({
        name: 'Layer',
        props: [{ type: 'I', value: 1 }],
        children: [
          { name: 'Version', props: [{ type: 'I', value: 100 }] },
          {
            name: 'LayerElement',
            children: [
              {
                name: 'Type',
                props: [{ type: 'S', value: 'LayerElementUV' }],
              },
              { name: 'TypedIndex', props: [{ type: 'I', value: 1 }] },
            ],
          },
        ],
      });
    }

    objectChildren.push({
      name: 'Geometry',
      props: [
        { type: 'L', value: geometryId },
        { type: 'S', value: `${mesh.name}\x00\x01Geometry` },
        { type: 'S', value: 'Mesh' },
      ],
      children: geomChildren,
    });
  }

  for (const mEntry of materialEntries) {
    const { mat, materialId } = mEntry;
    const spec = Math.max(0.05, 1 - mat.roughness) * 0.5;
    const shininess = Math.max(2, Math.round((1 - mat.roughness) * 96));
    const opacity = Math.min(1, Math.max(0, safeNum(mat.opacity, 1)));
    const cr = safeNum(mat.color[0], 0.8);
    const cg = safeNum(mat.color[1], 0.8);
    const cb = safeNum(mat.color[2], 0.8);
    const er = safeNum(mat.emissive[0], 0);
    const eg = safeNum(mat.emissive[1], 0);
    const eb = safeNum(mat.emissive[2], 0);

    objectChildren.push({
      name: 'Material',
      props: [
        { type: 'L', value: materialId },
        { type: 'S', value: `${mat.name}\x00\x01Material` },
        { type: 'S', value: '' },
      ],
      children: [
        { name: 'Version', props: [{ type: 'I', value: 102 }] },
        { name: 'ShadingModel', props: [{ type: 'S', value: 'Phong' }] },
        { name: 'MultiLayer', props: [{ type: 'I', value: 0 }] },
        {
          name: 'Properties70',
          children: [
            P(
              { type: 'S', value: 'ShadingModel' },
              { type: 'S', value: 'KString' },
              { type: 'S', value: '' },
              { type: 'S', value: '' },
              { type: 'S', value: 'Phong' }
            ),
            P(
              { type: 'S', value: 'MultiLayer' },
              { type: 'S', value: 'bool' },
              { type: 'S', value: '' },
              { type: 'S', value: '' },
              { type: 'I', value: 0 }
            ),
            P(
              { type: 'S', value: 'AmbientColor' },
              { type: 'S', value: 'Color' },
              { type: 'S', value: '' },
              { type: 'S', value: 'A' },
              { type: 'D', value: 0.2 },
              { type: 'D', value: 0.2 },
              { type: 'D', value: 0.2 }
            ),
            P(
              { type: 'S', value: 'Ambient' },
              { type: 'S', value: 'Vector3D' },
              { type: 'S', value: 'Vector' },
              { type: 'S', value: '' },
              { type: 'D', value: 0.2 },
              { type: 'D', value: 0.2 },
              { type: 'D', value: 0.2 }
            ),
            P(
              { type: 'S', value: 'AmbientFactor' },
              { type: 'S', value: 'Number' },
              { type: 'S', value: '' },
              { type: 'S', value: 'A' },
              { type: 'D', value: 1 }
            ),
            P(
              { type: 'S', value: 'DiffuseColor' },
              { type: 'S', value: 'Color' },
              { type: 'S', value: '' },
              { type: 'S', value: 'A' },
              { type: 'D', value: cr },
              { type: 'D', value: cg },
              { type: 'D', value: cb }
            ),
            P(
              { type: 'S', value: 'Diffuse' },
              { type: 'S', value: 'Vector3D' },
              { type: 'S', value: 'Vector' },
              { type: 'S', value: '' },
              { type: 'D', value: cr },
              { type: 'D', value: cg },
              { type: 'D', value: cb }
            ),
            P(
              { type: 'S', value: 'DiffuseFactor' },
              { type: 'S', value: 'Number' },
              { type: 'S', value: '' },
              { type: 'S', value: 'A' },
              { type: 'D', value: 1 }
            ),
            P(
              { type: 'S', value: 'SpecularColor' },
              { type: 'S', value: 'Color' },
              { type: 'S', value: '' },
              { type: 'S', value: 'A' },
              { type: 'D', value: spec },
              { type: 'D', value: spec },
              { type: 'D', value: spec }
            ),
            P(
              { type: 'S', value: 'Specular' },
              { type: 'S', value: 'Vector3D' },
              { type: 'S', value: 'Vector' },
              { type: 'S', value: '' },
              { type: 'D', value: spec },
              { type: 'D', value: spec },
              { type: 'D', value: spec }
            ),
            P(
              { type: 'S', value: 'SpecularFactor' },
              { type: 'S', value: 'Number' },
              { type: 'S', value: '' },
              { type: 'S', value: 'A' },
              { type: 'D', value: 0.5 }
            ),
            P(
              { type: 'S', value: 'EmissiveColor' },
              { type: 'S', value: 'Color' },
              { type: 'S', value: '' },
              { type: 'S', value: 'A' },
              { type: 'D', value: er },
              { type: 'D', value: eg },
              { type: 'D', value: eb }
            ),
            P(
              { type: 'S', value: 'Emissive' },
              { type: 'S', value: 'Vector3D' },
              { type: 'S', value: 'Vector' },
              { type: 'S', value: '' },
              { type: 'D', value: er },
              { type: 'D', value: eg },
              { type: 'D', value: eb }
            ),
            P(
              { type: 'S', value: 'EmissiveFactor' },
              { type: 'S', value: 'Number' },
              { type: 'S', value: '' },
              { type: 'S', value: 'A' },
              { type: 'D', value: 1 }
            ),
            P(
              { type: 'S', value: 'Shininess' },
              { type: 'S', value: 'Number' },
              { type: 'S', value: '' },
              { type: 'S', value: 'A' },
              { type: 'D', value: shininess }
            ),
            P(
              { type: 'S', value: 'ShininessExponent' },
              { type: 'S', value: 'Number' },
              { type: 'S', value: '' },
              { type: 'S', value: 'A' },
              { type: 'D', value: shininess }
            ),
            P(
              { type: 'S', value: 'TransparentColor' },
              { type: 'S', value: 'Color' },
              { type: 'S', value: '' },
              { type: 'S', value: 'A' },
              { type: 'D', value: 0 },
              { type: 'D', value: 0 },
              { type: 'D', value: 0 }
            ),
            P(
              { type: 'S', value: 'TransparencyFactor' },
              { type: 'S', value: 'Number' },
              { type: 'S', value: '' },
              { type: 'S', value: 'A' },
              { type: 'D', value: 1 - opacity }
            ),
            P(
              { type: 'S', value: 'Opacity' },
              { type: 'S', value: 'Number' },
              { type: 'S', value: '' },
              { type: 'S', value: 'A' },
              { type: 'D', value: opacity }
            ),
            P(
              { type: 'S', value: 'BumpFactor' },
              { type: 'S', value: 'double' },
              { type: 'S', value: 'Number' },
              { type: 'S', value: '' },
              { type: 'D', value: 1 }
            ),
          ],
        },
      ],
    });
  }

  for (const tEntry of textureEntries) {
    const videoChildren: FbxNode[] = [
      { name: 'Type', props: [{ type: 'S', value: 'Clip' }] },
      {
        name: 'Properties70',
        children: [
          P(
            { type: 'S', value: 'Path' },
            { type: 'S', value: 'KString' },
            { type: 'S', value: 'XRefUrl' },
            { type: 'S', value: '' },
            { type: 'S', value: tEntry.relPath }
          ),
        ],
      },
      { name: 'UseMipMap', props: [{ type: 'I', value: 0 }] },
      { name: 'FileName', props: [{ type: 'S', value: tEntry.relPath }] },
      { name: 'Filename', props: [{ type: 'S', value: tEntry.relPath }] },
      {
        name: 'RelativeFilename',
        props: [{ type: 'S', value: tEntry.relPath }],
      },
    ];

    if (tEntry.pngData && tEntry.pngData.byteLength > 0) {
      videoChildren.push({
        name: 'Content',
        props: [{ type: 'R', value: tEntry.pngData }],
      });
    }

    objectChildren.push({
      name: 'Video',
      props: [
        { type: 'L', value: tEntry.videoId },
        { type: 'S', value: `${tEntry.name}\x00\x01Video` },
        { type: 'S', value: 'Clip' },
      ],
      children: videoChildren,
    });

    objectChildren.push({
      name: 'Texture',
      props: [
        { type: 'L', value: tEntry.textureId },
        { type: 'S', value: `${tEntry.name}\x00\x01Texture` },
        { type: 'S', value: '' },
      ],
      children: [
        { name: 'Type', props: [{ type: 'S', value: 'TextureVideoClip' }] },
        { name: 'Version', props: [{ type: 'I', value: 202 }] },
        {
          name: 'TextureName',
          props: [{ type: 'S', value: `${tEntry.name}\x00\x01Texture` }],
        },
        {
          name: 'Properties70',
          children: [
            P(
              { type: 'S', value: 'TextureTypeUse' },
              { type: 'S', value: 'enum' },
              { type: 'S', value: '' },
              { type: 'S', value: '' },
              { type: 'I', value: tEntry.isNormalMap ? 1 : 0 }
            ),
            P(
              { type: 'S', value: 'Texture alpha' },
              { type: 'S', value: 'Number' },
              { type: 'S', value: '' },
              { type: 'S', value: 'A' },
              { type: 'D', value: 1 }
            ),
            P(
              { type: 'S', value: 'CurrentMappingType' },
              { type: 'S', value: 'enum' },
              { type: 'S', value: '' },
              { type: 'S', value: '' },
              { type: 'I', value: 0 }
            ),
            P(
              { type: 'S', value: 'WrapModeU' },
              { type: 'S', value: 'enum' },
              { type: 'S', value: '' },
              { type: 'S', value: '' },
              { type: 'I', value: tEntry.wrapU }
            ),
            P(
              { type: 'S', value: 'WrapModeV' },
              { type: 'S', value: 'enum' },
              { type: 'S', value: '' },
              { type: 'S', value: '' },
              { type: 'I', value: tEntry.wrapV }
            ),
            P(
              { type: 'S', value: 'UVSwap' },
              { type: 'S', value: 'bool' },
              { type: 'S', value: '' },
              { type: 'S', value: '' },
              { type: 'I', value: 0 }
            ),
            P(
              { type: 'S', value: 'PremultiplyAlpha' },
              { type: 'S', value: 'bool' },
              { type: 'S', value: '' },
              { type: 'S', value: '' },
              { type: 'I', value: 1 }
            ),
            P(
              { type: 'S', value: 'Translation' },
              { type: 'S', value: 'Vector' },
              { type: 'S', value: '' },
              { type: 'S', value: 'A' },
              { type: 'D', value: 0 },
              { type: 'D', value: 0 },
              { type: 'D', value: 0 }
            ),
            P(
              { type: 'S', value: 'Rotation' },
              { type: 'S', value: 'Vector' },
              { type: 'S', value: '' },
              { type: 'S', value: 'A' },
              { type: 'D', value: 0 },
              { type: 'D', value: 0 },
              { type: 'D', value: 0 }
            ),
            P(
              { type: 'S', value: 'Scaling' },
              { type: 'S', value: 'Vector' },
              { type: 'S', value: '' },
              { type: 'S', value: 'A' },
              { type: 'D', value: 1 },
              { type: 'D', value: 1 },
              { type: 'D', value: 1 }
            ),
            P(
              { type: 'S', value: 'TextureRotationPivot' },
              { type: 'S', value: 'Vector3D' },
              { type: 'S', value: 'Vector' },
              { type: 'S', value: '' },
              { type: 'D', value: 0 },
              { type: 'D', value: 0 },
              { type: 'D', value: 0 }
            ),
            P(
              { type: 'S', value: 'TextureScalingPivot' },
              { type: 'S', value: 'Vector3D' },
              { type: 'S', value: 'Vector' },
              { type: 'S', value: '' },
              { type: 'D', value: 0 },
              { type: 'D', value: 0 },
              { type: 'D', value: 0 }
            ),
            P(
              { type: 'S', value: 'CurrentTextureBlendMode' },
              { type: 'S', value: 'enum' },
              { type: 'S', value: '' },
              { type: 'S', value: '' },
              { type: 'I', value: 1 }
            ),
            P(
              { type: 'S', value: 'UVSet' },
              { type: 'S', value: 'KString' },
              { type: 'S', value: '' },
              { type: 'S', value: '' },
              { type: 'S', value: 'UVMap' }
            ),
            P(
              { type: 'S', value: 'UseMaterial' },
              { type: 'S', value: 'bool' },
              { type: 'S', value: '' },
              { type: 'S', value: '' },
              { type: 'I', value: 1 }
            ),
            P(
              { type: 'S', value: 'UseMipMap' },
              { type: 'S', value: 'bool' },
              { type: 'S', value: '' },
              { type: 'S', value: '' },
              { type: 'I', value: 0 }
            ),
            P(
              { type: 'S', value: 'AlphaSource' },
              { type: 'S', value: 'enum' },
              { type: 'S', value: '' },
              { type: 'S', value: '' },
              { type: 'I', value: 2 }
            ),
          ],
        },
        {
          name: 'Media',
          props: [{ type: 'S', value: `${tEntry.name}\x00\x01Video` }],
        },
        { name: 'FileName', props: [{ type: 'S', value: tEntry.relPath }] },
        {
          name: 'RelativeFilename',
          props: [{ type: 'S', value: tEntry.relPath }],
        },
        {
          name: 'ModelUVTranslation',
          props: [
            { type: 'D', value: 0 },
            { type: 'D', value: 0 },
          ],
        },
        {
          name: 'ModelUVScaling',
          props: [
            { type: 'D', value: 1 },
            { type: 'D', value: 1 },
          ],
        },
        { name: 'Texture_Alpha_Source', props: [{ type: 'S', value: 'None' }] },
        {
          name: 'Cropping',
          props: [
            { type: 'I', value: 0 },
            { type: 'I', value: 0 },
            { type: 'I', value: 0 },
            { type: 'I', value: 0 },
          ],
        },
      ],
    });
  }

  const objectsNode: FbxNode = {
    name: 'Objects',
    forceContainer: true,
    children: objectChildren,
  };

  const connectionChildren: FbxNode[] = [];
  for (const entry of meshEntries) {
    connectionChildren.push({
      name: 'C',
      props: [
        { type: 'S', value: 'OO' },
        { type: 'L', value: entry.modelId },
        { type: 'L', value: 0 },
      ],
    });
    connectionChildren.push({
      name: 'C',
      props: [
        { type: 'S', value: 'OO' },
        { type: 'L', value: entry.geometryId },
        { type: 'L', value: entry.modelId },
      ],
    });

    const matEntry = materialEntries[entry.mesh.materialIndex];
    if (matEntry) {
      connectionChildren.push({
        name: 'C',
        props: [
          { type: 'S', value: 'OO' },
          { type: 'L', value: matEntry.materialId },
          { type: 'L', value: entry.modelId },
        ],
      });
    }
  }

  for (const tEntry of textureEntries) {
    for (const binding of tEntry.bindings) {
      connectionChildren.push({
        name: 'C',
        props: [
          { type: 'S', value: 'OP' },
          { type: 'L', value: tEntry.textureId },
          { type: 'L', value: binding.materialId },
          { type: 'S', value: binding.property },
        ],
      });
    }
    connectionChildren.push({
      name: 'C',
      props: [
        { type: 'S', value: 'OO' },
        { type: 'L', value: tEntry.videoId },
        { type: 'L', value: tEntry.textureId },
      ],
    });
  }

  const connectionsNode: FbxNode = {
    name: 'Connections',
    forceContainer: true,
    children: connectionChildren,
  };

  const takesNode: FbxNode = {
    name: 'Takes',
    children: [{ name: 'Current', props: [{ type: 'S', value: '' }] }],
  };

  const writer = new FbxBinaryWriter();
  // 27-byte FBX Binary header
  writer.writeAscii(FBX_HEADER_MAGIC);
  writer.writeUint8(0x1a);
  writer.writeUint8(0x00);
  writer.writeUint32(FBX_VERSION);

  writer.writeNode(headerExtensionNode);
  writer.writeNode({
    name: 'FileId',
    props: [{ type: 'R', value: FBX_FILE_ID }],
  });
  writer.writeNode({
    name: 'CreationTime',
    props: [{ type: 'S', value: FBX_CREATION_TIME }],
  });
  writer.writeNode({
    name: 'Creator',
    props: [{ type: 'S', value: 'MeshShift 3D Converter' }],
  });
  writer.writeNode(globalSettingsNode);
  writer.writeNode(documentsNode);
  writer.writeNode({ name: 'References', forceContainer: true });
  writer.writeNode(definitionsNode);
  writer.writeNode(objectsNode);
  writer.writeNode(connectionsNode);
  writer.writeNode(takesNode);

  // Top-level NULL sentinel closing root node stream
  writer.writeZeros(13);

  // FBX 7.4 Binary footer (16-byte aligned)
  writer.writeBytes(FBX_FOOTER_ID);
  const afterFootId = writer.getOffset();
  const rem = afterFootId % 16;
  const padBytes = rem === 0 ? 16 : 16 - rem;
  writer.writeZeros(padBytes);
  writer.writeUint32(0);
  writer.writeUint32(FBX_VERSION);
  writer.writeZeros(120);
  writer.writeBytes(FBX_FOOTER_EXTENSION);

  const fbxBytes = writer.finish();

  if (!options.packageAsZip) {
    const ab = fbxBytes.buffer.slice(
      fbxBytes.byteOffset,
      fbxBytes.byteOffset + fbxBytes.byteLength
    ) as ArrayBuffer;
    const blob = new Blob([ab], { type: 'application/octet-stream' });
    return {
      blob,
      filename: `${baseName}.fbx`,
      includedFiles: [`${baseName}.fbx`],
    };
  }

  const zip = new JSZip();
  const includedFiles: string[] = [`${baseName}.fbx`];
  zip.file(`${baseName}.fbx`, fbxBytes);

  if (options.includeMaterials) {
    for (const tex of prepared.textures) {
      zip.file(`textures/${tex.filename}`, tex.data);
      includedFiles.push(`textures/${tex.filename}`);
    }
  }

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  return {
    blob: zipBlob,
    filename: `${baseName}_fbx.zip`,
    includedFiles,
  };
}
