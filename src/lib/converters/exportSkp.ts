import JSZip from 'jszip';
import * as THREE from 'three';
import type { ExportOptions, ScaleUnit } from '../../types/converter';
import { prepareSceneForExport } from './geometryUtils';

function fmt(n: number): string {
  const v = Math.abs(n) < 1e-7 ? 0 : n;
  return Number(v.toFixed(6)).toString();
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function getColladaUnitMeta(unit: ScaleUnit): { name: string; meter: number } {
  switch (unit) {
    case 'meters':
      return { name: 'meter', meter: 1.0 };
    case 'centimeters':
      return { name: 'centimeter', meter: 0.01 };
    case 'millimeters':
      return { name: 'millimeter', meter: 0.001 };
    case 'inches':
      return { name: 'inch', meter: 0.0254 };
  }
}

export async function convertToSkpPackage(
  root: THREE.Object3D,
  baseName: string,
  options: ExportOptions
): Promise<{ blob: Blob; filename: string; includedFiles: string[] }> {
  // SketchUp's native world coordinate system is always Z-up
  const sketchupUpAxis = options.upAxis;
  const prepared = await prepareSceneForExport(
    root,
    options.scaleUnit,
    sketchupUpAxis,
    options.includeMaterials
  );

  const unitMeta = getColladaUnitMeta(options.scaleUnit);
  const upAxisTag = sketchupUpAxis === 'z-up' ? 'Z_UP' : 'Y_UP';
  const nowIso = new Date().toISOString();

  const lines: string[] = [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">`,
    `  <asset>`,
    `    <contributor>`,
    `      <authoring_tool>MeshShift 3D Converter</authoring_tool>`,
    `    </contributor>`,
    `    <created>${nowIso}</created>`,
    `    <modified>${nowIso}</modified>`,
    `    <unit name="${unitMeta.name}" meter="${unitMeta.meter}"/>`,
    `    <up_axis>${upAxisTag}</up_axis>`,
    `  </asset>`,
  ];

  // Images
  if (options.includeMaterials && prepared.textures.length > 0) {
    lines.push(`  <library_images>`);
    prepared.textures.forEach((tex, idx) => {
      const safeId = `img_${idx}`;
      lines.push(`    <image id="${safeId}" name="${escapeXml(tex.filename)}">`);
      lines.push(`      <init_from>textures/${escapeXml(tex.filename)}</init_from>`);
      lines.push(`    </image>`);
    });
    lines.push(`  </library_images>`);
  }

  // Effects & Materials
  lines.push(`  <library_effects>`);
  prepared.materials.forEach((mat) => {
    const texIdx = mat.diffuseTextureName
      ? prepared.textures.findIndex((t) => t.filename === mat.diffuseTextureName)
      : -1;
    const shininess = Math.max(2, Math.round((1 - mat.roughness) * 96));

    lines.push(`    <effect id="${mat.id}-effect">`);
    lines.push(`      <profile_COMMON>`);
    if (texIdx >= 0) {
      const imgId = `img_${texIdx}`;
      lines.push(`        <newparam sid="${imgId}-surface">`);
      lines.push(`          <surface type="2D">`);
      lines.push(`            <init_from>${imgId}</init_from>`);
      lines.push(`          </surface>`);
      lines.push(`        </newparam>`);
      lines.push(`        <newparam sid="${imgId}-sampler">`);
      lines.push(`          <sampler2D>`);
      lines.push(`            <source>${imgId}-surface</source>`);
      lines.push(`          </sampler2D>`);
      lines.push(`        </newparam>`);
    }
    lines.push(`        <technique sid="common">`);
    lines.push(`          <phong>`);
    lines.push(`            <emission><color>${fmt(mat.emissive[0])} ${fmt(mat.emissive[1])} ${fmt(mat.emissive[2])} 1</color></emission>`);
    lines.push(`            <ambient><color>0.15 0.15 0.15 1</color></ambient>`);
    if (texIdx >= 0) {
      lines.push(`            <diffuse><texture texture="img_${texIdx}-sampler" texcoord="UVMap"/></diffuse>`);
    } else {
      lines.push(`            <diffuse><color>${fmt(mat.color[0])} ${fmt(mat.color[1])} ${fmt(mat.color[2])} ${fmt(mat.opacity)}</color></diffuse>`);
    }
    lines.push(`            <specular><color>0.25 0.25 0.25 1</color></specular>`);
    lines.push(`            <shininess><float>${shininess}</float></shininess>`);
    lines.push(`            <transparency><float>${fmt(mat.opacity)}</float></transparency>`);
    lines.push(`          </phong>`);
    lines.push(`        </technique>`);
    lines.push(`      </profile_COMMON>`);
    lines.push(`    </effect>`);
  });
  lines.push(`  </library_effects>`);

  lines.push(`  <library_materials>`);
  prepared.materials.forEach((mat) => {
    lines.push(`    <material id="${mat.id}" name="${escapeXml(mat.name)}">`);
    lines.push(`      <instance_effect url="#${mat.id}-effect"/>`);
    lines.push(`    </material>`);
  });
  lines.push(`  </library_materials>`);

  // Geometries
  lines.push(`  <library_geometries>`);
  prepared.meshes.forEach((mesh, idx) => {
    const geoId = `geo_${idx}`;
    const posStr = Array.from(mesh.positions, fmt).join(' ');
    const normStr = Array.from(mesh.normals, fmt).join(' ');
    const uvStr = Array.from(mesh.uvs, fmt).join(' ');

    const triIndices: number[] = [];
    for (let i = 0; i < mesh.indices.length; i++) {
      const vIdx = mesh.indices[i];
      triIndices.push(vIdx, vIdx, vIdx);
    }
    const triCount = Math.floor(mesh.indices.length / 3);
    const matRef = prepared.materials[mesh.materialIndex]?.id ?? 'default_material';

    lines.push(`    <geometry id="${geoId}" name="${escapeXml(mesh.name)}">`);
    lines.push(`      <mesh>`);
    lines.push(`        <source id="${geoId}-positions">`);
    lines.push(`          <float_array id="${geoId}-positions-array" count="${mesh.positions.length}">${posStr}</float_array>`);
    lines.push(`          <technique_common>`);
    lines.push(`            <accessor source="#${geoId}-positions-array" count="${mesh.positions.length / 3}" stride="3">`);
    lines.push(`              <param name="X" type="float"/>`);
    lines.push(`              <param name="Y" type="float"/>`);
    lines.push(`              <param name="Z" type="float"/>`);
    lines.push(`            </accessor>`);
    lines.push(`          </technique_common>`);
    lines.push(`        </source>`);

    lines.push(`        <source id="${geoId}-normals">`);
    lines.push(`          <float_array id="${geoId}-normals-array" count="${mesh.normals.length}">${normStr}</float_array>`);
    lines.push(`          <technique_common>`);
    lines.push(`            <accessor source="#${geoId}-normals-array" count="${mesh.normals.length / 3}" stride="3">`);
    lines.push(`              <param name="X" type="float"/>`);
    lines.push(`              <param name="Y" type="float"/>`);
    lines.push(`              <param name="Z" type="float"/>`);
    lines.push(`            </accessor>`);
    lines.push(`          </technique_common>`);
    lines.push(`        </source>`);

    lines.push(`        <source id="${geoId}-uvs">`);
    lines.push(`          <float_array id="${geoId}-uvs-array" count="${mesh.uvs.length}">${uvStr}</float_array>`);
    lines.push(`          <technique_common>`);
    lines.push(`            <accessor source="#${geoId}-uvs-array" count="${mesh.uvs.length / 2}" stride="2">`);
    lines.push(`              <param name="S" type="float"/>`);
    lines.push(`              <param name="T" type="float"/>`);
    lines.push(`            </accessor>`);
    lines.push(`          </technique_common>`);
    lines.push(`        </source>`);

    lines.push(`        <vertices id="${geoId}-vertices">`);
    lines.push(`          <input semantic="POSITION" source="#${geoId}-positions"/>`);
    lines.push(`        </vertices>`);

    lines.push(`        <triangles material="${matRef}" count="${triCount}">`);
    lines.push(`          <input semantic="VERTEX" source="#${geoId}-vertices" offset="0"/>`);
    lines.push(`          <input semantic="NORMAL" source="#${geoId}-normals" offset="1"/>`);
    lines.push(`          <input semantic="TEXCOORD" source="#${geoId}-uvs" offset="2" set="0"/>`);
    lines.push(`          <p>${triIndices.join(' ')}</p>`);
    lines.push(`        </triangles>`);
    lines.push(`      </mesh>`);
    lines.push(`    </geometry>`);
  });
  lines.push(`  </library_geometries>`);

  // Visual Scene
  lines.push(`  <library_visual_scenes>`);
  lines.push(`    <visual_scene id="Scene" name="Scene">`);
  prepared.meshes.forEach((mesh, idx) => {
    const geoId = `geo_${idx}`;
    const matRef = prepared.materials[mesh.materialIndex]?.id ?? 'default_material';
    lines.push(`      <node id="node_${idx}" name="${escapeXml(mesh.name)}" type="NODE">`);
    lines.push(`        <instance_geometry url="#${geoId}">`);
    lines.push(`          <bind_material>`);
    lines.push(`            <technique_common>`);
    lines.push(`              <instance_material symbol="${matRef}" target="#${matRef}">`);
    lines.push(`                <bind_vertex_input semantic="UVMap" input_semantic="TEXCOORD" input_set="0"/>`);
    lines.push(`              </instance_material>`);
    lines.push(`            </technique_common>`);
    lines.push(`          </bind_material>`);
    lines.push(`        </instance_geometry>`);
    lines.push(`      </node>`);
  });
  lines.push(`    </visual_scene>`);
  lines.push(`  </library_visual_scenes>`);

  lines.push(`  <scene>`);
  lines.push(`    <instance_visual_scene url="#Scene"/>`);
  lines.push(`  </scene>`);
  lines.push(`</COLLADA>`);

  const daeContent = lines.join('\n');

  const rubyScript = `# MeshShift SketchUp Desktop Auto-Converter (Windows / macOS)
# Run inside SketchUp Ruby Console:
#   load "<path-to-this-folder>/import_to_skp.rb"

require 'sketchup'

dir = File.dirname(__FILE__)
dae_path = File.join(dir, "${baseName}.dae")
skp_path = File.join(dir, "${baseName}.skp")

model = Sketchup.active_model
if model.import(dae_path, show_summary: false)
  model.save(skp_path)
  UI.messagebox("Saved native SketchUp file:\\n#{skp_path}")
else
  UI.messagebox("Failed to import #{dae_path}")
end
`;

  const readmeTxt = `MeshShift — SketchUp (SKP) Export Package
========================================

Files included:
- ${baseName}.dae       SketchUp-compatible COLLADA 1.4.1 geometry & materials
- import_to_skp.rb      Optional Ruby script to auto-import & save as native .skp
${prepared.textures.length > 0 ? '- textures/             Extracted diffuse texture maps\n' : ''}
How to open in Trimble SketchUp on Windows:
1. Open SketchUp Desktop.
2. Go to File -> Import...
3. Choose "COLLADA Files (*.dae)" and select "${baseName}.dae".
4. Save as "${baseName}.skp" via File -> Save As.

Optional 1-Click Ruby Auto-Save:
In SketchUp, open Window -> Ruby Console and run:
  load "C:/path/to/extracted/import_to_skp.rb"

Why .dae instead of direct .skp binary?
Trimble's proprietary .skp binary format requires the closed-source Windows C++
SketchUp SDK. COLLADA (.dae) preserves all triangles, UVs, normals, textures,
and ${sketchupUpAxis === 'z-up' ? 'Z-up' : 'Y-up'} world units natively inside SketchUp.
`;

  if (!options.packageAsZip) {
    const blob = new Blob([daeContent], {
      type: 'model/vnd.collada+xml;charset=utf-8',
    });
    return {
      blob,
      filename: `${baseName}.dae`,
      includedFiles: [`${baseName}.dae`],
    };
  }

  const zip = new JSZip();
  const includedFiles: string[] = [
    `${baseName}.dae`,
    'import_to_skp.rb',
    'README_SKETCHUP.txt',
  ];
  zip.file(`${baseName}.dae`, daeContent);
  zip.file('import_to_skp.rb', rubyScript);
  zip.file('README_SKETCHUP.txt', readmeTxt);

  if (options.includeMaterials) {
    for (const tex of prepared.textures) {
      zip.file(`textures/${tex.filename}`, tex.data);
      includedFiles.push(`textures/${tex.filename}`);
    }
  }

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  return {
    blob: zipBlob,
    filename: `${baseName}_sketchup.zip`,
    includedFiles,
  };
}
