import React from 'react';
import {
  CheckCircle2,
  Download,
  FileUp,
  FolderArchive,
  Trash2,
  AlertCircle,
} from 'lucide-react';
import type {
  ConversionResult,
  ExportOptions,
  QueuedModel,
  ScaleUnit,
  TargetFormat,
  UpAxis,
} from '../types/converter';

interface ConversionPanelProps {
  models: QueuedModel[];
  activeModelId: string | null;
  options: ExportOptions;
  isConverting: boolean;
  lastResult: ConversionResult | null;
  errorMessage: string | null;
  onSelectModel: (id: string) => void;
  onRemoveModel: (id: string) => void;
  onOpenFilePicker: () => void;
  onChangeFormat: (format: TargetFormat) => void;
  onChangeScaleUnit: (unit: ScaleUnit) => void;
  onChangeUpAxis: (axis: UpAxis) => void;
  onToggleMaterials: (include: boolean) => void;
  onToggleZip: (zip: boolean) => void;
  onToggleAutoRemove: (autoRemove: boolean) => void;
  onConvertSingle: () => void;
  onConvertAll: () => void;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

const FORMAT_CARDS: Array<{
  id: TargetFormat;
  title: string;
  extLabel: string;
  subtitle: string;
}> = [
  {
    id: 'fbx',
    title: 'FBX',
    extLabel: '.fbx',
    subtitle: 'Blender, Unreal, Unity, Maya',
  },
  {
    id: 'obj',
    title: 'OBJ',
    extLabel: '.obj + .mtl',
    subtitle: 'Universal mesh & materials',
  },
  {
    id: 'skp',
    title: 'SKP',
    extLabel: 'SketchUp',
    subtitle: 'Z-up DAE + Ruby .skp bridge',
  },
];

export const ConversionPanel: React.FC<ConversionPanelProps> = ({
  models,
  activeModelId,
  options,
  isConverting,
  lastResult,
  errorMessage,
  onSelectModel,
  onRemoveModel,
  onOpenFilePicker,
  onChangeFormat,
  onChangeScaleUnit,
  onChangeUpAxis,
  onToggleMaterials,
  onToggleZip,
  onToggleAutoRemove,
  onConvertSingle,
  onConvertAll,
}) => {
  const activeModel = models.find((m) => m.id === activeModelId) ?? null;

  return (
    <aside className="w-full lg:w-[410px] shrink-0 bg-[#161B22] border-t lg:border-t-0 lg:border-l border-[#262D38] flex flex-col h-full overflow-y-auto">
      {/* Step 1: Source File & Active Model Summary */}
      <div className="p-6 border-b border-[#262D38]">
        <div className="flex items-center justify-between gap-4 mb-3">
          <h2 className="font-display text-sm font-semibold text-slate-100 tracking-[0.005em]">
            1. Source GLB Model
          </h2>
          <button
            type="button"
            onClick={onOpenFilePicker}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-400 hover:text-blue-300 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <FileUp className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Load GLB</span>
          </button>
        </div>

        {models.length > 0 ? (
          <div className="space-y-2">
            {models.map((item) => {
              const isSelected = item.id === activeModelId;
              return (
                <div
                  key={item.id}
                  className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border transition-colors ${
                    isSelected
                      ? 'bg-[#1E242E] border-slate-600'
                      : 'bg-[#12161C] border-[#262D38] hover:border-slate-600'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSelectModel(item.id)}
                    className="flex-1 min-w-0 text-left cursor-pointer"
                  >
                    <div className="text-sm font-medium text-slate-100 truncate">
                      {item.name}
                    </div>
                    <div className="text-xs text-slate-400 font-mono-tabular truncate mt-0.5">
                      {formatBytes(item.fileSizeBytes)} ·{' '}
                      {item.stats.triangleCount.toLocaleString()} tris ·{' '}
                      {item.stats.meshCount}{' '}
                      {item.stats.meshCount === 1 ? 'mesh' : 'meshes'}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemoveModel(item.id)}
                    aria-label={`Remove ${item.name}`}
                    className="p-1.5 rounded-md text-slate-500 hover:text-red-400 hover:bg-red-950/50 transition-colors shrink-0 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <button
            type="button"
            onClick={onOpenFilePicker}
            className="w-full py-6 px-4 rounded-lg border border-dashed border-slate-700 hover:border-blue-500 hover:bg-[#1B212A] transition-colors text-center cursor-pointer"
          >
            <p className="text-sm font-medium text-slate-200">
              Choose a .glb file from your PC
            </p>
            <p className="text-xs text-slate-400 mt-1">
              Supports single or multiple GLB / GLTF files
            </p>
          </button>
        )}

        {activeModel && (
          <dl className="grid grid-cols-3 gap-x-4 gap-y-2 mt-4 pt-4 border-t border-[#262D38] text-xs">
            <div>
              <dt className="text-slate-400">Vertices</dt>
              <dd className="font-mono-tabular font-medium text-slate-100 mt-0.5">
                {activeModel.stats.vertexCount.toLocaleString()}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Materials</dt>
              <dd className="font-mono-tabular font-medium text-slate-100 mt-0.5">
                {activeModel.stats.materialCount}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Textures</dt>
              <dd className="font-mono-tabular font-medium text-slate-100 mt-0.5">
                {activeModel.stats.textureCount}
              </dd>
            </div>
          </dl>
        )}
      </div>

      {/* Step 2: Target Format Selector */}
      <div className="p-6 border-b border-[#262D38]">
        <h2 className="font-display text-sm font-semibold text-slate-100 tracking-[0.005em] mb-3">
          2. Output Format
        </h2>

        <div
          role="radiogroup"
          aria-label="Target 3D export format"
          className="grid grid-cols-3 gap-2"
        >
          {FORMAT_CARDS.map((card) => {
            const active = options.format === card.id;
            return (
              <button
                key={card.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onChangeFormat(card.id)}
                className={`p-3 rounded-lg border text-left transition-colors duration-150 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${
                  active
                    ? 'bg-blue-950/50 border-blue-500 text-white'
                    : 'bg-[#12161C] border-[#262D38] text-slate-300 hover:border-slate-600'
                }`}
              >
                <div className="flex items-baseline justify-between gap-1">
                  <span className="font-display text-sm font-bold">
                    {card.title}
                  </span>
                </div>
                <div
                  className={`text-[11px] font-mono-tabular mt-0.5 truncate ${
                    active ? 'text-blue-300' : 'text-slate-400'
                  }`}
                >
                  {card.extLabel}
                </div>
              </button>
            );
          })}
        </div>

        <p className="text-xs text-slate-400 mt-3 leading-relaxed">
          {options.format === 'fbx' &&
            'Exports Autodesk FBX 7.4 Binary with mesh geometry, edges, normals, UVs, and surface material definitions for 3ds Max, Maya, and Blender.'}
          {options.format === 'obj' &&
            'Exports Wavefront .obj geometry paired with a .mtl material library and extracted PNG textures.'}
          {options.format === 'skp' &&
            'Trimble .skp binary requires the proprietary Windows C++ SDK. Exports SketchUp-native Z-up COLLADA (.dae) plus a 1-click Ruby auto-save script (import_to_skp.rb) for SketchUp Desktop.'}
        </p>
      </div>

      {/* Step 3: Export Settings */}
      <div className="p-6 border-b border-[#262D38] space-y-4">
        <h2 className="font-display text-sm font-semibold text-slate-100 tracking-[0.005em]">
          3. Export Settings
        </h2>

        <div>
          <label
            htmlFor="scale-unit-select"
            className="block text-xs font-medium text-slate-300 mb-1.5"
          >
            Scale Unit
          </label>
          <select
            id="scale-unit-select"
            value={options.scaleUnit}
            onChange={(e) => onChangeScaleUnit(e.target.value as ScaleUnit)}
            className="w-full h-10 px-3 rounded-lg border border-[#262D38] bg-[#12161C] text-sm text-slate-100 focus:outline-none focus:border-blue-500"
          >
            <option value="meters">Meters (1.0× native GLB)</option>
            <option value="centimeters">Centimeters (100× FBX / Maya)</option>
            <option value="millimeters">Millimeters (1000× CAD / 3D Print)</option>
            <option value="inches">Inches (39.37× SketchUp Imperial)</option>
          </select>
        </div>

        <div>
          <span className="block text-xs font-medium text-slate-300 mb-1.5">
            Coordinate Up-Axis
          </span>
          <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-[#0E1116] border border-[#262D38]">
            <button
              type="button"
              onClick={() => onChangeUpAxis('y-up')}
              className={`py-1.5 px-3 rounded-md text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
                options.upAxis === 'y-up'
                  ? 'bg-[#222933] text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Y-Up (Unity / Maya)
            </button>
            <button
              type="button"
              onClick={() => onChangeUpAxis('z-up')}
              className={`py-1.5 px-3 rounded-md text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
                options.upAxis === 'z-up'
                  ? 'bg-[#222933] text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Z-Up (SketchUp / Blender)
            </button>
          </div>
        </div>

        <div className="space-y-2.5 pt-1">
          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <span className="text-xs font-medium text-slate-300">
              Include Materials &amp; Textures
            </span>
            <input
              type="checkbox"
              checked={options.includeMaterials}
              onChange={(e) => onToggleMaterials(e.target.checked)}
              className="w-4 h-4 accent-blue-500 rounded cursor-pointer"
            />
          </label>

          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <span className="text-xs font-medium text-slate-300">
              Bundle Companion Files (.zip)
            </span>
            <input
              type="checkbox"
              checked={options.packageAsZip}
              onChange={(e) => onToggleZip(e.target.checked)}
              className="w-4 h-4 accent-blue-500 rounded cursor-pointer"
            />
          </label>

          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <span className="text-xs font-medium text-slate-300">
              Auto-remove completed items
            </span>
            <input
              type="checkbox"
              checked={options.autoRemoveCompleted}
              onChange={(e) => onToggleAutoRemove(e.target.checked)}
              className="w-4 h-4 accent-blue-500 rounded cursor-pointer"
            />
          </label>
        </div>
      </div>

      {/* Primary Action & Feedback */}
      <div className="p-6 mt-auto space-y-3 bg-[#12161C]">
        {errorMessage && (
          <div
            role="alert"
            className="flex items-start gap-2.5 p-3 rounded-lg bg-red-950/50 border border-red-800/70 text-xs text-red-200"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-400" />
            <span>{errorMessage}</span>
          </div>
        )}

        {lastResult && !errorMessage && (
          <div className="p-3 rounded-lg bg-[#161B22] border border-[#262D38] text-xs space-y-1">
            <div className="flex items-center gap-1.5 font-medium text-emerald-400">
              <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{lastResult.filename}</span>
            </div>
            <div className="text-slate-400 font-mono-tabular">
              {formatBytes(lastResult.sizeBytes)} · {lastResult.durationMs} ms ·{' '}
              {lastResult.includedFiles.length}{' '}
              {lastResult.includedFiles.length === 1 ? 'file' : 'files'}
            </div>
          </div>
        )}

        <button
          type="button"
          disabled={!activeModel || isConverting}
          onClick={onConvertSingle}
          className="w-full inline-flex items-center justify-center gap-2 h-11 px-4 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 text-white text-sm font-semibold whitespace-nowrap transition-colors duration-150 cursor-pointer disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
        >
          <Download className="w-4 h-4" aria-hidden="true" />
          <span>
            {isConverting
              ? 'Converting...'
              : `Convert to ${options.format.toUpperCase()} & Download`}
          </span>
        </button>

        {models.length > 1 && (
          <button
            type="button"
            disabled={isConverting}
            onClick={onConvertAll}
            className="w-full inline-flex items-center justify-center gap-2 h-10 px-4 rounded-lg bg-[#1C222B] hover:bg-[#232A35] border border-[#2D3542] text-slate-200 text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer disabled:opacity-50"
          >
            <FolderArchive className="w-4 h-4" aria-hidden="true" />
            <span>
              Convert All {models.length} Models to{' '}
              {options.format.toUpperCase()} (.zip)
            </span>
          </button>
        )}
      </div>
    </aside>
  );
};
