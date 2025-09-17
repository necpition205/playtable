import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

const degToRad = THREE.MathUtils.degToRad;

const COURT_WIDTH = 9.6;
const COURT_DEPTH = 4.4;
const COURT_HALF_WIDTH = COURT_WIDTH / 2;
const COURT_HALF_DEPTH = COURT_DEPTH / 2;
const COURT_MARGIN = 2;
const PLAYER_HEIGHT = 1.32;

const clampPosition = (vector, team) => {
  const maxWidth = COURT_HALF_WIDTH * 0.8;
  const maxDepth = COURT_HALF_DEPTH * 0.85;
  vector.x = THREE.MathUtils.clamp(vector.x, -maxWidth, maxWidth);
  let minZ = -maxDepth;
  let maxZ = maxDepth;
  if (team === "A") {
    minZ = -COURT_HALF_DEPTH;
    maxZ = COURT_HALF_DEPTH * 0.1;
  } else if (team === "B") {
    minZ = -COURT_HALF_DEPTH * 0.1;
    maxZ = COURT_HALF_DEPTH;
  }
  vector.z = THREE.MathUtils.clamp(vector.z, minZ, maxZ);
  vector.y = PLAYER_HEIGHT;
  return vector;
};

const upVector = new THREE.Vector3(0, 1, 0);

