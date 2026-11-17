import * as THREE from 'three';

export type TargetFormat = 'fbx' | 'obj' | 'skp';

export type UpAxis = 'y-up' | 'z-up';

export type ScaleUnit = 'meters' | 'centimeters' | 'millimeters' | 'inches';

export interface ExportOptions {
  format: TargetFormat;
  scaleUnit: ScaleUnit;
  upAxis: UpAxis;
  includeMaterials: boolean;
  packageAsZip: boolean;
  autoRemoveCompleted: boolean;
}

export interface ModelStats {
  meshCount: number;
  vertexCount: number;
  triangleCount: number;
  materialCount: number;
  textureCount: number;
  animationCount: number;
  dimensions: {
    x: number;
    y: number;
    z: number;
  };
  generator?: string;
}

export interface QueuedModel {
  id: string;
  name: string;
  baseName: string;
  fileSizeBytes: number;
  buffer: ArrayBuffer;
  stats: ModelStats;
  scene: THREE.Group;
  isSample?: boolean;
  status: 'ready' | 'converting' | 'done' | 'error';
  lastConvertedFormat?: TargetFormat;
  lastOutputSizeBytes?: number;
  errorMessage?: string;
}

export interface ConversionResult {
  blob: Blob;
  filename: string;
  format: TargetFormat;
  includedFiles: string[];
  durationMs: number;
  sizeBytes: number;
}

export interface ConversionLogEntry {
  id: string;
  timestamp: string;
  status: 'success' | 'error';
  sourceName: string;
  targetFormat: TargetFormat | 'glb';
  outputFilename?: string;
  sizeBytes?: number;
  durationMs?: number;
  message: string;
}

export interface ConversionProgress {
  visible: boolean;
  percent: number;
  label: string;
  status: 'running' | 'completed' | 'error';
  current?: number;
  total?: number;
}


