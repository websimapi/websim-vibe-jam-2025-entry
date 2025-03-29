import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PLAYER_SPEED, PLAYER_ROTATION_SPEED, PLAYER_SIZE, PORTAL_RADIUS, PORTAL_EXIT_URL } from './config.js';

const room = new WebsimSocket(); // WebsimSocket is available globally

let scene, camera, renderer;
let playerMesh;
const players = {}; // Store player meshes keyed by clientId
const keys = {};
let controls;

let exitPortalMesh;
let entryPortalMesh = null; // Optional entry portal

// --- Initialization ---

async function init() {
    await room.initialize();

    setupScene();
    setupPlayer();
    setupLighting();
    setupGround();
    setupPortals(); // Handle portal creation/placement

    setupEventListeners();
    setupWebsimListeners();

    animate();
}

function setupScene() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 5;
    camera.position.y = 2;

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.getElementById('container').appendChild(renderer.domElement);

    // Optional: OrbitControls for debugging/spectating
    // controls = new OrbitControls(camera, renderer.domElement);
}

function setupPlayer() {
    const urlParams = new URLSearchParams(window.location.search);
    const isFromPortal = urlParams.get('portal') === 'true';
    const playerColor = urlParams.get('color') ? `#${urlParams.get('color')}` : `#${Math.floor(Math.random()*16777215).toString(16)}`;
    const initialPosition = new THREE.Vector3(0, PLAYER_SIZE / 2, 0);
    const initialRotation = new THREE.Euler(0, 0, 0);
    const initialSpeed = urlParams.get('speed') ? parseFloat(urlParams.get('speed')) : 0; // Not directly used in this movement model, but can be

    if (isFromPortal) {
        const refUrl = urlParams.get('ref');
        if (refUrl && entryPortalMesh) { // If entry portal exists
            // Position player near the entry portal
            initialPosition.copy(entryPortalMesh.position);
            initialPosition.z += PORTAL_RADIUS + PLAYER_SIZE; // Spawn slightly in front
        }
        // Apply incoming parameters
        if (urlParams.has('rotation_y')) initialRotation.y = parseFloat(urlParams.get('rotation_y'));
        // Apply other params like x, y, z positions if needed
    }


    const geometry = new THREE.BoxGeometry(PLAYER_SIZE, PLAYER_SIZE, PLAYER_SIZE);
    const material = new THREE.MeshStandardMaterial({ color: playerColor });
    playerMesh = new THREE.Mesh(geometry, material);
    playerMesh.position.copy(initialPosition);
    playerMesh.rotation.copy(initialRotation);
    scene.add(playerMesh);

    // Set initial presence
    room.updatePresence({
        x: playerMesh.position.x,
        y: playerMesh.position.y,
        z: playerMesh.position.z,
        rotY: playerMesh.rotation.y,
        color: playerColor,
        username: room.peers[room.clientId]?.username || 'Player',
        avatarUrl: room.peers[room.clientId]?.avatarUrl || ''
    });

    // Attach camera to player
    camera.position.set(0, 1.5, -3); // Relative camera position
    playerMesh.add(camera); // Make camera a child of the player mesh
}


function setupLighting() {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(5, 10, 7.5);
    scene.add(directionalLight);
}

function setupGround() {
    const groundGeometry = new THREE.PlaneGeometry(100, 100);
    const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x808080, side: THREE.DoubleSide });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2; // Rotate to be horizontal
    scene.add(ground);
}

function setupPortals() {
    const urlParams = new URLSearchParams(window.location.search);
    const refUrl = urlParams.get('ref');

    // --- Exit Portal ---
    const exitPortalGeometry = new THREE.TorusGeometry(PORTAL_RADIUS, 0.2, 16, 100);
    const exitPortalMaterial = new THREE.MeshBasicMaterial({ color: 0x0000ff, wireframe: true }); // Blue wireframe
    exitPortalMesh = new THREE.Mesh(exitPortalGeometry, exitPortalMaterial);
    exitPortalMesh.position.set(10, PORTAL_RADIUS, 0); // Position the exit portal
    exitPortalMesh.rotation.y = Math.PI / 2; // Stand upright
    scene.add(exitPortalMesh);
    // Add a label (optional, requires more setup with CSS2DRenderer or similar)
    // addPortalLabel(exitPortalMesh, "Vibeverse Portal");

    // --- Entry Portal (if applicable) ---
    if (refUrl && urlParams.get('portal') === 'true') {
        const entryPortalGeometry = new THREE.TorusGeometry(PORTAL_RADIUS, 0.2, 16, 100);
        const entryPortalMaterial = new THREE.MeshBasicMaterial({ color: 0xffa500, wireframe: true }); // Orange wireframe
        entryPortalMesh = new THREE.Mesh(entryPortalGeometry, entryPortalMaterial);
        entryPortalMesh.position.set(-10, PORTAL_RADIUS, 0); // Position the entry portal opposite the exit
        entryPortalMesh.rotation.y = Math.PI / 2; // Stand upright
        scene.add(entryPortalMesh);
        // Add a label pointing back to refUrl (optional)
        // addPortalLabel(entryPortalMesh, `Back to ${refUrl}`);
    }
}

// --- Event Listeners ---

