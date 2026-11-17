import JSZip from 'jszip';
import type {
  ConversionResult,
  ExportOptions,
  QueuedModel,
} from '../../types/converter';
import { convertToFbx } from './exportFbx';
import { convertToObj } from './exportObj';
import { convertToSkpPackage } from './exportSkp';

export interface ProgressUpdate {
  percent: number;
  label: string;
  current?: number;
  total?: number;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}

export async function convertQueuedModel(
  model: QueuedModel,
  options: ExportOptions,
  onProgress?: (update: ProgressUpdate) => void
): Promise<ConversionResult> {
  const start = performance.now();

  onProgress?.({
    percent: 20,
    label: `Preparing ${model.name} geometry & materials...`,
    current: 1,
    total: 1,
  });
  await nextFrame();

  let output: { blob: Blob; filename: string; includedFiles: string[] };

  onProgress?.({
    percent: 60,
    label: `Converting ${model.name} to ${options.format.toUpperCase()}...`,
    current: 1,
    total: 1,
  });
  await nextFrame();

  switch (options.format) {
    case 'fbx':
      output = await convertToFbx(model.scene, model.baseName, options);
      break;
    case 'obj':
      output = await convertToObj(model.scene, model.baseName, options);
      break;
    case 'skp':
      output = await convertToSkpPackage(model.scene, model.baseName, options);
      break;
  }

  onProgress?.({
    percent: 100,
    label: `Exported ${output.filename}`,
    current: 1,
    total: 1,
  });

  const durationMs = Math.max(1, Math.round(performance.now() - start));

  return {
    blob: output.blob,
    filename: output.filename,
    format: options.format,
    includedFiles: output.includedFiles,
    durationMs,
    sizeBytes: output.blob.size,
  };
}

export async function convertBatchToZip(
  models: QueuedModel[],
  options: ExportOptions,
  onProgress?: (update: ProgressUpdate) => void
): Promise<{ blob: Blob; filename: string; count: number; durationMs: number }> {
  const start = performance.now();
  const masterZip = new JSZip();
  const total = models.length;

  for (let i = 0; i < total; i++) {
    const model = models[i];
    const basePercent = Math.round((i / total) * 80);
    onProgress?.({
      percent: Math.max(5, basePercent),
      label: `Converting ${model.name} (${i + 1} of ${total})...`,
      current: i + 1,
      total,
    });
    await nextFrame();

    const res = await convertQueuedModel(model, options);
    masterZip.file(res.filename, res.blob);

    onProgress?.({
      percent: Math.round(((i + 1) / total) * 80),
      label: `Converted ${model.name} (${i + 1} of ${total})`,
      current: i + 1,
      total,
    });
  }

  onProgress?.({
    percent: 82,
    label: `Packaging ${total} converted ${total === 1 ? 'model' : 'models'} into ZIP...`,
    current: total,
    total,
  });
  await nextFrame();

  const blob = await masterZip.generateAsync({ type: 'blob' }, (meta) => {
    const zipPercent = 80 + Math.round(meta.percent * 0.2);
    onProgress?.({
      percent: Math.min(99, zipPercent),
      label: `Compressing batch archive (${Math.round(meta.percent)}%)...`,
      current: total,
      total,
    });
  });

  const filename = `meshshift_batch_${options.format}_${total}files.zip`;
  onProgress?.({
    percent: 100,
    label: `Batch ready: ${filename}`,
    current: total,
    total,
  });

  const durationMs = Math.max(1, Math.round(performance.now() - start));

  return {
    blob,
    filename,
    count: total,
    durationMs,
  };
}

export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}
