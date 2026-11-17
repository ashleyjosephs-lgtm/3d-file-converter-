import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { disposeObject3D } from './gltfLoader';

export interface SampleModelDef {
  id: string;
  name: string;
  filename: string;
  category: string;
  summary: string;
}

export const SAMPLE_MODELS: SampleModelDef[] = [
  {
    id: 'gear-hub',
    name: 'Planetary Gear Hub',
    filename: 'planetary_gear_hub.glb',
    category: 'Mechanical CAD',
    summary: 'Multi-part machined housing with beveled spur ring and anodized collar.',
  },
  {
    id: 'pavilion',
    name: 'Modernist Pavilion',
    filename: 'modernist_pavilion.glb',
    category: 'Architecture',
    summary: 'Stepped travertine plinth, cedar louver fins, steel columns, and roof canopy.',
  },
  {
    id: 'amphora',
    name: 'Fluted Ceramic Vessel',
    filename: 'fluted_ceramic_vessel.glb',
    category: 'Industrial Design',
    summary: 'Lathed ceramic body with twin swept handles and brushed bronze rim.',
  },
];

function createMachinedRingShape(
  outerR: number,
  innerR: number,
  teeth: number
): THREE.Shape {
  const shape = new THREE.Shape();
  const steps = teeth * 4;
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * Math.PI * 2;
    const phase = i % 4;
    const r = phase === 1 || phase === 2 ? outerR + 0.08 : outerR;
    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  const hole = new THREE.Path();
  hole.absarc(0, 0, innerR, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  return shape;
}

function buildPlanetaryGearHub(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'PlanetaryGearHub';

  const steelMat = new THREE.MeshStandardMaterial({
    name: 'BrushedSteel',
    color: 0xb8c0cc,
    metalness: 0.88,
    roughness: 0.24,
  });

  const darkAlloyMat = new THREE.MeshStandardMaterial({
    name: 'AnodizedGraphite',
    color: 0x2b313b,
    metalness: 0.72,
    roughness: 0.42,
  });

  const cobaltMat = new THREE.MeshStandardMaterial({
    name: 'CobaltAnodizedTrim',
    color: 0x2563eb,
    metalness: 0.82,
    roughness: 0.2,
  });

  // 1. Base mounting flange
  const flange = new THREE.Mesh(
    new THREE.CylinderGeometry(1.05, 1.12, 0.16, 48),
    darkAlloyMat
  );
  flange.name = 'MountingFlange';
  flange.position.y = 0.08;
  group.add(flange);

  // 2. Main toothed outer gear ring (ExtrudeGeometry)
  const gearShape = createMachinedRingShape(0.86, 0.56, 20);
  const gearGeo = new THREE.ExtrudeGeometry(gearShape, {
    depth: 0.36,
    bevelEnabled: true,
    bevelThickness: 0.03,
    bevelSize: 0.025,
    bevelSegments: 2,
  });
  gearGeo.rotateX(-Math.PI / 2);
  const gearMesh = new THREE.Mesh(gearGeo, steelMat);
  gearMesh.name = 'SpurGearRing';
  gearMesh.position.y = 0.18;
  group.add(gearMesh);

  // 3. Central drive spindle
  const spindle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.24, 0.24, 0.92, 32),
    steelMat
  );
  spindle.name = 'DriveSpindle';
  spindle.position.y = 0.46;
  group.add(spindle);

  // 4. Anodized retention collar
  const collar = new THREE.Mesh(
    new THREE.TorusGeometry(0.42, 0.065, 16, 40),
    cobaltMat
  );
  collar.name = 'RetentionCollar';
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 0.62;
  group.add(collar);

  // 5-10. Six perimeter hex bolts
  const boltGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.08, 6);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const bolt = new THREE.Mesh(boltGeo, darkAlloyMat);
    bolt.name = `PerimeterBolt_${i + 1}`;
    bolt.position.set(Math.cos(a) * 0.92, 0.18, Math.sin(a) * 0.92);
    group.add(bolt);
  }

  return group;
}

