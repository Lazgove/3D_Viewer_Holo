self.onmessage = function(event) {
    // Access the data sent from the main thread
    const { url, fileType } = event.data;

    console.log('Received URL:', url);
    console.log('Received File Type:', fileType);

    // Perform some task with the parameters
    const result = `Processed ${fileType} from ${url}`;

    // Send the result back to the main thread
    self.postMessage(result);
};

<script defer src="https://cdn.jsdelivr.net/npm/@finsweet/attributes-rangeslider@1/rangeslider.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.11.5/gsap.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/fflate@0.7.4/umd/index.js"></script>
<script src="https://cdn.jsdelivr.net/npm/dat.gui/build/dat.gui.min.js"></script>
<script src="https://cdn.skypack.dev/three@0.132.0/build/three.module.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.132.0/build/three.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.132.0/examples/js/controls/OrbitControls.min.js"></script>
<script src="https://unpkg.com/three@0.132.0/examples/js/loaders/GLTFLoader.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.132.0/examples/js/exporters/GLTFExporter.js"></script>
<script src="https://unpkg.com/three@0.132.0/examples/js/loaders/FBXLoader.js"></script>
<script src="https://unpkg.com/three@0.132.0/examples/js/loaders/OBJLoader.js"></script>
<script src="https://unpkg.com/three@0.132.0/examples/js/loaders/PLYLoader.js"></script>
<script src="https://unpkg.com/three@0.132.0/examples/js/loaders/STLLoader.js"></script>
<script src="https://unpkg.com/three@0.132.0/examples/js/loaders/MTLLoader.js"></script>
<script src="https://cdn.jsdelivr.net/npm/occt-import-js@0.0.12/dist/occt-import-js.js"></script>
<script src="https://lazgove.github.io/3D_viewer/occt-import-js.wasm"></script>

const wasmUrl = 'https://cdn.jsdelivr.net/npm/occt-import-js@0.0.12/dist/occt-import-js.wasm';

const group = new THREE.Group();
const urls = file.split(',');
const textureUrlsList = textureUrlsS3.split(',');

for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const textureUrls = textureUrlsList[i];

    try {
        const model = await loadModel(url, fileType);
                       model.traverse((child) => {
          if (child.isMesh) {
              child.castShadow = true;
              child.receiveShadow = true;
          }
      });
        const finalModel = model;
        applyMaterialToMeshModel(finalModel, textureUrlsList);

        group.add(finalModel);
    } catch (error) {
        console.error(`Error loading model from ${url}:`, error);
      }
}

self.postMessage(group);

function applyMaterialToMeshModel(model, textureUrls) {
    const hasUVs = model.geometry && model.geometry.attributes.uv;
    let materialPBR;
    if (textureUrls.length > 0 && hasUVs) {
        materialPBR = createPBRMaterial(textureUrls);
        model.traverse((child) => {
          if (child.isMesh) {
              console.log(child.name);
              child.material = materialPBR;
              child.material.needsUpdate = true;
          }
      });
    } 
}

async function initializeOcct() {
    if (!occtInitialized) {
      occt = await occtimportjs({
        locateFile: () => wasmUrl,
      });
      occtInitialized = true;
    }
  }
  
  async function LoadStep(fileUrl) {
    await initializeOcct();
    const response = await fetch(fileUrl);
    const buffer = await response.arrayBuffer();
    const fileBuffer = new Uint8Array(buffer);
    const result = occt.ReadStepFile(fileBuffer);
    const targetObject = new THREE.Object3D();
    
    for (let i = 0; i < result.meshes.length; i++) {
      const resultMesh = result.meshes[i];
      const positionArray = new Float32Array(resultMesh.attributes.position.array);
      const indexArray = new Uint16Array(resultMesh.index.array);

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positionArray, 3));
      if (resultMesh.attributes.normal) {
        const normalArray = new Float32Array(resultMesh.attributes.normal.array);
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normalArray, 3));
      }
      geometry.setIndex(new THREE.BufferAttribute(indexArray, 1));

      let color;
      if (resultMesh.color && resultMesh.color.length === 3) {
        const [r, g, b] = resultMesh.color;
        color = new THREE.Color(
          r <= 1 ? r : r / 255,
          g <= 1 ? g : g / 255,
          b <= 1 ? b : b / 255
        );
      } else if (resultMesh.layer && resultMesh.layer.color) {
        const [r, g, b] = resultMesh.layer.color;
        color = new THREE.Color(r / 255, g / 255, b / 255);
      } else if (resultMesh.group && resultMesh.group.color) {
        const [r, g, b] = resultMesh.group.color;
        color = new THREE.Color(r / 255, g / 255, b / 255);
      } else if (resultMesh.material && resultMesh.material.color) {
        const [r, g, b] = resultMesh.material.color;
        color = new THREE.Color(r / 255, g / 255, b / 255);
      } else {
        color = new THREE.Color(0xcccccc);
      }

      const opacity = resultMesh.opacity !== undefined ? resultMesh.opacity : 1.0;

      const material = new THREE.MeshStandardMaterial({
        color: color,
        transparent: opacity < 1.0,
        opacity: opacity,
        roughness: 0.5,
        metalness: 0.0,
      });

      material.polygonOffset = true;
      material.polygonOffsetFactor = 1;
      material.polygonOffsetUnits = 1;

      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = resultMesh.name || `Part ${i + 1}`;

      targetObject.add(mesh);
    }

    return targetObject;
}

async function loadModel(file, fileType) {
    const fileTypeLower = fileType.toLowerCase();
    if (fileTypeLower === 'step' || fileTypeLower === 'stp') {
      const mainObject = await LoadStep(file);
      return mainObject;
    }
    const loader = loaders[fileType.toLowerCase()];
    if (!loader) throw new Error(`Unsupported file type: ${fileType}`);

    if (fileTypeLower === 'gltf' || fileTypeLower === 'glb') {
        const gltf = await loader.loadAsync(file);

        if (gltf.animations && gltf.animations.length > 0) {
            const mixer = new AnimationMixer(gltf.scene);
            gltf.animations.forEach((clip) => mixer.clipAction(clip).play());
            gltf.scene.userData.mixer = mixer;
        }
        
        return gltf.scene;
    }
    console.log("loader");
    console.log(loader);
    const model = await loader.loadAsync(file);
    return (fileTypeLower === 'stp' || fileTypeLower === 'step'|| fileTypeLower === 'stl' || fileTypeLower === 'ply')
        ? applyBasicMaterial(model)
        : model;
}
