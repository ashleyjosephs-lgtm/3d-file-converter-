import React, { useCallback, useEffect, useRef, useState } from 'react';
import { TopBar, type AppView } from './components/TopBar';
import { Viewport3D } from './components/Viewport3D';
import { ConversionPanel } from './components/ConversionPanel';
import { BatchQueueView } from './components/BatchQueueView';
import { SamplesView } from './components/SamplesView';
import { WindowsGuideView } from './components/WindowsGuideView';
import { GlobalProgressBar } from './components/GlobalProgressBar';
import { disposeObject3D, parseGlbBuffer } from './lib/gltfLoader';
import { SAMPLE_MODELS, generateSampleGlbBuffer } from './lib/sampleModels';
import {
  convertBatchToZip,
  convertQueuedModel,
  triggerBlobDownload,
} from './lib/converters';
import type {
  ConversionLogEntry,
  ConversionProgress,
  ConversionResult,
  ExportOptions,
  QueuedModel,
  ScaleUnit,
  TargetFormat,
  UpAxis,
} from './types/converter';

function stripExtension(filename: string): string {
  return filename.replace(/\.(glb|gltf)$/i, '') || 'model';
}

export default function App() {
  const [activeView, setActiveView] = useState<AppView>('converter');
  const [models, setModels] = useState<QueuedModel[]>([]);
  const [activeModelId, setActiveModelId] = useState<string | null>(null);
  const [isLoadingModel, setIsLoadingModel] = useState<boolean>(true);
  const [isConverting, setIsConverting] = useState<boolean>(false);
  const [lastResult, setLastResult] = useState<ConversionResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [conversionLogs, setConversionLogs] = useState<ConversionLogEntry[]>(
    []
  );
  const [conversionProgress, setConversionProgress] =
    useState<ConversionProgress>({
      visible: false,
      percent: 0,
      label: '',
      status: 'running',
    });

  const progressTimerRef = useRef<number | null>(null);

  const clearProgressTimer = useCallback(() => {
    if (progressTimerRef.current !== null) {
      window.clearTimeout(progressTimerRef.current);
      progressTimerRef.current = null;
    }
  }, []);

  const scheduleProgressAutoHide = useCallback(() => {
    clearProgressTimer();
    progressTimerRef.current = window.setTimeout(() => {
      setConversionProgress((prev) =>
        prev.status === 'running' ? prev : { ...prev, visible: false }
      );
      progressTimerRef.current = null;
    }, 3200);
  }, [clearProgressTimer]);

  const appendLog = useCallback(
    (entry: Omit<ConversionLogEntry, 'id' | 'timestamp'>) => {
      const now = new Date();
      const timestamp = now.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      setConversionLogs((prev) => [
        {
          ...entry,
          id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          timestamp,
        },
        ...prev,
      ]);
    },
    []
  );

  const [options, setOptions] = useState<ExportOptions>({
    format: 'fbx',
    scaleUnit: 'meters',
    upAxis: 'y-up',
    includeMaterials: true,
    packageAsZip: false,
    autoRemoveCompleted: false,
  });

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const modelsRef = useRef<QueuedModel[]>([]);
  modelsRef.current = models;

  // Load initial sample GLB on startup so viewport is ready immediately
  useEffect(() => {
    let cancelled = false;
    async function initDefaultSample() {
      try {
        const def = SAMPLE_MODELS[0];
        const buffer = await generateSampleGlbBuffer(def.id);
        if (cancelled) return;
        const { scene, stats } = await parseGlbBuffer(buffer);
        if (cancelled) {
          disposeObject3D(scene);
          return;
        }
        const entry: QueuedModel = {
          id: `sample-${def.id}-${Date.now()}`,
          name: def.filename,
          baseName: stripExtension(def.filename),
          fileSizeBytes: buffer.byteLength,
          buffer,
          stats,
          scene,
          isSample: true,
          status: 'ready',
        };
        setModels([entry]);
        setActiveModelId(entry.id);
      } catch (err) {
        if (!cancelled) {
          setErrorMessage(
            err instanceof Error ? err.message : 'Failed to initialize preview.'
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoadingModel(false);
        }
      }
    }
    initDefaultSample();

    return () => {
      cancelled = true;
      clearProgressTimer();
      modelsRef.current.forEach((m) => disposeObject3D(m.scene));
    };
  }, [clearProgressTimer]);

  const ingestFiles = useCallback(async (fileList: FileList) => {
    const incoming = Array.from(fileList);
    if (incoming.length === 0) return;

    setIsLoadingModel(true);
    setErrorMessage(null);
    setLastResult(null);

    const added: QueuedModel[] = [];
    const errors: string[] = [];

    for (const file of incoming) {
      const lower = file.name.toLowerCase();
      if (!lower.endsWith('.glb') && !lower.endsWith('.gltf')) {
        const msg = `Unsupported file extension (expected .glb or .gltf).`;
        errors.push(`"${file.name}" is not a .glb or .gltf file.`);
        appendLog({
          status: 'error',
          sourceName: file.name,
          targetFormat: 'glb',
          message: msg,
        });
        continue;
      }
      try {
        const buffer = await file.arrayBuffer();
        const { scene, stats } = await parseGlbBuffer(buffer);
        added.push({
          id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: file.name,
          baseName: stripExtension(file.name),
          fileSizeBytes: file.size,
          buffer,
          stats,
          scene,
          isSample: false,
          status: 'ready',
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Invalid GLB data.';
        errors.push(`${file.name}: ${msg}`);
        appendLog({
          status: 'error',
          sourceName: file.name,
          targetFormat: 'glb',
          message: msg,
        });
      }
    }

    if (added.length > 0) {
      setModels((prev) => {
        // Replace initial sample model automatically if user drops their own first file
        const withoutAutoSample =
          prev.length === 1 && prev[0].isSample
            ? (disposeObject3D(prev[0].scene), [])
            : prev;
        return [...withoutAutoSample, ...added];
      });
      setActiveModelId(added[0].id);
      setActiveView('converter');
    }

    if (errors.length > 0) {
      setErrorMessage(errors[0]);
    }
    setIsLoadingModel(false);
  }, [appendLog]);

  const handleLoadSample = useCallback(async (sampleId: string) => {
    const def = SAMPLE_MODELS.find((s) => s.id === sampleId);
    if (!def) return;

    setIsLoadingModel(true);
    setErrorMessage(null);
    setLastResult(null);
    try {
      const buffer = await generateSampleGlbBuffer(def.id);
      const { scene, stats } = await parseGlbBuffer(buffer);
      const entry: QueuedModel = {
        id: `sample-${def.id}-${Date.now()}`,
        name: def.filename,
        baseName: stripExtension(def.filename),
        fileSizeBytes: buffer.byteLength,
        buffer,
        stats,
        scene,
        isSample: true,
        status: 'ready',
      };
      setModels((prev) => [...prev, entry]);
      setActiveModelId(entry.id);
      setActiveView('converter');
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Unable to load sample model.'
      );
    } finally {
      setIsLoadingModel(false);
    }
  }, []);

  const handleRemoveModel = useCallback((id: string) => {
    setModels((prev) => {
      const target = prev.find((m) => m.id === id);
      if (target) disposeObject3D(target.scene);
      const next = prev.filter((m) => m.id !== id);
      setActiveModelId((currentActive) => {
        if (currentActive !== id) return currentActive;
        return next.length > 0 ? next[0].id : null;
      });
      return next;
    });
    setLastResult(null);
  }, []);

  const handleClearSuccesses = useCallback(() => {
    setModels((prev) => {
      const remaining: QueuedModel[] = [];
      for (const m of prev) {
        if (m.status === 'done') {
          disposeObject3D(m.scene);
        } else {
          remaining.push(m);
        }
      }
      setActiveModelId((currentActive) => {
        if (!currentActive) return remaining[0]?.id ?? null;
        const stillExists = remaining.some((m) => m.id === currentActive);
        return stillExists ? currentActive : remaining[0]?.id ?? null;
      });
      return remaining;
    });
  }, []);

  const handleReorderModels = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (fromIndex === toIndex) return;
      setModels((prev) => {
        if (
          fromIndex < 0 ||
          fromIndex >= prev.length ||
          toIndex < 0 ||
          toIndex >= prev.length
        ) {
          return prev;
        }
        const next = [...prev];
        const [moved] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, moved);
        return next;
      });
    },
    []
  );

  const handleChangeFormat = useCallback((format: TargetFormat) => {
    setLastResult(null);
    setErrorMessage(null);
    setOptions((prev) => ({
      ...prev,
      format,
      upAxis: format === 'skp' ? 'z-up' : prev.upAxis,
      packageAsZip: format === 'skp' || format === 'obj' ? true : false,
    }));
  }, []);

  const handleConvertModel = useCallback(
    async (modelId: string) => {
      const target = modelsRef.current.find((m) => m.id === modelId);
      if (!target) return;

      clearProgressTimer();
      setIsConverting(true);
      setErrorMessage(null);
      setConversionProgress({
        visible: true,
        percent: 10,
        label: `Starting conversion for ${target.name}...`,
        status: 'running',
        current: 1,
        total: 1,
      });
      setModels((prev) =>
        prev.map((m) =>
          m.id === modelId ? { ...m, status: 'converting' } : m
        )
      );

      try {
        const result = await convertQueuedModel(target, options, (update) => {
          setConversionProgress({
            visible: true,
            percent: update.percent,
            label: update.label,
            status: 'running',
            current: update.current,
            total: update.total,
          });
        });
        triggerBlobDownload(result.blob, result.filename);
        setLastResult(result);
        if (options.autoRemoveCompleted) {
          setModels((prev) => {
            const removed = prev.find((m) => m.id === modelId);
            if (removed) disposeObject3D(removed.scene);
            const next = prev.filter((m) => m.id !== modelId);
            setActiveModelId((currentActive) => {
              if (currentActive !== modelId) return currentActive;
              return next.length > 0 ? next[0].id : null;
            });
            return next;
          });
        } else {
          setModels((prev) =>
            prev.map((m) =>
              m.id === modelId
                ? {
                    ...m,
                    status: 'done',
                    lastConvertedFormat: result.format,
                    lastOutputSizeBytes: result.sizeBytes,
                  }
                : m
            )
          );
        }
        appendLog({
          status: 'success',
          sourceName: target.name,
          targetFormat: result.format,
          outputFilename: result.filename,
          sizeBytes: result.sizeBytes,
          durationMs: result.durationMs,
          message: `Exported ${result.includedFiles.length} ${
            result.includedFiles.length === 1 ? 'file' : 'files'
          } (${options.upAxis === 'z-up' ? 'Z-Up' : 'Y-Up'}, ${options.scaleUnit}).`,
        });
        setConversionProgress({
          visible: true,
          percent: 100,
          label: `Converted ${target.name} → ${result.filename}`,
          status: 'completed',
          current: 1,
          total: 1,
        });
        scheduleProgressAutoHide();
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : 'Conversion failed unexpectedly.';
        setErrorMessage(msg);
        setModels((prev) =>
          prev.map((m) =>
            m.id === modelId ? { ...m, status: 'error', errorMessage: msg } : m
          )
        );
        appendLog({
          status: 'error',
          sourceName: target.name,
          targetFormat: options.format,
          message: msg,
        });
        setConversionProgress({
          visible: true,
          percent: 100,
          label: `Conversion failed for ${target.name}: ${msg}`,
          status: 'error',
          current: 1,
          total: 1,
        });
      } finally {
        setIsConverting(false);
      }
    },
    [options, appendLog, clearProgressTimer, scheduleProgressAutoHide]
  );

  const handleConvertAll = useCallback(async () => {
    if (modelsRef.current.length === 0) return;
    clearProgressTimer();
    setIsConverting(true);
    setErrorMessage(null);
    const total = modelsRef.current.length;
    setConversionProgress({
      visible: true,
      percent: 4,
      label: `Starting batch conversion (${total} ${
        total === 1 ? 'model' : 'models'
      })...`,
      status: 'running',
      current: 1,
      total,
    });

    try {
      const batch = await convertBatchToZip(
        modelsRef.current,
        options,
        (update) => {
          setConversionProgress({
            visible: true,
            percent: update.percent,
            label: update.label,
            status: 'running',
            current: update.current,
            total: update.total,
          });
        }
      );
      triggerBlobDownload(batch.blob, batch.filename);
      setLastResult({
        blob: batch.blob,
        filename: batch.filename,
        format: options.format,
        includedFiles: modelsRef.current.map(
          (m) => `${m.baseName}.${options.format === 'skp' ? 'dae' : options.format}`
        ),
        durationMs: batch.durationMs,
        sizeBytes: batch.blob.size,
      });
      if (options.autoRemoveCompleted) {
        const convertedIds = new Set(modelsRef.current.map((m) => m.id));
        setModels((prev) => {
          const remaining: QueuedModel[] = [];
          for (const m of prev) {
            if (convertedIds.has(m.id)) {
              disposeObject3D(m.scene);
            } else {
              remaining.push(m);
            }
          }
          setActiveModelId((currentActive) => {
            if (!currentActive) return remaining[0]?.id ?? null;
            const stillExists = remaining.some((m) => m.id === currentActive);
            return stillExists ? currentActive : remaining[0]?.id ?? null;
          });
          return remaining;
        });
      } else {
        setModels((prev) =>
          prev.map((m) => ({
            ...m,
            status: 'done',
            lastConvertedFormat: options.format,
          }))
        );
      }
      appendLog({
        status: 'success',
        sourceName: `Batch (${batch.count} ${
          batch.count === 1 ? 'model' : 'models'
        })`,
        targetFormat: options.format,
        outputFilename: batch.filename,
        sizeBytes: batch.blob.size,
        durationMs: batch.durationMs,
        message: `Bundled ${batch.count} models into ${batch.filename}.`,
      });
      setConversionProgress({
        visible: true,
        percent: 100,
        label: `Batch complete: ${batch.filename}`,
        status: 'completed',
        current: total,
        total,
      });
      scheduleProgressAutoHide();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Batch conversion failed.';
      setErrorMessage(msg);
      appendLog({
        status: 'error',
        sourceName: `Batch (${modelsRef.current.length} models)`,
        targetFormat: options.format,
        message: msg,
      });
      setConversionProgress({
        visible: true,
        percent: 100,
        label: `Batch conversion failed: ${msg}`,
        status: 'error',
        current: total,
        total,
      });
    } finally {
      setIsConverting(false);
    }
  }, [options, appendLog, clearProgressTimer, scheduleProgressAutoHide]);

  const activeModel = models.find((m) => m.id === activeModelId) ?? null;

  const openFilePicker = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-[#0E1116] text-slate-100 overflow-hidden">
      <TopBar
        activeView={activeView}
        onSelectView={setActiveView}
        onAddFilesClick={openFilePicker}
        queueCount={models.length}
      />

      {/* Mobile compact view bar (hidden on md+ where TopBar nav is visible) */}
      <div className="flex md:hidden items-center gap-1 px-4 py-2 bg-[#161B22] border-b border-[#262D38] overflow-x-auto shrink-0">
        {(
          [
            { id: 'converter', label: 'Converter' },
            { id: 'batch', label: `Batch (${models.length})` },
            { id: 'samples', label: 'Samples' },
            { id: 'windows', label: 'Windows' },
          ] as Array<{ id: AppView; label: string }>
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveView(tab.id)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer ${
              activeView === tab.id
                ? 'bg-blue-600 text-white'
                : 'text-slate-400 hover:bg-[#222933] hover:text-slate-100'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".glb,.gltf"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) {
            ingestFiles(e.target.files);
          }
        }}
      />

      {activeView === 'converter' && (
        <main className="flex-1 min-h-0 flex flex-col lg:flex-row">
          <div className="flex-1 min-w-0 min-h-[360px] lg:h-full">
            <Viewport3D
              modelScene={activeModel?.scene ?? null}
              modelName={activeModel?.name ?? ''}
              modelStats={activeModel?.stats ?? null}
              isLoading={isLoadingModel}
              onDropFiles={ingestFiles}
              onOpenFilePicker={openFilePicker}
            />
          </div>

          <ConversionPanel
            models={models}
            activeModelId={activeModelId}
            options={options}
            isConverting={isConverting}
            lastResult={lastResult}
            errorMessage={errorMessage}
            onSelectModel={(id) => {
              setActiveModelId(id);
              setLastResult(null);
              setErrorMessage(null);
            }}
            onRemoveModel={handleRemoveModel}
            onOpenFilePicker={openFilePicker}
            onChangeFormat={handleChangeFormat}
            onChangeScaleUnit={(scaleUnit: ScaleUnit) =>
              setOptions((p) => ({ ...p, scaleUnit }))
            }
            onChangeUpAxis={(upAxis: UpAxis) =>
              setOptions((p) => ({ ...p, upAxis }))
            }
            onToggleMaterials={(includeMaterials: boolean) =>
              setOptions((p) => ({ ...p, includeMaterials }))
            }
            onToggleZip={(packageAsZip: boolean) =>
              setOptions((p) => ({ ...p, packageAsZip }))
            }
            onToggleAutoRemove={(autoRemoveCompleted: boolean) =>
              setOptions((p) => ({ ...p, autoRemoveCompleted }))
            }
            onConvertSingle={() => {
              if (activeModelId) handleConvertModel(activeModelId);
            }}
            onConvertAll={handleConvertAll}
          />
        </main>
      )}

      {activeView === 'batch' && (
        <BatchQueueView
          models={models}
          activeModelId={activeModelId}
          options={options}
          isConverting={isConverting}
          logs={conversionLogs}
          onAddFiles={openFilePicker}
          onPreviewModel={(id) => {
            setActiveModelId(id);
            setActiveView('converter');
          }}
          onConvertSingleById={handleConvertModel}
          onRemoveModel={handleRemoveModel}
          onConvertAll={handleConvertAll}
          onChangeFormat={handleChangeFormat}
          onClearSuccesses={handleClearSuccesses}
          onReorderModels={handleReorderModels}
          onToggleAutoRemove={(autoRemoveCompleted: boolean) =>
            setOptions((p) => ({ ...p, autoRemoveCompleted }))
          }
          onClearLogs={() => setConversionLogs([])}
        />
      )}

      {activeView === 'samples' && (
        <SamplesView onLoadSample={handleLoadSample} />
      )}

      {activeView === 'windows' && <WindowsGuideView />}

      <GlobalProgressBar
        progress={conversionProgress}
        onDismiss={() => {
          clearProgressTimer();
          setConversionProgress((prev) => ({ ...prev, visible: false }));
        }}
      />
    </div>
  );
}
