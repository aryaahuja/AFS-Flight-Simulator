/* AFS Flight Simulator: small, dependency-free glTF 2.0 GLB reader for our static models.
   Requires the simulator's existing THREE global (r128). Supports embedded PNG, PBR,
   vertex colors, positions, UVs, normals, node transforms and indexed triangles.
   It intentionally does NOT implement every glTF extension or skinned animation. */
(function () {
  'use strict';
  async function loadAFSGLB(uri) {
    const response = await fetch(uri);
    if (!response.ok) throw new Error(`Asset ${uri}: HTTP ${response.status}`);
    const buf = await response.arrayBuffer();
    const dv = new DataView(buf);
    if (dv.getUint32(0, true) !== 0x46546c67 || dv.getUint32(4, true) !== 2) throw new Error('Not a glTF 2.0 GLB file: ' + uri);
    let cursor = 12, json = null, binaryStart = -1, binarySize = 0;
    while (cursor + 8 <= buf.byteLength) {
      const size = dv.getUint32(cursor, true), tag = dv.getUint32(cursor + 4, true);
      cursor += 8;
      if (tag === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, cursor, size)));
      else if (tag === 0x004e4942) { binaryStart = cursor; binarySize = size; }
      cursor += size;
    }
    if (!json || binaryStart < 0) throw new Error('Missing GLB JSON or binary chunk: ' + uri);
    const sizes = {5120:1,5121:1,5122:2,5123:2,5125:4,5126:4};
    const types = {5120:Int8Array,5121:Uint8Array,5122:Int16Array,5123:Uint16Array,5125:Uint32Array,5126:Float32Array};
    const elems = {SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16};
    function accessor(id) {
      const a = json.accessors[id];
      if (!a || a.sparse) throw Error('Unsupported GLB accessor');
      const bv = json.bufferViews[a.bufferView];
      const n = elems[a.type], T = types[a.componentType], itemBytes = sizes[a.componentType], count = a.count;
      const base = binaryStart + (bv.byteOffset || 0) + (a.byteOffset || 0), stride = bv.byteStride || n * itemBytes;
      if (base + stride * (count - 1) + n * itemBytes > binaryStart + binarySize) throw Error('Invalid GLB accessor range');
      const arr = new T(count * n);
      const read = {5120:'getInt8',5121:'getUint8',5122:'getInt16',5123:'getUint16',5125:'getUint32',5126:'getFloat32'}[a.componentType];
      for (let i=0; i<count; i++) for (let j=0; j<n; j++) arr[i*n+j] = dv[read](base + i*stride + j*itemBytes, true);
      return new THREE.BufferAttribute(arr,n,!!a.normalized);
    }
    async function decodeImage(index) {
      const spec = json.images[index], bv = json.bufferViews[spec.bufferView];
      const from = binaryStart+(bv.byteOffset||0);
      const blob = new Blob([buf.slice(from,from+bv.byteLength)], {type:spec.mimeType||'image/png'});
      let image;
      if (typeof createImageBitmap === 'function') image = await createImageBitmap(blob);
      else image = await new Promise((resolve,reject)=>{
        const url = URL.createObjectURL(blob), element = new Image();
        element.onload=()=>{URL.revokeObjectURL(url);resolve(element);};
        element.onerror=()=>{URL.revokeObjectURL(url);reject(Error('Texture image failed'));};
        element.src=url;
      });
      const texture = new THREE.Texture(image);
      texture.flipY = false;
      texture.encoding = THREE.sRGBEncoding;
      texture.wrapS = THREE.RepeatWrapping; texture.wrapT = THREE.RepeatWrapping;
      texture.needsUpdate = true;
      return texture;
    }
    const images = await Promise.all((json.images||[]).map((_,i)=>decodeImage(i)));
    const textures = (json.textures||[]).map(t=>images[t.source]||null);
    const materials = (json.materials||[]).map(m=>{
      const p = m.pbrMetallicRoughness || {}, f = p.baseColorFactor || [1,1,1,1];
      const ext = (m.extensions||{}).KHR_materials_clearcoat || {};
      return new THREE.MeshPhysicalMaterial({
        color:new THREE.Color(f[0],f[1],f[2]),
        map:p.baseColorTexture ? textures[p.baseColorTexture.index] : null,
        metalness:p.metallicFactor===undefined?1:p.metallicFactor,
        roughness:p.roughnessFactor===undefined?1:p.roughnessFactor,
        opacity:f[3],transparent:m.alphaMode==='BLEND',
        side:m.doubleSided?THREE.DoubleSide:THREE.FrontSide,
        clearcoat:ext.clearcoatFactor||0,clearcoatRoughness:ext.clearcoatRoughnessFactor||0.2,
        name:m.name||''
      });
    });
    const meshSpecs = json.meshes || [];
    function buildMesh(meshIndex) {
      const g = new THREE.Group(), m = meshSpecs[meshIndex]; g.name=m.name||'';
      for (const prim of m.primitives) {
        if ((prim.mode||4) !== 4) continue;
        const geo = new THREE.BufferGeometry();
        for (const [key,name] of [['POSITION','position'],['NORMAL','normal'],['TEXCOORD_0','uv'],['COLOR_0','color']])
          if (prim.attributes[key]!==undefined) geo.setAttribute(name,accessor(prim.attributes[key]));
        if (prim.indices!==undefined) geo.setIndex(accessor(prim.indices));
        if (!geo.getAttribute('normal')) geo.computeVertexNormals();
        const mat = materials[prim.material] || new THREE.MeshStandardMaterial({color:0xffffff,roughness:.88,metalness:0});
        const material = geo.getAttribute('color') ? mat.clone() : mat;
        if (geo.getAttribute('color')) {material.vertexColors = true;material.color.set(0xffffff);material.metalness=.04;material.roughness=.9;}
        const item = new THREE.Mesh(geo,material);
        item.name = m.name || '';
        item.receiveShadow = true;
        item.castShadow = !uri.includes('scenery');
        g.add(item);
      }
      return g;
    }
    function node(id) {
      const n = json.nodes[id];const out = n.mesh===undefined ? new THREE.Group() : buildMesh(n.mesh);
      out.name = n.name || out.name;
      if (n.matrix) out.applyMatrix4(new THREE.Matrix4().fromArray(n.matrix));
      else {
        if (n.translation) out.position.fromArray(n.translation);
        if (n.rotation) out.quaternion.fromArray(n.rotation);
        if (n.scale) out.scale.fromArray(n.scale);
      }
      for (const child of (n.children||[])) out.add(node(child));
      return out;
    }
    const root = new THREE.Group();
    const spec = json.scenes?.[json.scene||0];
    for (const index of (spec?.nodes||[])) root.add(node(index));
    root.name = uri.split('/').pop();
    return root;
  }
  window.loadAFSGLB = loadAFSGLB;
})();
