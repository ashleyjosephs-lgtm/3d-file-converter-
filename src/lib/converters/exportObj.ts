import JSZip from 'jszip';
import * as THREE from 'three';
import type { ExportOptions } from '../../types/converter';
import { prepareSceneForExport } from './geometryUtils';

function fmt(n: number): string {
  const rounded = Math.abs(n) < 1e-7 ? 0 : n;
  return Number(rounded.toFixed(6)).toString();
}

export async function convertToObj(
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

  const objLines: string[] = [
    `# Exported by MeshShift 3D Converter`,
    `# Source: ${baseName}.glb`,
    `# Coordinate System: ${options.upAxis === 'z-up' ? 'Z-Up' : 'Y-Up'} | Unit: ${options.scaleUnit}`,
    '',
  ];

  const mtlName = `${baseName}.mtl`;
  if (options.includeMaterials && prepared.materials.length > 0) {
    objLines.push(`mtllib ${mtlName}`, '');
  }

  let vertexOffset = 1;
  let uvOffset = 1;
  let normalOffset = 1;

  for (const mesh of prepared.meshes) {
    objLines.push(`o ${mesh.name}`);

    const vertCount = mesh.positions.length / 3;
    for (let i = 0; i < vertCount; i++) {
      const x = fmt(mesh.positions[i * 3]);
      const y = fmt(mesh.positions[i * 3 + 1]);
      const z = fmt(mesh.positions[i * 3 + 2]);
      objLines.push(`v ${x} ${y} ${z}`);
    }

    const uvCount = mesh.uvs.length / 2;
    for (let i = 0; i < uvCount; i++) {
      const u = fmt(mesh.uvs[i * 2]);
      const v = fmt(mesh.uvs[i * 2 + 1]);
      objLines.push(`vt ${u} ${v}`);
    }

    const normCount = mesh.normals.length / 3;
    for (let i = 0; i < normCount; i++) {
      const nx = fmt(mesh.normals[i * 3]);
      const ny = fmt(mesh.normals[i * 3 + 1]);
      const nz = fmt(mesh.normals[i * 3 + 2]);
      objLines.push(`vn ${nx} ${ny} ${nz}`);
    }

    if (options.includeMaterials && prepared.materials[mesh.materialIndex]) {
      objLines.push(`usemtl ${prepared.materials[mesh.materialIndex].name}`);
    }

    for (let i = 0; i + 2 < mesh.indices.length; i += 3) {
      const a = mesh.indices[i];
      const b = mesh.indices[i + 1];
      const c = mesh.indices[i + 2];

      const va = vertexOffset + a;
      const vb = vertexOffset + b;
      const vc = vertexOffset + c;

      const ta = uvOffset + a;
      const tb = uvOffset + b;
      const tc = uvOffset + c;

      const na = normalOffset + a;
      const nb = normalOffset + b;
      const nc = normalOffset + c;

      objLines.push(
        `f ${va}/${ta}/${na} ${vb}/${tb}/${nb} ${vc}/${tc}/${nc}`
      );
    }

    objLines.push('');
    vertexOffset += vertCount;
    uvOffset += uvCount;
    normalOffset += normCount;
  }

  const objContent = objLines.join('\n');

  const mtlLines: string[] = [
    `# Material Library exported by MeshShift 3D Converter`,
    '',
  ];

  for (const mat of prepared.materials) {
    const spec = Math.max(0.05, 1 - mat.roughness) * 0.6;
    const shininess = Math.max(2, Math.round((1 - mat.roughness) * 128));
    mtlLines.push(`newmtl ${mat.name}`);
    mtlLines.push(`Ka 0.15 0.15 0.15`);
    mtlLines.push(
      `Kd ${fmt(mat.color[0])} ${fmt(mat.color[1])} ${fmt(mat.color[2])}`
    );
    mtlLines.push(`Ks ${fmt(spec)} ${fmt(spec)} ${fmt(spec)}`);
    mtlLines.push(
      `Ke ${fmt(mat.emissive[0])} ${fmt(mat.emissive[1])} ${fmt(mat.emissive[2])}`
    );
    mtlLines.push(`Ns ${shininess}`);
    mtlLines.push(`d ${fmt(mat.opacity)}`);
    mtlLines.push(`illum 2`);
    if (mat.diffuseTextureName) {
      mtlLines.push(`map_Kd textures/${mat.diffuseTextureName}`);
    }
    if (mat.normalTextureName) {
      mtlLines.push(`map_Bump textures/${mat.normalTextureName}`);
    }
    if (mat.emissiveTextureName) {
      mtlLines.push(`map_Ke textures/${mat.emissiveTextureName}`);
    }
    if (mat.specularTextureName) {
      mtlLines.push(`map_Ns textures/${mat.specularTextureName}`);
    }
    if (mat.alphaTextureName) {
      mtlLines.push(`map_d textures/${mat.alphaTextureName}`);
    }
    mtlLines.push('');
  }
  const mtlContent = mtlLines.join('\n');

  if (!options.packageAsZip) {
    const blob = new Blob([objContent], { type: 'text/plain;charset=utf-8' });
    return {
      blob,
      filename: `${baseName}.obj`,
      includedFiles: [`${baseName}.obj`],
    };
  }

  const zip = new JSZip();
  const includedFiles: string[] = [`${baseName}.obj`];
  zip.file(`${baseName}.obj`, objContent);

  if (options.includeMaterials) {
    zip.file(mtlName, mtlContent);
    includedFiles.push(mtlName);
    for (const tex of prepared.textures) {
      zip.file(`textures/${tex.filename}`, tex.data);
      includedFiles.push(`textures/${tex.filename}`);
    }
  }

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  return {
    blob: zipBlob,
    filename: `${baseName}_obj.zip`,
    includedFiles,
  };
}