function setupEventListeners() {
    window.addEventListener('resize', onWindowResize, false);
    document.addEventListener('keydown', (event) => keys[event.key.toLowerCase()] = true);
    document.addEventListener('keyup', (event) => keys[event.key.toLowerCase()] = false);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// --- Websim Integration ---

function setupWebsimListeners() {
    room.subscribePresence((currentPresence) => {
        updatePlayerObjects(currentPresence);
    });

    // Optional: Handle room state changes if needed for shared objects
    // room.subscribeRoomState((currentRoomState) => {
    //     // Update shared objects based on room state
    // });

    // Optional: Handle presence update requests (e.g., for interactions)
    // room.subscribePresenceUpdateRequests((updateRequest, fromClientId) => {
    //     // Handle requests like 'damage', 'interact', etc.
    // });
}

function updatePlayerObjects(presenceData) {
    const allClientIds = Object.keys(presenceData);
    const currentClientIds = Object.keys(players);

    // Add new players
    for (const clientId of allClientIds) {
        if (clientId === room.clientId) continue; // Don't render self again

        if (!players[clientId] && presenceData[clientId]) {
            const pData = presenceData[clientId];
            const geometry = new THREE.BoxGeometry(PLAYER_SIZE, PLAYER_SIZE, PLAYER_SIZE);
            const material = new THREE.MeshStandardMaterial({ color: pData.color || 0xffffff });
            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.set(pData.x || 0, pData.y || PLAYER_SIZE / 2, pData.z || 0);
            mesh.rotation.y = pData.rotY || 0;
            players[clientId] = mesh;
            scene.add(mesh);
            console.log(`Player ${pData.username || clientId} joined`);
        }
    }

    // Update existing players
    for (const clientId in players) {
         if (clientId === room.clientId) continue; // Skip self

        if (presenceData[clientId]) {
            const pData = presenceData[clientId];
            const mesh = players[clientId];
            // Smooth movement (optional interpolation can be added here)
            mesh.position.lerp(new THREE.Vector3(pData.x || 0, pData.y || PLAYER_SIZE / 2, pData.z || 0), 0.1);
            // Smooth rotation (optional slerp can be added here)
            const targetQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, pData.rotY || 0, 0));
            mesh.quaternion.slerp(targetQuat, 0.1);
            // Update color if changed
            if (mesh.material.color.getHexString() !== (pData.color || 'ffffff').replace('#','')) {
                 mesh.material.color.set(pData.color || 0xffffff);
            }
        } else {
            // Remove players who left
            scene.remove(players[clientId]);
            delete players[clientId];
            console.log(`Player ${clientId} left`);
        }
    }
}


// --- Game Loop ---

function animate() {
    requestAnimationFrame(animate);

    handleInput();
    checkPortalCollision();

    // Update other players based on presence
    updatePlayerObjects(room.presence); // Ensure updates happen each frame

    renderer.render(scene, camera);
    // if (controls) controls.update(); // Uncomment if using OrbitControls
}

function handleInput() {
    const moveDirection = new THREE.Vector3();
    const rotationAxis = new THREE.Vector3(0, 1, 0); // Rotate around Y axis

    if (keys['w'] || keys['arrowup']) {
        moveDirection.z += 1;
    }
    if (keys['s'] || keys['arrowdown']) {
        moveDirection.z -= 1;
    }
    if (keys['a'] || keys['arrowleft']) {
        playerMesh.rotateOnAxis(rotationAxis, PLAYER_ROTATION_SPEED);
    }
    if (keys['d'] || keys['arrowright']) {
         playerMesh.rotateOnAxis(rotationAxis, -PLAYER_ROTATION_SPEED);
    }

    // Apply movement based on player's current rotation
    const moveVector = moveDirection.normalize().multiplyScalar(PLAYER_SPEED);
    moveVector.applyQuaternion(playerMesh.quaternion); // Apply rotation to movement vector
    playerMesh.position.add(moveVector);

    // Update presence if position or rotation changed
    const currentPresence = room.presence[room.clientId] || {};
    if (playerMesh.position.x !== currentPresence.x ||
        playerMesh.position.y !== currentPresence.y ||
        playerMesh.position.z !== currentPresence.z ||
        playerMesh.rotation.y !== currentPresence.rotY) {
        room.updatePresence({
            x: playerMesh.position.x,
            y: playerMesh.position.y,
            z: playerMesh.position.z,
            rotY: playerMesh.rotation.y
            // Keep other presence data like color, username
        });
    }
}


function checkPortalCollision() {
    const playerPosition = playerMesh.position;

    // Check Exit Portal
    if (playerPosition.distanceTo(exitPortalMesh.position) < PORTAL_RADIUS + PLAYER_SIZE / 2) {
        console.log("Entering Exit Portal!");
        goToPortal(PORTAL_EXIT_URL);
    }

    // Check Entry Portal (if it exists)
    if (entryPortalMesh) {
         const urlParams = new URLSearchParams(window.location.search);
         const refUrl = urlParams.get('ref');
        if (refUrl && playerPosition.distanceTo(entryPortalMesh.position) < PORTAL_RADIUS + PLAYER_SIZE / 2) {
            console.log("Entering Entry Portal (returning)!");
            goToPortal(`http://${refUrl}`); // Assume refUrl is just the domain for simplicity
        }
    }
}


function goToPortal(targetUrlBase) {
    const presence = room.presence[room.clientId];
    const params = new URLSearchParams();

    if (presence.username) params.set('username', presence.username);
    if (presence.color) params.set('color', presence.color.replace('#', '')); // Send hex without #
    params.set('speed', PLAYER_SPEED); // Send configured speed
    params.set('ref', window.location.hostname + window.location.pathname); // Current game URL

    // Optional parameters
    if (presence.avatarUrl) params.set('avatar_url', presence.avatarUrl);
    // Add speeds if your movement model uses them
    // params.set('speed_x', ...);
    // params.set('speed_y', ...);
    // params.set('speed_z', ...);
    params.set('rotation_y', playerMesh.rotation.y.toString());

    const targetUrl = `${targetUrlBase}?${params.toString()}`;
    console.log(`Redirecting to: ${targetUrl}`);
    window.location.href = targetUrl;
}

// --- Start ---
init();

