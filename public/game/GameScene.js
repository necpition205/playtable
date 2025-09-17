import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

const degToRad = THREE.MathUtils.degToRad;

const clampVec3 = (vector, min, max) => {
  vector.x = THREE.MathUtils.clamp(vector.x, min.x, max.x);
  vector.y = THREE.MathUtils.clamp(vector.y, min.y, max.y);
  vector.z = THREE.MathUtils.clamp(vector.z, min.z, max.z);
  return vector;
};

export class GameScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x04111b);

    this.clock = new THREE.Clock();

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
    this.camera.position.set(0, 4.5, 8.5);
    this.camera.lookAt(0, 1.3, 0);

    this.root = new THREE.Group();
    this.scene.add(this.root);

    this.targetQuaternion = new THREE.Quaternion();
    this.racketPivot = new THREE.Group();
    this.root.add(this.racketPivot);

    this.basePivotPosition = new THREE.Vector3(0, 1.3, 0);
    this.racketPivot.position.copy(this.basePivotPosition);

    this.velocity = new THREE.Vector3();
    this.positionOffset = new THREE.Vector3();

    this.keyboardInput = {
      forward: 0,
      right: 0,
      up: 0,
      rotateYaw: 0,
      rotatePitch: 0,
    };

    this.remotePlayers = new Map();
    this.localPlayerId = null;

    this._initLights();
    this._initCourt();
    this._initRacket();

    window.addEventListener("resize", () => this._handleResize());
    this._handleResize();

    this._render = this._render.bind(this);
    requestAnimationFrame(this._render);
  }

  _initLights() {
    const hemi = new THREE.HemisphereLight(0x7bc8ff, 0x0a0e16, 0.8);
    this.scene.add(hemi);

    const dir = new THREE.DirectionalLight(0xf4faff, 1.2);
    dir.position.set(4, 6, 6);
    dir.castShadow = true;
    dir.shadow.mapSize.set(1024, 1024);
    dir.shadow.camera.near = 0.5;
    dir.shadow.camera.far = 20;
    this.scene.add(dir);
  }

  _initCourt() {
    const courtGroup = new THREE.Group();
    this.root.add(courtGroup);

    const courtGeo = new THREE.PlaneGeometry(10.4, 4.6, 1, 1);
    const courtMat = new THREE.MeshStandardMaterial({
      color: 0x0b2c4f,
      roughness: 0.85,
      metalness: 0.05,
    });
    const court = new THREE.Mesh(courtGeo, courtMat);
    court.rotation.x = -Math.PI / 2;
    court.receiveShadow = true;
    courtGroup.add(court);

    const lineMaterial = new THREE.LineBasicMaterial({ color: 0xf8fbff });
    const lineGeometry = new THREE.BufferGeometry();
    const halfW = 10.4 / 2;
    const halfH = 4.6 / 2;
    const points = [
      new THREE.Vector3(-halfW, 0.01, -halfH),
      new THREE.Vector3(halfW, 0.01, -halfH),
      new THREE.Vector3(halfW, 0.01, halfH),
      new THREE.Vector3(-halfW, 0.01, halfH),
      new THREE.Vector3(-halfW, 0.01, -halfH),
    ];
    lineGeometry.setFromPoints(points);
    const outline = new THREE.Line(lineGeometry, lineMaterial);
    outline.rotation.x = Math.PI / 2;
    courtGroup.add(outline);

    const netGeometry = new THREE.PlaneGeometry(10.4, 1.5, 12, 1);
    const netMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
    });
    const net = new THREE.Mesh(netGeometry, netMaterial);
    net.position.y = 0.75;
    net.rotation.y = Math.PI;
    courtGroup.add(net);
  }

  _initRacket() {
    const gripGeometry = new THREE.CylinderGeometry(0.1, 0.12, 0.9, 16);
    const gripMaterial = new THREE.MeshStandardMaterial({ color: 0x223650 });
    const grip = new THREE.Mesh(gripGeometry, gripMaterial);
    grip.castShadow = true;
    grip.position.y = -0.9;

    const headGeometry = new THREE.TorusGeometry(0.7, 0.08, 16, 32);
    const headMaterial = new THREE.MeshStandardMaterial({ color: 0x4af3ff, emissive: 0x0a1c2f });
    const head = new THREE.Mesh(headGeometry, headMaterial);
    head.rotation.x = Math.PI / 2;
    head.castShadow = true;

    const stringsGeometry = new THREE.PlaneGeometry(1.2, 1.5, 6, 10);
    const stringsMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      opacity: 0.35,
      transparent: true,
      side: THREE.DoubleSide,
    });
    const strings = new THREE.Mesh(stringsGeometry, stringsMaterial);
    strings.rotation.x = Math.PI / 2;

    const racket = new THREE.Group();
    racket.add(grip);
    racket.add(head);
    racket.add(strings);

    head.position.y = 0.2;
    strings.position.y = 0.2;

    this.racketPivot.add(racket);
  }

  setLocalPlayerId(playerId) {
    this.localPlayerId = playerId;
  }

  updatePlayerOrientation({ alpha = 0, beta = 0, gamma = 0 }) {
    const euler = new THREE.Euler(
      degToRad(beta),
      degToRad(alpha),
      degToRad(-gamma),
      "YXZ"
    );
    this.targetQuaternion.setFromEuler(euler);
  }

  updatePlayerMotion({ acceleration = { x: 0, y: 0, z: 0 }, interval = 16 }) {
    const delta = Math.min(interval / 1000, 0.032);
    this.velocity.lerp(
      new THREE.Vector3(acceleration.x, acceleration.y, acceleration.z).multiplyScalar(0.015),
      0.12
    );
    this.positionOffset.addScaledVector(this.velocity, delta);
    clampVec3(
      this.positionOffset,
      new THREE.Vector3(-0.6, -0.3, -0.6),
      new THREE.Vector3(0.6, 0.3, 0.6)
    );
  }

  applyPointerDrag(deltaX, deltaY) {
    const euler = new THREE.Euler();
    euler.setFromQuaternion(this.targetQuaternion, "YXZ");
    euler.y -= deltaX * 0.005;
    euler.x -= deltaY * 0.005;
    euler.x = THREE.MathUtils.clamp(euler.x, -Math.PI / 3, Math.PI / 3);
    this.targetQuaternion.setFromEuler(euler);
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

    this.remotePlayers.forEach((state, id) => {
      if (!idSet.has(id) || id === this.localPlayerId) {
        this.scene.remove(state.mesh);
        this.remotePlayers.delete(id);
      }
    });

    players.forEach((player, index) => {
      if (player.id === this.localPlayerId) return;
      if (this.remotePlayers.has(player.id)) return;

      const hue = 0.15 + ((index * 0.2) % 1);
      const color = new THREE.Color().setHSL(hue, 0.65, 0.55);
      const mesh = this._createRemoteMarker(color, player.team === "B");
      mesh.position.copy(this.basePivotPosition.clone());
      this.scene.add(mesh);
      this.remotePlayers.set(player.id, {
        mesh,
        targetQuaternion: new THREE.Quaternion(),
        positionOffset: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
      });
    });
  }

  _createRemoteMarker(color, invert = false) {
    const group = new THREE.Group();
    const bodyGeometry = new THREE.CapsuleGeometry(0.18, 0.6, 6, 12);
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: color.getHex(),
      metalness: 0.25,
      roughness: 0.55,
      emissive: invert ? new THREE.Color(0x112244) : new THREE.Color(0x06111f),
    });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.castShadow = true;
    group.add(body);

    const headGeometry = new THREE.SphereGeometry(0.22, 16, 16);
    const headMaterial = new THREE.MeshStandardMaterial({ color: 0xf8fbff, roughness: 0.4 });
    const head = new THREE.Mesh(headGeometry, headMaterial);
    head.position.y = 0.55;
    head.castShadow = true;
    group.add(head);

    group.position.y = 1.2;
    return group;
  }

  applyRemoteMotion(playerId, motion = {}) {
    if (!this.remotePlayers.has(playerId)) return;
    const state = this.remotePlayers.get(playerId);
    const { orientation = {}, acceleration = {}, interval = 16 } = motion;

    if (orientation.alpha !== undefined) {
      const euler = new THREE.Euler(
        degToRad(orientation.beta ?? 0),
        degToRad(orientation.alpha ?? 0),
        degToRad(-(orientation.gamma ?? 0)),
        "YXZ"
      );
      const target = new THREE.Quaternion().setFromEuler(euler);
      state.targetQuaternion.slerp(target, 0.35);
    }

    const delta = Math.min(interval / 1000, 0.032);
    state.velocity.lerp(
      new THREE.Vector3(acceleration.x ?? 0, acceleration.y ?? 0, acceleration.z ?? 0).multiplyScalar(0.015),
      0.1
    );
    state.positionOffset.addScaledVector(state.velocity, delta);
    clampVec3(
      state.positionOffset,
      new THREE.Vector3(-0.9, -0.3, -0.9),
      new THREE.Vector3(0.9, 0.5, 0.9)
    );
  }

  _handleResize() {
    const width = this.canvas.clientWidth || this.canvas.parentElement.clientWidth;
    const height = this.canvas.clientHeight || this.canvas.parentElement.clientHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  _render() {
    requestAnimationFrame(this._render);

    const delta = this.clock.getDelta();

    if (this.keyboardInput) {
      const moveSpeed = 2.2;
      this.positionOffset.x += this.keyboardInput.right * delta * moveSpeed;
      this.positionOffset.z += this.keyboardInput.forward * delta * moveSpeed;
      this.positionOffset.y += this.keyboardInput.up * delta * moveSpeed * 0.5;
      clampVec3(
        this.positionOffset,
        new THREE.Vector3(-0.6, -0.3, -0.6),
        new THREE.Vector3(0.6, 0.3, 0.6)
      );

      if (this.keyboardInput.rotateYaw !== 0 || this.keyboardInput.rotatePitch !== 0) {
        const euler = new THREE.Euler();
        euler.setFromQuaternion(this.targetQuaternion, "YXZ");
        euler.y -= this.keyboardInput.rotateYaw * delta * 2.6;
        euler.x -= this.keyboardInput.rotatePitch * delta * 2.2;
        euler.x = THREE.MathUtils.clamp(euler.x, -Math.PI / 3, Math.PI / 3);
        this.targetQuaternion.setFromEuler(euler);
      }
    }

    this.racketPivot.quaternion.slerp(this.targetQuaternion, 1 - Math.exp(-delta * 15));

    this.positionOffset.multiplyScalar(0.92);
    const targetPos = this.basePivotPosition.clone().add(this.positionOffset);
    this.racketPivot.position.lerp(targetPos, 0.12);

    this.remotePlayers.forEach((state) => {
      state.positionOffset.multiplyScalar(0.9);
      state.mesh.quaternion.slerp(state.targetQuaternion, 1 - Math.exp(-delta * 12));
      const remotePos = this.basePivotPosition.clone().add(state.positionOffset);
      state.mesh.position.lerp(remotePos, 0.12);
    });

    this.renderer.render(this.scene, this.camera);
  }
}