export class GameScene {
  constructor(canvas) {
    this.canvas = canvas;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio ?? 1, 2));
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x091524);

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 120);
    this.camera.position.set(0, 6.4, 10.8);
    this.camera.lookAt(0, PLAYER_HEIGHT, 0);

    this.clock = new THREE.Clock();

    this.playerId = null;
    this.localTeam = "A";
    this.localMode = "player";
    this.keyboardInput = { forward: 0, right: 0, up: 0, rotateYaw: 0, rotatePitch: 0 };
    this.remotePlayers = new Map();

    this.playerPosition = new THREE.Vector3(0, PLAYER_HEIGHT, -COURT_HALF_DEPTH * 0.25);
    this.playerOffset = new THREE.Vector3();
    this.sensorQuaternion = new THREE.Quaternion();
    this.manualEuler = new THREE.Euler(0, 0, 0, "YXZ");
    this.targetQuaternion = new THREE.Quaternion();

    this.ballGroup = new THREE.Group();
    this.ballPosition = new THREE.Vector3(0, PLAYER_HEIGHT + 0.3, 0);
    this.ballVelocity = new THREE.Vector3();
    this.ballActive = false;
    this.matchState = "idle";

    this._buildLights();
    this._buildCourt();
    this._buildAudienceGlow();
    this._buildLocalRig();
    this._buildBall();

    window.addEventListener("resize", () => this.refreshViewport());
    this.refreshViewport();

    this._render = this._render.bind(this);
    requestAnimationFrame(this._render);
  }

  _buildLights() {
    const ambient = new THREE.AmbientLight(0x1b2b3f, 0.75);
    this.scene.add(ambient);

    const key = new THREE.DirectionalLight(0xf8ffff, 1.05);
    key.position.set(6, 9, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 30;
    key.shadow.camera.left = -10;
    key.shadow.camera.right = 10;
    key.shadow.camera.top = 7;
    key.shadow.camera.bottom = -6;
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0x4ac6ff, 0.5);
    fill.position.set(-7, 8, -6);
    this.scene.add(fill);

    const rim = new THREE.PointLight(0x3d7bff, 0.8, 40, 2.4);
    rim.position.set(0, 10, 0);
    this.scene.add(rim);
  }

  _buildCourt() {
    const floorGeometry = new THREE.PlaneGeometry(COURT_WIDTH + COURT_MARGIN * 2, COURT_DEPTH + COURT_MARGIN * 2);
    const floorMaterial = new THREE.MeshStandardMaterial({
      color: 0x06101d,
      roughness: 0.92,
      metalness: 0.04,
    });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const courtGeometry = new THREE.PlaneGeometry(COURT_WIDTH, COURT_DEPTH);
    const courtMaterial = new THREE.MeshStandardMaterial({
      color: 0x0c3a6a,
      roughness: 0.55,
      metalness: 0.1,
    });
    const court = new THREE.Mesh(courtGeometry, courtMaterial);
    court.position.y = 0.02;
    court.rotation.x = -Math.PI / 2;
    court.receiveShadow = true;
    this.scene.add(court);

    const lineMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const addLine = (width, depth, x, z) => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), lineMaterial);
      mesh.position.set(x, 0.025, z);
      mesh.rotation.x = -Math.PI / 2;
      this.scene.add(mesh);
    };

    const outer = 0.08;
    addLine(COURT_WIDTH, outer, 0, -COURT_HALF_DEPTH);
    addLine(COURT_WIDTH, outer, 0, COURT_HALF_DEPTH);
    addLine(outer, COURT_DEPTH, -COURT_HALF_WIDTH, 0);
    addLine(outer, COURT_DEPTH, COURT_HALF_WIDTH, 0);

    addLine(COURT_WIDTH, outer, 0, 0);
    addLine(COURT_WIDTH, outer, 0, COURT_HALF_DEPTH / 2);
    addLine(COURT_WIDTH, outer, 0, -COURT_HALF_DEPTH / 2);

    const centre = 0.06;
    addLine(centre, COURT_DEPTH, 0, 0);

    const meshMaterial = new THREE.MeshStandardMaterial({
      color: 0xfefdf7,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
      roughness: 0.4,
    });
    const net = new THREE.Mesh(new THREE.PlaneGeometry(COURT_WIDTH, 1.2, 18, 1), meshMaterial);
    net.position.set(0, 0.6, 0.02);
    this.scene.add(net);

    const postMaterial = new THREE.MeshStandardMaterial({ color: 0x7bc7ff, roughness: 0.3, metalness: 0.35 });
    const createPost = (x) => {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.6, 14), postMaterial);
      post.position.set(x, 0.8, 0);
      post.castShadow = true;
      this.scene.add(post);
    };
    createPost(-COURT_HALF_WIDTH);
    createPost(COURT_HALF_WIDTH);
  }

  _buildAudienceGlow() {
    const shader = new THREE.MeshBasicMaterial({
      color: 0x0f2742,
      transparent: true,
      opacity: 0.35,
    });
    const frame = new THREE.Mesh(new THREE.CylinderGeometry(COURT_WIDTH, COURT_WIDTH, 0.4, 64, 1, true), shader);
    frame.rotation.x = Math.PI / 2;
    frame.position.y = 0.01;
    this.scene.add(frame);
  }

  _buildLocalRig() {
    this.playerGroup = new THREE.Group();

    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 1.1, 10, 20), new THREE.MeshStandardMaterial({
      color: 0x4e9dff,
      roughness: 0.48,
      metalness: 0.2,
      emissive: 0x102f52,
      emissiveIntensity: 0.6,
    }));
    body.position.y = 0.9;
    body.castShadow = true;
    this.playerGroup.add(body);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 18, 18), new THREE.MeshStandardMaterial({ color: 0xf5f9ff }));
    head.position.y = 1.45;
    head.castShadow = true;
    this.playerGroup.add(head);

    const visor = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.05, 12, 24), new THREE.MeshStandardMaterial({
      color: 0x67f7ff,
      emissive: 0x0d526f,
      emissiveIntensity: 1.5,
      roughness: 0.25,
      metalness: 0.4,
    }));
    visor.rotation.x = Math.PI / 2;
    visor.position.y = 0.45;
    this.playerGroup.add(visor);

    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.08, 1.1, 14), new THREE.MeshStandardMaterial({
      color: 0x1d273c,
      roughness: 0.6,
      metalness: 0.15,
    }));
    arm.position.set(0.46, 1.05, 0);
    arm.rotation.z = -Math.PI / 3;
    arm.rotation.y = Math.PI / 8;
    arm.castShadow = true;
    this.playerGroup.add(arm);

    this.racket = this._createRacket();
    this.racket.position.set(0.58, 0.25, 0);
    arm.add(this.racket);

    this.playerGroup.position.copy(this.playerPosition);
    this.scene.add(this.playerGroup);
  }

  _createRacket() {
    const group = new THREE.Group();

    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.8, 12), new THREE.MeshStandardMaterial({
      color: 0x101828,
      roughness: 0.65,
      metalness: 0.12,
    }));
    handle.rotation.z = Math.PI / 2;
    group.add(handle);

    const throat = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.32), new THREE.MeshStandardMaterial({
      color: 0x1d2a3f,
      roughness: 0.45,
      metalness: 0.2,
    }));
    throat.position.x = 0.35;
    group.add(throat);

    const frame = new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.07, 14, 32), new THREE.MeshStandardMaterial({
      color: 0xff8146,
      emissive: 0x7b2d05,
      emissiveIntensity: 0.9,
      roughness: 0.3,
      metalness: 0.25,
    }));
    frame.rotation.y = Math.PI / 2;
    frame.position.x = 0.52;
    group.add(frame);

    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.82, 0.64, 6, 6), new THREE.MeshStandardMaterial({
      color: 0xfff6dd,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
    }));
    mesh.rotation.y = Math.PI / 2;
    mesh.position.x = 0.52;
    group.add(mesh);

    group.castShadow = true;
    return group;
  }

  _buildBall() {
    const material = new THREE.MeshPhysicalMaterial({
      color: 0xfff7cf,
      roughness: 0.18,
      metalness: 0.08,
      clearcoat: 0.75,
      clearcoatRoughness: 0.25,
      emissive: 0xffda84,
      emissiveIntensity: 0.22,
    });
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.28, 32, 32), material);
    sphere.castShadow = true;
    this.ballGroup.add(sphere);

    const glowCanvas = document.createElement("canvas");
    glowCanvas.width = glowCanvas.height = 128;
    const glowCtx = glowCanvas.getContext("2d");
    const gradient = glowCtx.createRadialGradient(64, 64, 8, 64, 64, 64);
    gradient.addColorStop(0, "rgba(255, 214, 122, 0.9)");
    gradient.addColorStop(1, "rgba(255, 214, 122, 0)");
    glowCtx.fillStyle = gradient;
    glowCtx.fillRect(0, 0, 128, 128);
    const glowTexture = new THREE.CanvasTexture(glowCanvas);
    glowTexture.colorSpace = THREE.SRGBColorSpace;
    const glowSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, transparent: true, opacity: 0.45, depthWrite: false }));
    glowSprite.scale.setScalar(1.2);
    this.ballGroup.add(glowSprite);

    this.ballGroup.position.copy(this.ballPosition);
    this.scene.add(this.ballGroup);
  }

  setLocalPlayerId(playerId) {
    this.playerId = playerId;
  }

  setLocalPlayerTeam(team = "A", mode = "player") {
    const nextTeam = team === "B" ? "B" : "A";
    this.localTeam = nextTeam;
    this.localMode = mode;

    const z = mode === "spectator"
      ? 0
      : (nextTeam === "A" ? -COURT_HALF_DEPTH * 0.35 : COURT_HALF_DEPTH * 0.35);

    this.playerPosition.set(0, PLAYER_HEIGHT, z);
    this.playerOffset.set(0, 0, 0);
    clampPosition(this.playerPosition, this.localTeam);
    this.playerGroup.visible = mode !== "spectator";

    if (!this.ballActive) {
      this.ballPosition.set(0, PLAYER_HEIGHT + 0.3, z * 0.1);
      this.ballGroup.position.copy(this.ballPosition);
    }
  }

  setMatchState(status) {
    if (this.matchState === status) return;
    this.matchState = status;

    if (status === "playing") {
      this._serveBall();
    } else {
      this.ballActive = false;
      this.ballVelocity.set(0, 0, 0);
      const idleHeight = status === "countdown" ? PLAYER_HEIGHT + 0.45 : PLAYER_HEIGHT + 0.3;
      this.ballPosition.set(0, idleHeight, this.localMode === "spectator" ? 0 : this.playerPosition.z * 0.1);
      this.ballGroup.position.copy(this.ballPosition);
    }
  }

  updatePlayerOrientation({ alpha = 0, beta = 0, gamma = 0 }) {
    const euler = new THREE.Euler(degToRad(beta), degToRad(alpha), degToRad(-gamma), "YXZ");
    this.sensorQuaternion.setFromEuler(euler);
    this._updateTargetQuaternion();
  }

  updatePlayerMotion({ acceleration = { x: 0, y: 0, z: 0 }, interval = 16 }) {
    const delta = Math.min(interval / 1000, 0.032);
    const accelVec = new THREE.Vector3(acceleration.x ?? 0, acceleration.y ?? 0, acceleration.z ?? 0);
    accelVec.multiplyScalar(0.05 * delta);
    this.playerOffset.add(accelVec);
    this.playerOffset.clamp(new THREE.Vector3(-0.6, -0.35, -0.6), new THREE.Vector3(0.6, 0.35, 0.6));
  }

  applyPointerDrag(deltaX, deltaY) {
    this.manualEuler.y -= deltaX * 0.0045;
    this.manualEuler.x = THREE.MathUtils.clamp(this.manualEuler.x - deltaY * 0.0035, -Math.PI / 4, Math.PI / 4);
    this._updateTargetQuaternion();
  }

  applyKeyboardInput(state) {
    this.keyboardInput = {
      forward: state.forward ?? 0,
      right: state.right ?? 0,
      up: state.up ?? 0,
      rotateYaw: state.rotateYaw ?? 0,
      rotatePitch: state.rotatePitch ?? 0,
    };
  }

  syncRoster(players = []) {
    const idSet = new Set(players.map((p) => p.id));

    this.remotePlayers.forEach((entry, id) => {
      if (!idSet.has(id) || id === this.playerId) {
        this.scene.remove(entry.mesh);
        this.remotePlayers.delete(id);
      }
    });

    const localPlayer = players.find((p) => p.id === this.playerId);
    if (localPlayer) this.setLocalPlayerTeam(localPlayer.team, localPlayer.mode);

    const teamLists = { A: [], B: [], spectator: [] };
    players.forEach((player) => {
      if (player.id === this.playerId) return;
      if (player.mode === "spectator") teamLists.spectator.push(player);
      else if (player.team === "B") teamLists.B.push(player);
      else teamLists.A.push(player);
    });

    const assign = (player, index, total, slotTeam) => {
      const base = this._slotPosition(slotTeam, index, total);
      let entry = this.remotePlayers.get(player.id);
      if (!entry) {
        const colorHue = (0.12 + index * 0.18) % 1;
        const color = new THREE.Color().setHSL(colorHue, 0.6, 0.55);
        const avatar = this._createRemoteAvatar(color, slotTeam === "B");
        avatar.position.copy(base);
        this.scene.add(avatar);
        entry = {
          mesh: avatar,
          basePosition: base.clone(),
          positionOffset: new THREE.Vector3(),
          velocity: new THREE.Vector3(),
          targetQuaternion: new THREE.Quaternion(),
          currentQuaternion: new THREE.Quaternion(),
        };
        this.remotePlayers.set(player.id, entry);
      } else {
        entry.basePosition.copy(base);
        entry.mesh.visible = player.mode !== "spectator";
        entry.mesh.position.copy(base);
      }
    };

    teamLists.A.forEach((player, index) => assign(player, index, teamLists.A.length || 1, "A"));
    teamLists.B.forEach((player, index) => assign(player, index, teamLists.B.length || 1, "B"));
    teamLists.spectator.forEach((player, index) => assign(player, index, teamLists.spectator.length || 1, "S"));
  }

  _slotPosition(team, index, total) {
    const position = new THREE.Vector3();
    if (team === "S") {
      const spread = Math.min(6, total * 1.4);
      const start = -spread / 2;
      const step = total > 1 ? spread / (total - 1) : 0;
      position.set(start + step * index, PLAYER_HEIGHT, COURT_HALF_DEPTH + 0.7);
      return position;
    }

    const lane = COURT_WIDTH * 0.75;
    const step = total > 1 ? lane / (total - 1) : 0;
    const start = -lane / 2;
    const z = team === "A" ? -COURT_HALF_DEPTH * 0.35 : COURT_HALF_DEPTH * 0.35;
    position.set(total > 1 ? start + step * index : 0, PLAYER_HEIGHT, z);
    return position;
  }

  _createRemoteAvatar(color, invert) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.9, 8, 16), new THREE.MeshStandardMaterial({
      color: color.getHex(),
      roughness: 0.45,
      metalness: 0.22,
      emissive: invert ? 0x0d1e35 : 0x051627,
      emissiveIntensity: 0.65,
    }));
    body.position.y = 0.85;
    body.castShadow = true;
    group.add(body);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 18, 18), new THREE.MeshStandardMaterial({
      color: 0xf5f9ff,
      roughness: 0.3,
    }));
    head.position.y = 1.3;
    head.castShadow = true;
    group.add(head);

    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.045, 12, 22), new THREE.MeshStandardMaterial({
      color: invert ? 0xff7d4a : 0x67f7ff,
      emissive: invert ? 0x5b1a05 : 0x104a61,
      emissiveIntensity: 1,
      metalness: 0.45,
      roughness: 0.28,
    }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.32;
    group.add(ring);

    return group;
  }

  applyRemoteMotion(playerId, motion = {}) {
    const entry = this.remotePlayers.get(playerId);
    if (!entry || !entry.mesh.visible) return;

    const { orientation = {}, acceleration = {}, interval = 16 } = motion;
    if (orientation.alpha !== undefined) {
      const euler = new THREE.Euler(
        degToRad(orientation.beta ?? 0),
        degToRad(orientation.alpha ?? 0),
        degToRad(-(orientation.gamma ?? 0)),
        "YXZ",
      );
      entry.targetQuaternion.setFromEuler(euler);
    }

    const delta = Math.min(interval / 1000, 0.032);
    const accelVec = new THREE.Vector3(acceleration.x ?? 0, acceleration.y ?? 0, acceleration.z ?? 0);
    accelVec.multiplyScalar(0.05 * delta);
    entry.positionOffset.add(accelVec);
    entry.positionOffset.clamp(new THREE.Vector3(-0.7, -0.3, -0.7), new THREE.Vector3(0.7, 0.4, 0.7));
  }

  refreshViewport() {
    if (!this.canvas) return;
    const parent = this.canvas.parentElement ?? this.canvas;
    const rect = parent.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width || this.canvas.clientWidth || this.canvas.width || 1));
    const height = Math.max(1, Math.round(rect.height || this.canvas.clientHeight || this.canvas.height || 1));
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio ?? 1, 2));
    this.renderer.setSize(width, height, false);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  _updateTargetQuaternion() {
    const manualQuat = new THREE.Quaternion().setFromEuler(this.manualEuler);
    this.targetQuaternion.copy(manualQuat).multiply(this.sensorQuaternion);
  }

  _updateLocalPlayer(delta) {
    if (this.keyboardInput.rotateYaw !== 0 || this.keyboardInput.rotatePitch !== 0) {
      this.manualEuler.y -= this.keyboardInput.rotateYaw * delta * 2.4;
      this.manualEuler.x = THREE.MathUtils.clamp(this.manualEuler.x - this.keyboardInput.rotatePitch * delta * 2, -Math.PI / 4, Math.PI / 4);
      this._updateTargetQuaternion();
    }

    const move = new THREE.Vector3(this.keyboardInput.right, this.keyboardInput.up * 0.4, -this.keyboardInput.forward);
    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(2.6 * delta);
      this.playerPosition.add(move);
      clampPosition(this.playerPosition, this.localTeam);
    }

    this.playerOffset.multiplyScalar(0.9);

    const targetPosition = new THREE.Vector3().copy(this.playerPosition).add(this.playerOffset);
    clampPosition(targetPosition, this.localTeam);

    this.playerGroup.quaternion.slerp(this.targetQuaternion, 1 - Math.exp(-delta * 14));
    this.playerGroup.position.lerp(targetPosition, 0.18);
  }

  _updateRemotePlayers(delta) {
    this.remotePlayers.forEach((entry) => {
      entry.positionOffset.multiplyScalar(0.9);
      const targetPos = new THREE.Vector3().copy(entry.basePosition).add(entry.positionOffset);
      entry.mesh.position.lerp(targetPos, 0.18);
      entry.mesh.quaternion.slerp(entry.targetQuaternion, 1 - Math.exp(-delta * 12));
    });
  }

  _serveBall() {
    this.ballActive = true;
    const serveSide = this.localTeam === "A" ? 1 : -1;
    const lateral = (Math.random() - 0.5) * 1.6;
    this.ballPosition.set(lateral, PLAYER_HEIGHT + 0.45, this.localTeam === "A" ? -COURT_HALF_DEPTH * 0.2 : COURT_HALF_DEPTH * 0.2);
    this.ballVelocity.set(2.9 * serveSide, 3.2, (Math.random() - 0.5) * 2.4);
  }

  _updateBall(delta) {
    if (this.ballActive) {
      this.ballVelocity.y -= 9.8 * delta * 0.55;
      this.ballVelocity.multiplyScalar(0.998);
      this.ballPosition.addScaledVector(this.ballVelocity, delta);

      if (this.ballPosition.y < 0.22) {
        this.ballPosition.y = 0.22;
        this.ballVelocity.y *= -0.62;
        this.ballVelocity.x *= 0.88;
        this.ballVelocity.z *= 0.88;
      }

      if (Math.abs(this.ballPosition.x) > COURT_HALF_WIDTH) {
        this.ballPosition.x = THREE.MathUtils.clamp(this.ballPosition.x, -COURT_HALF_WIDTH, COURT_HALF_WIDTH);
        this.ballVelocity.x *= -0.82;
      }

      if (Math.abs(this.ballPosition.z) > COURT_HALF_DEPTH) {
        this.ballPosition.z = THREE.MathUtils.clamp(this.ballPosition.z, -COURT_HALF_DEPTH, COURT_HALF_DEPTH);
        this.ballVelocity.z *= -0.82;
      }
    } else {
      this.ballPosition.lerp(new THREE.Vector3(0, PLAYER_HEIGHT + 0.3, this.playerPosition.z * 0.1), 0.08);
    }

    this.ballGroup.position.lerp(this.ballPosition, 0.4);
    this.ballGroup.rotation.y += delta * 1.5;
  }

  _render() {
    requestAnimationFrame(this._render);
    const delta = this.clock.getDelta();

    this._updateLocalPlayer(delta);
    this._updateRemotePlayers(delta);
    this._updateBall(delta);

    this.renderer.render(this.scene, this.camera);
  }
}