function buildModernistPavilion(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'ModernistPavilion';

  const stoneMat = new THREE.MeshStandardMaterial({
    name: 'TravertinePlinth',
    color: 0xd9d4c9,
    metalness: 0.05,
    roughness: 0.82,
  });

  const cedarMat = new THREE.MeshStandardMaterial({
    name: 'WarmCedarTimber',
    color: 0x9c6644,
    metalness: 0.02,
    roughness: 0.68,
  });

  const steelMat = new THREE.MeshStandardMaterial({
    name: 'ArchitecturalSteel',
    color: 0x262c36,
    metalness: 0.78,
    roughness: 0.34,
  });

  const glassMat = new THREE.MeshStandardMaterial({
    name: 'CurtainWallGlass',
    color: 0x9ec5db,
    metalness: 0.15,
    roughness: 0.1,
    transparent: true,
    opacity: 0.55,
  });

  // 1. Stepped plinth
  const plinth = new THREE.Mesh(
    new THREE.BoxGeometry(2.8, 0.16, 2.0),
    stoneMat
  );
  plinth.name = 'TravertinePlinth';
  plinth.position.y = 0.08;
  group.add(plinth);

  // 2. Cantilevered roof slab
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(3.0, 0.14, 2.15),
    steelMat
  );
  roof.name = 'CantileverRoof';
  roof.position.set(0.08, 1.38, 0);
  group.add(roof);

  // 3-6. Four structural steel columns
  const colGeo = new THREE.BoxGeometry(0.09, 1.18, 0.09);
  const colPositions: [number, number][] = [
    [-1.15, -0.78],
    [1.15, -0.78],
    [-1.15, 0.78],
    [1.15, 0.78],
  ];
  colPositions.forEach(([x, z], idx) => {
    const col = new THREE.Mesh(colGeo, steelMat);
    col.name = `SteelColumn_${idx + 1}`;
    col.position.set(x, 0.75, z);
    group.add(col);
  });

  // 7. Glazed core enclosure
  const glassCore = new THREE.Mesh(
    new THREE.BoxGeometry(1.75, 1.12, 1.25),
    glassMat
  );
  glassCore.name = 'GlazedPavilionCore';
  glassCore.position.set(-0.22, 0.72, 0);
  group.add(glassCore);

  // 8-12. Vertical cedar louver screen
  const finGeo = new THREE.BoxGeometry(0.05, 1.14, 0.18);
  for (let i = 0; i < 5; i++) {
    const fin = new THREE.Mesh(finGeo, cedarMat);
    fin.name = `CedarLouver_${i + 1}`;
    fin.position.set(0.86, 0.73, -0.52 + i * 0.26);
    group.add(fin);
  }

  return group;
}

function buildFlutedCeramicVessel(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'FlutedCeramicVessel';

  const ceramicMat = new THREE.MeshStandardMaterial({
    name: 'MattePorcelain',
    color: 0xe6e4de,
    metalness: 0.04,
    roughness: 0.48,
  });

  const bronzeMat = new THREE.MeshStandardMaterial({
    name: 'BrushedBronzeTrim',
    color: 0x9b7a4b,
    metalness: 0.85,
    roughness: 0.28,
  });

  const slateBaseMat = new THREE.MeshStandardMaterial({
    name: 'SlateDisplayBase',
    color: 0x2d333d,
    metalness: 0.15,
    roughness: 0.72,
  });

  // 1. Display plinth
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.72, 0.78, 0.12, 48),
    slateBaseMat
  );
  base.name = 'DisplayPlinth';
  base.position.y = 0.06;
  group.add(base);

  // 2. Lathe vessel body
  const pts = [
    new THREE.Vector2(0.0, 0.12),
    new THREE.Vector2(0.32, 0.12),
    new THREE.Vector2(0.28, 0.22),
    new THREE.Vector2(0.56, 0.56),
    new THREE.Vector2(0.62, 0.94),
    new THREE.Vector2(0.42, 1.28),
    new THREE.Vector2(0.26, 1.48),
    new THREE.Vector2(0.31, 1.68),
    new THREE.Vector2(0.25, 1.68),
    new THREE.Vector2(0.21, 1.48),
  ];
  const lathe = new THREE.Mesh(new THREE.LatheGeometry(pts, 48), ceramicMat);
  lathe.name = 'CeramicBody';
  group.add(lathe);

  // 3. Bronze neck collar
  const neckRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.28, 0.032, 16, 40),
    bronzeMat
  );
  neckRing.name = 'BronzeNeckRing';
  neckRing.rotation.x = Math.PI / 2;
  neckRing.position.y = 1.48;
  group.add(neckRing);

  // 4-5. Twin swept handles (TubeGeometry)
  for (const side of [-1, 1]) {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.27, 1.44, 0),
      new THREE.Vector3(side * 0.66, 1.36, 0),
      new THREE.Vector3(side * 0.72, 1.02, 0),
      new THREE.Vector3(side * 0.56, 0.84, 0),
    ]);
    const handle = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 24, 0.038, 12, false),
      ceramicMat
    );
    handle.name = side === -1 ? 'LeftHandle' : 'RightHandle';
    group.add(handle);
  }

  return group;
}

export async function generateSampleGlbBuffer(
  sampleId: string
): Promise<ArrayBuffer> {
  let group: THREE.Group;
  switch (sampleId) {
    case 'pavilion':
      group = buildModernistPavilion();
      break;
    case 'amphora':
      group = buildFlutedCeramicVessel();
      break;
    case 'gear-hub':
    default:
      group = buildPlanetaryGearHub();
      break;
  }

  const exporter = new GLTFExporter();
  try {
    const result = await new Promise<ArrayBuffer>((resolve, reject) => {
      exporter.parse(
        group,
        (output) => {
          if (output instanceof ArrayBuffer) {
            resolve(output);
          } else {
            reject(new Error('Expected binary GLB ArrayBuffer from GLTFExporter.'));
          }
        },
        (err) => reject(err instanceof Error ? err : new Error(String(err))),
        { binary: true }
      );
    });
    return result;
  } finally {
    disposeObject3D(group);
  }
}
