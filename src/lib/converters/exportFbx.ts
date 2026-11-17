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
  bboxMin: [number, number, number];
  bboxMax: [number, number, number];
}

function buildCompactMeshArrays(mesh: ExtractedMeshData): CompactedMeshArrays | null {
  const srcVertCount = Math.floor(mesh.positions.length / 3);
  if (srcVertCount === 0 || mesh.indices.length < 3) {
    return null;
  }

  // Remap only vertices actually referenced by valid non-degenerate triangles
  const srcToDst = new Int32Array(srcVertCount).fill(-1);
  const compactVertCoords: number[] = [];
  const compactUvCoords: number[] = [];
  const polyIndices: number[] = [];
  const normValues: number[] = [];
  const uvIndexValues: number[] = [];

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
    }
  }

  if (polyIndices.length === 0 || dstCount === 0) {
    return null;
  }

  return {
    vertices: new Float64Array(compactVertCoords),
    polygonVertexIndex: new Int32Array(polyIndices),
    edges: new Int32Array(edgeIndices),
    normals: new Float64Array(normValues),
    uvs: new Float64Array(compactUvCoords),
    uvIndices: new Int32Array(uvIndexValues),
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

  const materialEntries = prepared.materials.map((mat) => ({
    mat,
    materialId: allocId(),
  }));

  const textureEntries: Array<{
    materialId: number;
    textureId: number;
    videoId: number;
    name: string;
    relPath: string;
  }> = [];

  if (options.packageAsZip && options.includeMaterials) {
    for (const mEntry of materialEntries) {
      if (mEntry.mat.diffuseTextureName) {
        textureEntries.push({
          materialId: mEntry.materialId,
          textureId: allocId(),
          videoId: allocId(),
          name: mEntry.mat.diffuseTextureName.replace(/\.png$/i, ''),
          relPath: `textures/${mEntry.mat.diffuseTextureName}`,
        });
      }
    }
  }

  const now = new Date();
  const creationTimeStr = `${now.getUTCFullYear()}-${String(
    now.getUTCMonth() + 1
  ).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')} ${String(
    now.getUTCHours()
  ).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}:${String(
    now.getUTCSeconds()
  ).padStart(2, '0')}:000`;

  const fileId = new Uint8Array([
    0x4d, 0x65, 0x73, 0x68, 0x53, 0x68, 0x69, 0x66,
    0x74, 0x46, 0x42, 0x58, 0x37, 0x34, 0x30, 0x30,
  ]);

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
          { name: 'Year', props: [{ type: 'I', value: now.getUTCFullYear() }] },
          { name: 'Month', props: [{ type: 'I', value: now.getUTCMonth() + 1 }] },
          { name: 'Day', props: [{ type: 'I', value: now.getUTCDate() }] },
          { name: 'Hour', props: [{ type: 'I', value: now.getUTCHours() }] },
          { name: 'Minute', props: [{ type: 'I', value: now.getUTCMinutes() }] },
          { name: 'Second', props: [{ type: 'I', value: now.getUTCSeconds() }] },
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
          { type: 'S', value: 'Scene\x00\x01Document' },
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
                  { type: 'S', value: 'DiffuseColor' },
                  { type: 'S', value: 'Color' },
                  { type: 'S', value: '' },
                  { type: 'S', value: 'A' },
                  { type: 'D', value: 0.8 },
                  { type: 'D', value: 0.8 },
                  { type: 'D', value: 0.8 }
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
                  { type: 'S', value: 'ShininessExponent' },
                  { type: 'S', value: 'Number' },
                  { type: 'S', value: '' },
                  { type: 'S', value: 'A' },
                  { type: 'D', value: 20 }
                ),
                P(
                  { type: 'S', value: 'Opacity' },
                  { type: 'S', value: 'Number' },
                  { type: 'S', value: '' },
                  { type: 'S', value: 'A' },
                  { type: 'D', value: 1 }
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
      ],
    });
    definitionChildren.push({
      name: 'ObjectType',
      props: [{ type: 'S', value: 'Video' }],
      children: [
        { name: 'Count', props: [{ type: 'I', value: textureEntries.length }] },
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

    objectChildren.push({
      name: 'Geometry',
      props: [
        { type: 'L', value: geometryId },
        { type: 'S', value: `${mesh.name}\x00\x01Geometry` },
        { type: 'S', value: 'Mesh' },
      ],
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
        },
        {
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
        },
        {
          name: 'Layer',
          props: [{ type: 'I', value: 0 }],
          children: [
            { name: 'Version', props: [{ type: 'I', value: 100 }] },
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
          ],
        },
      ],
    });
  }

  for (const mEntry of materialEntries) {
    const { mat, materialId } = mEntry;
    const spec = Math.max(0.05, 1 - mat.roughness) * 0.5;
    const shininess = Math.max(2, Math.round((1 - mat.roughness) * 96));

    objectChildren.push({
      name: 'Material',
      props: [
        { type: 'L', value: materialId },
        { type: 'S', value: `${mat.name}\x00\x01Material` },
        { type: 'S', value: '' },
      ],
      children: [
        { name: 'Version', props: [{ type: 'I', value: 102 }] },
        { name: 'ShadingModel', props: [{ type: 'S', value: 'phong' }] },
        { name: 'MultiLayer', props: [{ type: 'I', value: 0 }] },
        {
          name: 'Properties70',
          children: [
            P(
              { type: 'S', value: 'ShadingModel' },
              { type: 'S', value: 'KString' },
              { type: 'S', value: '' },
              { type: 'S', value: '' },
              { type: 'S', value: 'phong' }
            ),
            P(
              { type: 'S', value: 'DiffuseColor' },
              { type: 'S', value: 'Color' },
              { type: 'S', value: '' },
              { type: 'S', value: 'A' },
              { type: 'D', value: safeNum(mat.color[0], 0.8) },
              { type: 'D', value: safeNum(mat.color[1], 0.8) },
              { type: 'D', value: safeNum(mat.color[2], 0.8) }
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
              { type: 'S', value: 'EmissiveColor' },
              { type: 'S', value: 'Color' },
              { type: 'S', value: '' },
              { type: 'S', value: 'A' },
              { type: 'D', value: safeNum(mat.emissive[0], 0) },
              { type: 'D', value: safeNum(mat.emissive[1], 0) },
              { type: 'D', value: safeNum(mat.emissive[2], 0) }
            ),
            P(
              { type: 'S', value: 'ShininessExponent' },
              { type: 'S', value: 'Number' },
              { type: 'S', value: '' },
              { type: 'S', value: 'A' },
              { type: 'D', value: shininess }
            ),
            P(
              { type: 'S', value: 'Opacity' },
              { type: 'S', value: 'Number' },
              { type: 'S', value: '' },
              { type: 'S', value: 'A' },
              { type: 'D', value: safeNum(mat.opacity, 1) }
            ),
          ],
        },
      ],
    });
  }

  for (const tEntry of textureEntries) {
    objectChildren.push({
      name: 'Video',
      props: [
        { type: 'L', value: tEntry.videoId },
        { type: 'S', value: `${tEntry.name}\x00\x01Video` },
        { type: 'S', value: 'Clip' },
      ],
      children: [
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
        { name: 'Filename', props: [{ type: 'S', value: tEntry.relPath }] },
        {
          name: 'RelativeFilename',
          props: [{ type: 'S', value: tEntry.relPath }],
        },
      ],
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
    connectionChildren.push({
      name: 'C',
      props: [
        { type: 'S', value: 'OP' },
        { type: 'L', value: tEntry.textureId },
        { type: 'L', value: tEntry.materialId },
        { type: 'S', value: 'DiffuseColor' },
      ],
    });
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
  writer.writeNode({ name: 'FileId', props: [{ type: 'R', value: fileId }] });
  writer.writeNode({
    name: 'CreationTime',
    props: [{ type: 'S', value: creationTimeStr }],
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
