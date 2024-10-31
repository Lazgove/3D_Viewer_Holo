document.addEventListener('DOMContentLoaded', () => {

  // ######            ######
  // ######    INIT    ######
  // ######            ######

  // Initialize Three.js Scene
  let scene, camera, renderer, objLoader, mtlLoader, gltfLoader, controls, currentModel, mixer, exploded = false, isGLTF=false;
  let distanceValue = 0;
  let previousDistanceValue = 0;
  const wasmUrl = 'https://cdn.jsdelivr.net/npm/occt-import-js@0.0.12/dist/occt-import-js.wasm';


  const viewerElement = document.getElementById('3d-viewer');
  const resizable = document.querySelector('.resizable');
  const selectbox = document.querySelector('#objects');
  const animationSelect = document.getElementById('animations');
  const models = document.querySelectorAll('.model');
  const autoRotateCheckbox = document.getElementById('auto-rotate');
  const cotationCheckbox = document.getElementById('cotationCheckbox');
  const blackModeCheckbox = document.getElementById('blackMode');
  const repereCheckbox = document.getElementById('repereCheckbox');

  const textureLoader = new THREE.TextureLoader();

  // PBR texture maps with alternate names and actual map keys
  const PBR_MAPS = {
    map: ["albedo", "basecolor", "base_color", "diffuse", "color"],                // Base color or albedo map
    metalnessMap: ["metalness", "metallic"],                                       // Metalness map
    roughnessMap: ["roughness", "rough"],                                          // Roughness map
    specularMap: ["specular", "spec"],                                             // Specular map (for non-metallic highlights)
    normalMap: ["normal", "normalmap", "normals"],                                 // Normal map
    aoMap: ["ambientocclusion", "ao", "occlusion"],                                // Ambient occlusion map
    displacementMap: ["height", "displacement", "disp", "bump"],                   // Height or displacement map
    emissiveMap: ["emissive", "emission", "selfillumination", "self_illumination"],// Emissive map
    alphaMap: ["opacity", "alpha", "transparency"],                                // Opacity map (for transparency)
    glossinessMap: ["glossiness", "gloss"],                                        // Glossiness map (for smoothness in some workflows)
    clearcoatMap: ["clearcoat", "clear_coat"],                                     // Clear coat map
    clearcoatRoughnessMap: ["clearcoat_roughness", "clearcoatroughness"],          // Clear coat roughness map
    sheenColorMap: ["sheen"],                                                      // Sheen color map
    anisotropyMap: ["anisotropy", "anisotropic", "anisotropydirection", "anisotropic_direction"] // Anisotropy map
  };


  const loaders = {
      fbx: new THREE.FBXLoader(),
      obj: new THREE.OBJLoader(),
      stl: new THREE.STLLoader(),
      ply: new THREE.PLYLoader(),
      gltf: new THREE.GLTFLoader(),
      //step: new THREE.BrepLoader()
    };
    
  //const exporter = new THREE.GLTFExporter();

  
  let rotationSpeed = 0;
  let explosionDist = 0; 
  let isResizing = false;
  let currentHandle = null;
  let targetSpeed = 20;
  let easingFactor = 0.05;
  let isEasing = false;
  let isRotating = true;
  let textMeshes = [];
  let occtInitialized = false;
  let occt;
  const distanceScaleFactor = 3;
  const smoothFactor = 0.05;  // Adjust this value between 0 and 1 for smoothness (higher = faster)

  // Add resize event listener
  window.addEventListener('resize', onResize);
  // Define a temporary vector to store the target camera position
  const targetPosition = new THREE.Vector3();

  const textureMap = new Map();
  const texturePaths = {
      albedo: null,
      normal: null,
      roughness: null,
      metalness: null,
      ao: null,
      height: null,
      emissive: null,
      alpha: null
    };

  function init3DViewer() {
    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(50, resizable.clientWidth / resizable.clientHeight, 0.01, 5000);
    camera.position.set(0, 0, 15);
    camera.near = 0.01;
    camera.lookAt(new THREE.Vector3(0, 0, 0));
    camera.updateProjectionMatrix();
    //const axesHelper = new THREE.AxesHelper(5);
    //scene.add(axesHelper);

    renderer = new THREE.WebGLRenderer({antialias: true });
    renderer.setSize(resizable.clientWidth, resizable.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    viewerElement.appendChild(renderer.domElement);

    //textureLoader = new THREE.TextureLoader();
    controls = new THREE.OrbitControls( camera, renderer.domElement );
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.enablePan = false;

    models.forEach((el) => {
      let option = document.createElement('option');
      const objectLink = el.getAttribute('data-link');
      const mtlLink = el.getAttribute('data-mtl');
      const animationLink = el.getAttribute('data-animation_url');
      const textureLink = el.getAttribute('data-textures');

      if (objectLink) {
          option.text = el.innerText.trim();
          option.value = objectLink;
          option.setAttribute('data-mtl', mtlLink);
          option.setAttribute('data-animation_url', animationLink);
          option.setAttribute('data-textures', textureLink);
          selectbox.add(option);
          }
      });
    
    animationSelect.style.display = 'none';

    const nullObject = new THREE.Object3D();
    nullObject.position.set(0, 0, 0);
    nullObject.name = "nullObject";
    scene.add(nullObject);

    const geometry = new THREE.PlaneGeometry(10000, 10000);
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 1 });
    const plane = new THREE.Mesh(geometry, material);
    plane.position.z = -50;
    plane.receiveShadow = true;
    plane.name = "planeBG";
    plane.material.opacity = 0;
    scene.add(plane);

    add3PointLighting();

    const maskGeometry = new THREE.PlaneGeometry(2, 2);
    const maskMaterial = new THREE.ShaderMaterial({
        uniforms: {
            resolution: { value: new THREE.Vector2(resizable.clientWidth, resizable.clientHeight) },
            radiusX: { value: 0.45 },
            radiusY: { value: 0.45 },
            edgeFade: { value: 0.1 },
        },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform vec2 resolution;
            uniform float radiusX; // Horizontal radius
            uniform float radiusY; // Vertical radius
            uniform float edgeFade;
            varying vec2 vUv;

            void main() {
                // Normalize coordinates to fit the canvas
                vec2 uv = (vUv - 0.5) * vec2(resolution.x / resolution.y, 1.0); // Maintain aspect ratio
                //vec2 uv = (vUv - 0.5) * vec2(1.0, 1.0);
                // Adjusted distance calculation for the oval shape
                float dist = length(vec2(uv.x / radiusX, uv.y / radiusY)); // Scale by radii

                // Calculate fade region using smoothstep for soft edges
                float oval = smoothstep(1.0 - edgeFade, 1.0 + edgeFade, dist);

                // Inside the oval is visible (transparent), outside is black with smooth fade
                gl_FragColor = vec4(0.0, 0.0, 0.0, oval);
            }
        `,
        transparent: true,
      });

      const maskQuad = new THREE.Mesh(maskGeometry, maskMaterial);
      maskQuad.name = "maskQuad";
      maskQuad.visible = true;
      scene.add(maskQuad);

      const maskGeometrySquare = new THREE.PlaneGeometry(2, 2);
      const maskMaterialSquare = new THREE.ShaderMaterial({
          uniforms: {
              resolution: { value: new THREE.Vector2(resizable.clientWidth, resizable.clientHeight) },
              squareSize: { value: 0.99 },
              borderThickness: { value: 0.01 },
              borderColor: { value: new THREE.Color(1.0, 0.0, 0.0) }
          },
          vertexShader: `
              varying vec2 vUv;
              void main() {
                  vUv = uv;
                  gl_Position = vec4(position, 1.0);
              }
          `,
          fragmentShader: `
              uniform vec2 resolution;
              uniform float squareSize;
              uniform float borderThickness;
              uniform vec3 borderColor;
              varying vec2 vUv;

              void main() {
                  // Normalize coordinates to fit the canvas
                  vec2 uv = (vUv - 0.5) * vec2(resolution.x / resolution.y, 1.0); // Maintain aspect ratio

                  // Calculate square bounds
                  float halfSize = squareSize / 2.0;  // Half the size of the square
                  float halfThickness = borderThickness / 2.0; // Half thickness for the border

                  // Check if the current pixel is within the border area
                  bool insideBorder = (
                      (uv.x > -halfSize - halfThickness && uv.x < -halfSize + halfThickness && uv.y > -halfSize && uv.y < halfSize) || // Left border
                      (uv.x > halfSize - halfThickness && uv.x < halfSize + halfThickness && uv.y > -halfSize && uv.y < halfSize) || // Right border
                      (uv.y > -halfSize - halfThickness && uv.y < -halfSize + halfThickness && uv.x > -halfSize && uv.x < halfSize) || // Bottom border
                      (uv.y > halfSize - halfThickness && uv.y < halfSize + halfThickness && uv.x > -halfSize && uv.x < halfSize)    // Top border
                  );

                  if (insideBorder) {
                      // Inside the border area: color it with the border color
                      gl_FragColor = vec4(borderColor, 1.0); // Opaque border color
                  } else {
                      // Outside the square and border: fully transparent
                      gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
                  }
              }
          `,
          transparent: true,
      });

      const maskQuadSquare = new THREE.Mesh(maskGeometrySquare, maskMaterialSquare);
      maskQuadSquare.name = "maskQuadSquare";
      maskQuadSquare.visible = false;
      scene.add(maskQuadSquare);

    setInterval(startExplosionAndAdjustCamera, 100);
    //loadFBX('https://s3-webflow-bucket.s3.eu-west-3.amazonaws.com/Scene_Objects/S_Curve.fbx');
    //loadHDRI(hdriFiles[0]);
    easeInRotation();
    animate();
    onResize();

  }

  // Handle window resize to keep the canvas responsive
  function onResize() {
    // Update renderer size
    const width = resizable.clientWidth;
    const height = resizable.clientHeight;
    renderer.setSize(width, height);
    scene.getObjectByName('maskQuad').material.uniforms.resolution.value.set(width, height);
    scene.getObjectByName('maskQuadSquare').material.uniforms.resolution.value.set(width, height);

    
    // Update camera aspect ratio and projection matrix
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  // ######                      ######
  // ######    CUSTOM CLASSES    ######
  // ######                      ######
    
  class ModelWrapper {
    constructor(model, isGLTF=false) {
      if (isGLTF) {
        this.model = model.scene;
      }
      else {
        this.model = model;
      }
      console.log(this.model.type);
      this.updatedBoundingBox = new THREE.Box3();
      this.center = new THREE.Vector3(0, 0, 0);
      this.pieceCenters = [];
      this.directionVectors = [];
      this.originalPositions = [];
      this.maxDistance = 0;
      this.model.castShadow = true;

      if (this.model.rotation.x === -Math.PI / 2) {
        this.pointingAxis = 'z';
        console.log("The model was likely Z-up and was rotated to fit Y-up.");
      } else if (this.model.rotation.x === 0) {
        this.pointingAxis = 'y';
        console.log("The model is Y-up by default.");
      }

      this.boundingBox = new THREE.Box3().setFromObject(this.model, true);
      this.centerBbox = this.boundingBox.getCenter(new THREE.Vector3());
      this.size = this.boundingBox.getSize(new THREE.Vector3());
      this.model.position.sub(this.centerBbox);
      //this.applyMaterialToModel();
      this.createBoundingBoxMesh();
      this.computeChildrenBoundingBox();
      this.createBoundingBoxesAndAnnotations();
    }

    createBoundingBoxMesh() {
      const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
      const boxMaterial = new THREE.LineBasicMaterial({ color: 0xff0000 });
      const boundingBoxHelper = new THREE.LineSegments(
          new THREE.EdgesGeometry(boxGeometry),
          boxMaterial
      );

      boundingBoxHelper.name = 'boundingBoxHelper';
      boundingBoxHelper.scale.set(this.size.x, this.size.y, this.size.z);
      if (cotationCheckbox.checked) {
        boundingBoxHelper.visible = true;
      } else {
        boundingBoxHelper.visible = false;
      }
      boundingBoxHelper.userData.isAnnotation = true;
      this.model.add(boundingBoxHelper);
      boundingBoxHelper.position.set(this.centerBbox.x, this.centerBbox.y, this.centerBbox.z);
    }

    createBoundingBoxesAndAnnotations() {

      const objectHeight = getObjectHeight(this.model);
      this.createDoubleSidedArrow(
          new THREE.Vector3(this.boundingBox.min.x, this.boundingBox.min.y, this.boundingBox.min.z),
          new THREE.Vector3(this.boundingBox.max.x, this.boundingBox.min.y, this.boundingBox.min.z),
          `${this.size.x.toFixed(2)} cm`,
          objectHeight
      );

      this.createDoubleSidedArrow(
          new THREE.Vector3(this.boundingBox.max.x, this.boundingBox.min.y, this.boundingBox.min.z),
          new THREE.Vector3(this.boundingBox.max.x, this.boundingBox.max.y, this.boundingBox.min.z),
          `${this.size.y.toFixed(2)} cm`,
          objectHeight
      );

      this.createDoubleSidedArrow(
          new THREE.Vector3(this.boundingBox.max.x, this.boundingBox.min.y, this.boundingBox.min.z),
          new THREE.Vector3(this.boundingBox.max.x, this.boundingBox.min.y, this.boundingBox.max.z),
          `${this.size.z.toFixed(2)} cm`,
          objectHeight
      );
    }

    createDoubleSidedArrow(startPoint, endPoint, label, objectHeight, color = 0x37b6ff, textSizePercent = 0.05) {

      const direction = new THREE.Vector3().subVectors(endPoint, startPoint).normalize();
      const reverseDirection = new THREE.Vector3().subVectors(startPoint, endPoint).normalize();
      const arrowLength = startPoint.distanceTo(endPoint);
      const arrowHelper1 = new THREE.ArrowHelper(direction, startPoint, arrowLength, color);
      arrowHelper1.userData.isAnnotation = true;
      if (cotationCheckbox.checked) {
        arrowHelper1.visible = true;
      } else {
        arrowHelper1.visible = false;
      }
      this.model.add(arrowHelper1);

      const arrowHelper2 = new THREE.ArrowHelper(reverseDirection, endPoint, arrowLength, color);
      arrowHelper2.userData.isAnnotation = true;
      if (cotationCheckbox.checked) {
        arrowHelper2.visible = true;
      } else {
        arrowHelper2.visible = false;
      }
      this.model.add(arrowHelper2);

      const loader = new THREE.FontLoader();
      loader.load(
          'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/fonts/helvetiker_regular.typeface.json',
          function (font) {
              const textSize = objectHeight * textSizePercent;
              const textGeometry = new THREE.TextGeometry(label, {
                  font: font,
                  size: textSize,
                  height: textSize * 0.2,
              });

              const textMaterial = new THREE.MeshBasicMaterial({ color });
              const textMesh = new THREE.Mesh(textGeometry, textMaterial);
              const midPoint = new THREE.Vector3().lerpVectors(startPoint, endPoint, 0.5);
              textMesh.position.copy(midPoint);
              textMesh.userData.isAnnotation = true;
              textMesh.userData.viewCam = true;
              if (cotationCheckbox.checked) {
                textMesh.visible = true;
              } else {
                textMesh.visible = false;
              }
              textMeshes.push(textMesh);
              currentModel.model.add(textMesh);
          },
          undefined,
          function (error) {
              console.error('Error loading font:', error);
          }
      );
    }

    computeChildrenBoundingBox() {
      const currentBoundingBox = new THREE.Box3().setFromObject(this.model, true);
      const currentCenterBbox = currentBoundingBox.getCenter(new THREE.Vector3());
      this.maxDistance = Math.max(this.size.x, this.size.y, this.size.z);
      let index = 0;
      this.model.traverse((child) => {
          if (child.isMesh && child.geometry) {
            console.log(`hehe type: ${child.type} name: ${child.name}`);

            const boundingBoxChild = new THREE.Box3().setFromObject(child, true);
            const massCenterChild = boundingBoxChild.getCenter(new THREE.Vector3());
            console.log(`masscenter: ${massCenterChild.x}, ${massCenterChild.y}, ${massCenterChild.z}`);
            //console.log(`centerBox: ${currentCenterBbox.x}, ${currentCenterBbox.y}, ${currentCenterBbox.z}`);
            const direction = new THREE.Vector3().subVectors(massCenterChild.clone(), currentCenterBbox).normalize();
            console.log(`direction: ${direction.x}, ${direction.y}, ${direction.z}`);
            this.directionVectors.push(direction.clone());
            this.originalPositions.push(child.position.clone());
            index ++;
          }
      });

    }
    
    logProperties() {
      console.log('Bounding Box:', this.boundingBox);
      console.log('Center:', this.center);
      console.log('Size:', this.size);
    }

  }

  // ######                 ######
  // ######    Scene        ######
  // ######                 ######

  repereCheckbox.addEventListener('change', function () {
      console.log('hello');
      const repere = scene.getObjectByName("maskQuadSquare");
      if (this.checked && blackModeCheckbox.checked) {
          repere.visible = true;
      } else {
          repere.visible = false;
      }
    });

  function findMeshInGroup(group) {
    for (let i = 0; i < group.children.length; i++) {
        const child = group.children[i];
        if (child instanceof THREE.Mesh) {
            console.log("Found a Mesh:", child);
            return child;
        }
    }

    console.log("No Mesh found in the group.");
    return null;
}

  blackModeCheckbox.addEventListener('change', function () {
    const plane = scene.getObjectByName('planeBG');
    const overlay = scene.getObjectByName("maskQuad");
    const overlaySquare = scene.getObjectByName("maskQuadSquare");
    if (this.checked) {
      plane.material.opacity = 0;
      overlay.visible = true;
      overlaySquare.visible = true;
    } else {
      plane.material.opacity = 1;
      overlay.visible = false;
      overlaySquare.visible = false;
    }
    plane.material.needsUpdate = true;
});

  function getHypotenuse(a, b) {
    return Math.sqrt(a * a + b * b);
  }

  function updatePlanePosition() {
    plane = scene.getObjectByName("planeBG");
    plane.position.copy(camera.position);
    const forward = new THREE.Vector3(0, 0, -1);
    forward.applyQuaternion(camera.quaternion);
    plane.position.add(forward.multiplyScalar(getHypotenuse(camera.position.x, camera.position.z) + currentModel.size.z*2));
    plane.lookAt(camera.position);
  }


  // #### LIGHTING ####

  function updateChildVisibility() {
    scene.getObjectByName('planeBG').traverse(function (child) {
        if (child.name != 'planeBG') {
          child.visible = true;
        }
    });
  }

  function createLight(x, y, z, intensity, name, hasShadow=false) {
    const light = new THREE.DirectionalLight(0xffffff, intensity);
    light.name = name;
    light.position.set(x, y, z);
    light.castShadow = hasShadow;
    light.shadow.mapSize.width = 2048*2;
    light.shadow.mapSize.height = 2048*2;
    light.shadow.bias = -0.005;
    light.shadow.camera.near = 0.1;
    light.shadow.camera.far = 1000;
    light.shadow.camera.left = -50;
    light.shadow.camera.right = 50;
    light.shadow.camera.top = 50;
    light.shadow.camera.bottom = -50;
    const center = new THREE.Vector3(0, 0, 0);
    light.lookAt(center);
    scene.getObjectByName("planeBG").add(light);
  }
  
  function updateLightPositions() {

    const offsetX = currentModel.size.x;
    const offsetY = currentModel.size.y;
    const offsetZ = currentModel.size.z;
    scene.getObjectByName("planeBG").getObjectByName("MainLight").position.set(offsetX*1, offsetY*1, offsetZ*4);
    scene.getObjectByName("planeBG").getObjectByName("FillLight").position.set(-offsetX*5, offsetY*2, offsetZ*5);
    scene.getObjectByName("planeBG").getObjectByName("BackLight").position.set(offsetX*0, offsetY*5, -offsetZ*5);
    scene.getObjectByName("planeBG").getObjectByName("BottomLight").position.set(offsetX*0, -offsetY*5, -offsetZ*0);
  }

  function add3PointLighting() {
    createLight(0, 0, 0, 1, "MainLight", true);
    createLight(0, 0, 0, 0.5, "FillLight");
    createLight(0, 0, 0, 0.3, "BackLight");
    createLight(0, 0, 0, 0.4, "BottomLight");
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.2);
    scene.add(ambientLight);
  }

  // #### RESET CAMERA VIEW ####
  document.getElementById('recenter-button').addEventListener('click', () => {
    if (currentModel) {
        focusOnObject();
    } else {
        console.log('No model loaded to recenter.');
    }
  });

  function focusOnObject() {

    // Set the camera to look at the center of the bounding box
    const maxDim = Math.max(currentModel.size.x, currentModel.size.y, currentModel.size.z);
    const fov = camera.fov * (Math.PI / 180); // Convert FOV from degrees to radians
    let cameraDistance = maxDim / (2 * Math.tan(fov / 2)); // Calculate camera distance from object

    // Offset the camera to ensure it doesn't clip through the object
    cameraDistance *= 1.5; // Adjust as needed for a bit more space

    // Set the camera position
    const direction = new THREE.Vector3(0, 0, cameraDistance); // Direction to move the camera along (e.g., from top-right)
    const center = new THREE.Vector3(0, 0, 0);
    camera.position.copy(center).add(direction);

    // Ensure the camera is looking at the center of the object
    camera.lookAt(center);

    // If using OrbitControls, make sure the controls are updated
    if (controls) {
        controls.target.copy(center); // Make sure controls orbit around the object
        controls.update(); // Apply the changes
    }
  }

  // ######                 ######
  // ######    ANIMATION    ######
  // ######                 ######

  // #### Animation loop ####
  function animate() {
    requestAnimationFrame(animate);
    if (mixer) mixer.update(0.01); // Update animations

    // Rotate the model if rotationSpeed is greater than 0
    if (currentModel) {
      updatePlanePosition();
      updateCameraAndControls();
      //currentModel.updateBoundingBoxRotation();
      if (currentModel.pointingAxis === 'y') {
        //alert('y');
        scene.getObjectByName('nullObject').rotation.y += (rotationSpeed * Math.PI / 180) * (1 / 60); // Convert speed to radians
      } else {
        //alert('z');
        scene.getObjectByName('nullObject').rotation.z += (rotationSpeed * Math.PI / 180) * (1 / 60); // Convert speed to radians
      }
    }
    
    scene.traverse((child) => {
      // Check if the object is a group and has bounding boxes or annotations
      if (child.userData.viewCam && child.userData.isAnnotation) {
        child.lookAt(camera.position); // Mark group for removal
      }
    });
    
    controls.update(); 
    renderer.render(scene, camera);
    }

  // #### ROTATION SPEED ####

  // Function to start/stop rotation with easing
  autoRotateCheckbox.addEventListener('change', function () {
    if (this.checked) {
      isRotating = true;
      easeInRotation(); // Ease in when checkbox is checked
    } else {
      isRotating = false;
      easeOutRotation(); // Ease out when checkbox is unchecked
    }
  });
  function easeInRotation() {
    isEasing = true;
    const easeIn = () => {
    if (rotationSpeed < targetSpeed && isRotating) {
        rotationSpeed += easingFactor * (targetSpeed - rotationSpeed);
        requestAnimationFrame(easeIn); 
    } else {
        rotationSpeed = targetSpeed; 
        isEasing = false;
      }
    };
    easeIn();
  }

  // Function to smoothly decrease the rotation speed (ease-out)
  function easeOutRotation() {
      isEasing = true;
      const easeOut = () => {
      if (rotationSpeed > 0 && !isRotating) {
          rotationSpeed -= easingFactor * rotationSpeed;
          requestAnimationFrame(easeOut);
      } else {
          rotationSpeed = 0;
          isEasing = false;
        }
      };
      easeOut();
  }

  function adjustCameraDistance() {
      const viewerHeight = window.innerHeight;  // Height of the viewer
      const radius = viewerHeight / 2;          // Desired radius of the circle
      const objectSize = currentModel.model.scale.length(); // Approximate size of the object
  
      // Ensure the camera is far enough so the object fits in the circle
      // Perspective camera uses field of view, so we need to adjust based on that
      const fov = camera.fov * (Math.PI / 180); // Convert FOV to radians
      const distance = (objectSize / 2) / Math.tan(fov / 2); 
  
      camera.position.set(0, 0, distance); // Move camera directly along the Z-axis
      camera.updateProjectionMatrix();     // Update camera projection
  }

// Function to animate the explosion and update camera controls
function startExplosionAndAdjustCamera(skip = false) {
  const explosionDistanceInput = parseFloat(document.getElementById('explosionDistance').innerText);

  // Return if the model doesn't exist or the explosion distance hasn't changed
  if (!currentModel || (previousDistanceValue === explosionDistanceInput && !skip)) {
      return;
  }

  previousDistanceValue = explosionDistanceInput;
  const height = currentModel.size ? currentModel.size.y : 0;
  const userDefinedDistance = (explosionDistanceInput / 100) * height;

  const directionVectors = currentModel.directionVectors || [];
  const originalPositions = currentModel.originalPositions || [];

  if (directionVectors.length !== originalPositions.length) {
      console.error("Mismatch between directionVectors and originalPositions lengths");
      return;
  }

  let index = 0;

  currentModel.model.traverse((child) => {
      if (child.isMesh && child.name !== '') {
          console.log(`type: ${child.type} name: ${child.name}`);

          if (index < directionVectors.length) {
              const direction = directionVectors[index].clone();
              const newPosition = originalPositions[index].clone().add(direction.multiplyScalar(userDefinedDistance));

              // Animate mesh explosion using GSAP
              gsap.to(child.position, {
                  x: newPosition.x,
                  y: newPosition.y,
                  z: newPosition.z,
                  duration: 0.5,
                  ease: "power2.out",
                  //onUpdate: adjustCameraDistance
              });
              index++;
          } else {
              console.error(`Index ${index} exceeds directionVectors array length`);
          }
      }
  });
  //updateMinDistanceBasedOnBoundingBox();
  // Once the explosion is complete, update the camera's minDistance smoothly
  //gsap.delayedCall(0.1, updateMinDistanceBasedOnBoundingBox);
}

  // ######                 ######
  // ######    COTATION     ######
  // ######                 ######

  cotationCheckbox.addEventListener('change', function() {
    scene.traverse((child) => {
      if (child.userData.isAnnotation) {
        if (this.checked) {
          child.visible = true;
        } 
        else {
          child.visible = false;
        }
      }
    });
  });

  // Function to calculate object height based on its bounding box
  function getObjectHeight(object) {
    const box = new THREE.Box3().setFromObject(object);
    return box.max.y - box.min.y;
  }

  function clearPreviousAnnotations() {
      const toRemove = [];
      scene.traverse((child) => {
          // Check if the object is a group and has bounding boxes or annotations
          if (child.userData.isAnnotation) {
              toRemove.push(child); // Mark group for removal
          }
      });

      // Remove all marked groups from the scene
      toRemove.forEach(child => {
          scene.remove(child);
      });

      annotations = []; // Clear the stored annotations array
  }


  // ######                 ######
  // ######    DROPDOWN     ######
  // ######                 ######
  // When the dropdown changes, load the selected model
  selectbox.addEventListener('change', () => {
      const modelFile = selectbox.value;
      const mtlFile = selectbox.options[selectbox.selectedIndex].getAttribute('data-mtl'); // Get the MTL URL
      const animationsFiles = selectbox.options[selectbox.selectedIndex].getAttribute('data-animation_url'); // Get the GLTF URL
      const texturesFiles = selectbox.options[selectbox.selectedIndex].getAttribute('data-textures');

      // Remove existing model
      if (currentModel) {
          scene.getObjectByName('nullObject').remove(currentModel.model);
          currentModel = null;
          directionVectors = [];
          originalPositions = [];
      }

      // Parse animation files and populate animation select field
      if (animationsFiles) {
          parseAndPopulateAnimations(modelFile, animationsFiles, mtlFile, texturesFiles);
      } else {
          animationSelect.style.display = 'none';
          // Parse texture files and store them in the texturePaths
          if (texturesFiles && texturesFiles.size === 0) {
            console.log('texturesFiles file is empty, loading object without texture');
            handleModelLoading(modelFile, mtlFile, animationsFiles, texturesFiles);; // Passing null to indicate no texture
          } else {
            //parseTextureFiles(texturesFiles);
            handleModelLoading(modelFile, mtlFile, animationsFiles, texturesFiles); // Load with MTL if available and valid
          }
      }

      startExplosionAndAdjustCamera(true);
      
    });
  
  // Play the selected animation (GLTF/FBX supported)
  function playAnimation(animationUrl) {
    loadGLTF(animationUrl, false, false);
  }

  // Function to parse animations and populate the select field
  function parseAndPopulateAnimations(file, animationsFiles, mtlFile = null, texturesFiles = null) {
    let animationsArray = animationsFiles.split(',').map(link => link.trim());
    animationSelect.innerHTML = ''; // Clear previous options

    if (animationsArray.length > 0) {
        animationSelect.style.display = 'block'; // Show select field
        // Add "No Animation" option as the first choice
        const noAnimationOption = document.createElement('option');
        noAnimationOption.value = file;
        noAnimationOption.text = 'No Animation';
        animationSelect.appendChild(noAnimationOption);
        animationsArray.forEach((anim, index) => {
            let option = document.createElement('option');
            option.value = anim;
            option.text = `Animation ${index + 1}`;
            animationSelect.appendChild(option);
        });
    } else {
        animationSelect.style.display = 'none'; // Hide if no animations
    }

    // Auto-play the first animation if available
    if (animationsArray.length > 0) {
        handleModelLoading(file, mtlFile, animationsFiles, texturesFiles);
        //playAnimation(animationsArray[0]);
    }

    // Listen for animation selection change
    animationSelect.addEventListener('change', () => {
        // Remove existing model
        if (currentModel) {
          //alert('remove model animation change');
          scene.getObjectByName('nullObject').remove(currentModel.model);
          currentModel = null;
        }
        const selectedAnimation = animationSelect.value;
        if (animationSelect.selectedIndex === 0)
        {
          //alert('handle modelling');
          handleModelLoading(file, mtlFile, animationsFiles, texturesFiles);
        }
        else {
          //alert('play anim');
          playAnimation(selectedAnimation);
        }
    });
  }

  // ######                 ######
  // ######    IMPORTS      ######
  // ######                 ######

  // #### INFOS ####
  function getBasePath(url) {
    const parsedUrl = new URL(url);  // Parse the URL
    const path = parsedUrl.pathname; // Get the path from the URL
    const basePath = path.substring(0, path.lastIndexOf('/') + 1);  // Keep everything until the last "/"
    
    // Reconstruct the base URL with the protocol, host, and base path
    return `${parsedUrl.origin}${basePath}`;
  }
  
  // #### MULTIPLE FORMATS ####
  function handleModelLoading(file, mtlFile = null, animationsFiles = null, texturesFiles = null) {
    const extension = file.split('.').pop();
    console.log('texturefiles');
    console.log(texturesFiles);
    loadAndGroupModels(file, extension, texturesFiles);
    }

  // #### LOADERS ####

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
  
    for (const resultMesh of result.meshes) {
      const geometry = new THREE.BufferGeometry();
      const positionArray = new Float32Array(resultMesh.attributes.position.array);
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positionArray, 3));
  
      if (resultMesh.attributes.normal) {
        const normalArray = new Float32Array(resultMesh.attributes.normal.array);
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normalArray, 3));
      }
  
      const indexArray = new Uint16Array(resultMesh.index.array);
      geometry.setIndex(new THREE.BufferAttribute(indexArray, 1));
  
      const color = resultMesh.color 
        ? new THREE.Color(resultMesh.color[0], resultMesh.color[1], resultMesh.color[2])
        : 0xcccccc;
      
      const material = new THREE.MeshPhongMaterial({ color });
      const mesh = new THREE.Mesh(geometry, material);
      targetObject.add(mesh);
    }
  
    return targetObject;
  }

  // Enhanced loadAndGroupModels function to handle texture assignment
  async function loadAndGroupModels(file, fileType, textureUrlsS3) {
      const group = new THREE.Group();
      const urls = file.split(','); // Support multiple URLs if provided
      const textureUrlsList = textureUrlsS3.split(',');
      
      for (let i = 0; i < urls.length; i++) {
          const url = urls[i];
          const textureUrls = textureUrlsList[i];  // Get corresponding textures for each model

          try {
              const model = await loadModel(url, fileType);

              // Only convert to glTF if not already in glTF/glb format
              const finalModel = (fileType === 'gltf' || fileType === 'glb')
                  ? model  // If glTF, use the model directly
                  : await convertToGLTF(model, fileType, url);  // Otherwise, convert to glTF

              // Apply textures or base material to the model
              applyMaterialToMeshModel(finalModel, textureUrlsList);

              group.add(finalModel);
          } catch (error) {
              console.error(`Error loading model from ${url}:`, error);
            }
      }

      console.log("All models loaded, textures applied, and grouped.");

      // Wrap the group into a ModelWrapper (custom implementation)
      const modelWrapper = new ModelWrapper(group);
      addModelToScene(modelWrapper);
      return modelWrapper;
  }

  // Function to load the model, apply material if necessary, and handle animations if glTF
  async function loadModel(file, fileType) {
      if (fileType === 'step' || fileType === 'stp') {
        const mainObject = await LoadStep(file);
        console.log('mainObject', mainObject);
        return mainObject;
      }
      const loader = loaders[fileType.toLowerCase()];
      if (!loader) throw new Error(`Unsupported file type: ${fileType}`);
  
      // For glTF/glb, load directly without conversion
      if (fileType === 'gltf' || fileType === 'glb') {
          const gltf = await loader.loadAsync(file);
          
          // If the model has animations, set up the AnimationMixer
          if (gltf.animations && gltf.animations.length > 0) {
              const mixer = new AnimationMixer(gltf.scene);
              gltf.animations.forEach((clip) => mixer.clipAction(clip).play());
              gltf.scene.userData.mixer = mixer;  // Store mixer in model's userData
          }
          
          return gltf.scene;  // Return the glTF scene directly
      }
  
      // For other formats, load and convert to glTF if necessary
      const model = await loader.loadAsync(file);
      return (fileType === 'stp' || fileType === 'stp'|| fileType === 'stl' || fileType === 'ply')
          ? applyBasicMaterial(model)
          : model;
  }

  // Apply a basic material to geometry-based models (STL, PLY)
  function applyBasicMaterial(geometry) {
      const material = new MeshStandardMaterial({ color: 0xdddddd });
      return new Mesh(geometry, material);
  }

  // Convert a loaded model to glTF for consistency
  async function convertToGLTF(model, fileType, url) {
      const exporter = new THREE.GLTFExporter();
      return new Promise((resolve, reject) => {
          exporter.parse(model, (gltfData) => {
              console.log(`Converted ${fileType} model from ${url} to glTF format.`);
              
              // Create a Blob from the exported GLTF data
              const json = JSON.stringify(gltfData);
              const blob = new Blob([json], { type: 'application/json' });

              // Load the GLTF data back into a Three.js scene
              const loader = new THREE.GLTFLoader();
              loader.load(URL.createObjectURL(blob), (gltf) => {
                  resolve(gltf.scene);  // Return the loaded scene
              }, undefined, (error) => {
                  console.error(`Error loading GLTF from Blob:`, error);
                  reject(error);
              });
          }, { binary: false });  // Change to true if you want a binary .glb
      });
  }


  // Add the model to the scene and configure necessary updates
  function addModelToScene(modelWrapper) {
      const nullObject = scene.getObjectByName('nullObject');
      if (nullObject) {
          nullObject.add(modelWrapper.model);
          console.log("Model added to nullObject in the scene.");
      } else {
          console.error("NullObject not found in the scene.");
      }

      // Update focus, lighting, and bounding box based on the new model
      currentModel = modelWrapper;
      focusOnObject();
      updateLightPositions();
      updateMinDistanceBasedOnBoundingBox();
      createDynamicDropdown(currentModel.model);
  }


  // #### TEXTURES PBR ####

  // Function to apply either PBR textures or a base material
  function applyMaterialToMeshModel(model, textureUrls) {
      const hasUVs = model.geometry && model.geometry.attributes.uv;
      console.log(hasUVs);
      console.log(model.type);
      let materialPBR;
      // If the model has UVs and PBR textures are provided, apply PBR material
      if (textureUrls.length > 0) {
          materialPBR = createPBRMaterial(textureUrls);
      } 
      // If no UVs, apply a basic material
      else {
          materialPBR = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.8 });
      }

      model.traverse((child) => {
          if (child.isMesh) {
              console.log(child.name);
              // Ensure the material is a MeshStandardMaterial or MeshPhysicalMaterial
              child.material = materialPBR;  // Set the texture map
              child.material.needsUpdate = true;  // Flag for update
          }
      });
  }


  // Function to load textures based on URLs and PBR maps
  function createPBRMaterial(s3Urls) {
      const textureUrls = createTextureUrls(s3Urls); // Create mapping from S3 URLs
      const materialParams = {};

      // For each PBR map, look for matching textures by alternate names
      for (const [mapName, aliases] of Object.entries(PBR_MAPS)) {
          for (const alias of aliases) {
              const textureUrl = textureUrls[mapName]; // Get mapped URL for the current mapName
              if (textureUrl) {
                  console.log(`mapName: ${mapName}`);
                  materialParams[mapName] = textureLoader.load(textureUrl, (texture) => {
                    console.log(`Loaded texture: ${textureUrl}`);
                    // Assign texture to material parameters here...
                }, undefined, (error) => {
                    console.error(`Error loading texture: ${textureUrl}`, error);
                });
                  break;  // Stop searching after the first match
              }
          }
      }
      console.log(materialParams);
      return new THREE.MeshStandardMaterial(materialParams);
  }

  // Function to map S3 URLs to texture types
  function createTextureUrls(urls) {
      const textureUrls = {};

      // Loop through the texture names to find matching URLs
      for (const [mapType, names] of Object.entries(PBR_MAPS)) {
          for (const name of names) {
              const regex = new RegExp(`.*${name}.*`, 'i'); // Case-insensitive match
              const matchingUrl = urls.find(url => regex.test(url)); // Find the first matching URL
              
              if (matchingUrl) {
                  textureUrls[mapType] = matchingUrl; // Map the URL to the corresponding texture type
                  break;  // Stop searching after the first match
              }
          }
      }

      return textureUrls; // Return the object containing texture URLs
  }

  // Function to smoothly update the minDistance of OrbitControls
  function updateMinDistanceSmoothly(controls, newMinDistance, duration = 1.0) {
      const startMinDistance = controls.minDistance;
      let startTime = null;

      function animate(time) {
          if (!startTime) startTime = time;
          const elapsed = (time - startTime) / 1000;
          const t = Math.min(elapsed / duration, 1);

          // Linearly interpolate minDistance for smooth transition
          controls.minDistance = THREE.MathUtils.lerp(startMinDistance, newMinDistance, t);
          controls.update();

          if (t < 1) {
              requestAnimationFrame(animate);
          }
      }

      requestAnimationFrame(animate);
  }

  // Function to dynamically update minDistance based on updated bounding box
  function updateMinDistanceBasedOnBoundingBox() {
      const boundingBox = new THREE.Box3().setFromObject(currentModel.model);
      const size = new THREE.Vector3();
      boundingBox.getSize(size);

      const maxDimension = Math.max(size.x, size.y, size.z);
      const newMinDistance = maxDimension * 1.3;  // Adjust this multiplier to suit your needs

      updateMinDistanceSmoothly(controls, newMinDistance, 1.0);
  }

  function createDynamicDropdown(model) {
      const container = document.getElementById('modelDropdownContainer');

      container.innerHTML = '';
  
      const dropdown = document.createElement('div');
      dropdown.classList.add('dropdown');

      const toggle = document.createElement('div');
      toggle.classList.add('dropdown-toggle');
      toggle.innerHTML = '<span>Modèle</span>';
      dropdown.appendChild(toggle);
  
      // Create the dropdown list where checkboxes will be added
      const dropdownList = document.createElement('div');
      dropdownList.classList.add('dropdown-list', 'hide');  // Initially hidden
      
      // Add toggle functionality to show/hide the dropdown list
      toggle.addEventListener('click', (event) => {
          event.stopPropagation(); // Prevent click from propagating to the document
          
          // Toggle between show and hide classes for animation
          if (dropdownList.classList.contains('hide')) {
              dropdownList.classList.remove('hide');
              dropdownList.classList.add('show');
          } else {
              dropdownList.classList.remove('show');
              dropdownList.classList.add('hide');
          }
      });
  
      // Close the dropdown if clicking outside of it
      document.addEventListener('click', (event) => {
          if (!dropdown.contains(event.target)) {
              dropdownList.classList.remove('show');
              dropdownList.classList.add('hide');
          }
      });
  
      // Prevent closing the dropdown when clicking inside it
      dropdownList.addEventListener('click', (event) => {
          event.stopPropagation(); // Keeps dropdown open when selecting checkboxes
      });
  
      model.traverse((child) => {
          if (child.isMesh && child.name != '') {
              // Create a div for each checkbox + label pair
              const listItem = document.createElement('div');
              listItem.classList.add('dropdown-item'); // Add a class for styling
  
              // Create a checkbox for each model part
              const checkbox = document.createElement('input');
              checkbox.type = 'checkbox';
              checkbox.id = child.name;
              checkbox.name = child.name;
              checkbox.checked = true;
  
              const label = document.createElement('label');
              label.htmlFor = child.name;
              label.innerText = child.name;
  
              // Add event listener to toggle visibility of model parts
              checkbox.addEventListener('change', (event) => {
                  child.visible = event.target.checked;
              });

              listItem.appendChild(checkbox);
              listItem.appendChild(label);
              dropdownList.appendChild(listItem);
          }
      });
  
      dropdown.appendChild(dropdownList);
      container.appendChild(dropdown);
  }
  

  function updateCameraAndControls() {
    const box = new THREE.Box3().setFromObject(currentModel.model);
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);
    const maxDimension = Math.max(size.x, size.y, size.z) / 2;
    const minDistance = maxDimension * distanceScaleFactor;
    controls.minDistance = minDistance;

    const currentDistance = camera.position.distanceTo(center);
    if (currentDistance < minDistance) {
        const direction = new THREE.Vector3().subVectors(camera.position, center).normalize();
        targetPosition.copy(direction.multiplyScalar(minDistance).add(center));
        camera.position.lerp(targetPosition, smoothFactor);
    }
    
    camera.lookAt(center);
}
  init3DViewer();
  });


