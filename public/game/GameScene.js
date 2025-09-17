import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

const degToRad = THREE.MathUtils.degToRad;

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
    this.positionOffset.clamp(
      new THREE.Vector3(-0.6, -0.3, -0.6),
      new THREE.Vector3(0.6, 0.3, 0.6)
    );
  }

  addRemotePlayer(id) {
    if (!this.remotePlayers) {
      this.remotePlayers = new Map();
    }
    if (this.remotePlayers.has(id)) return this.remotePlayers.get(id);

    const markerGeometry = new THREE.SphereGeometry(0.18, 24, 24);
    const markerMaterial = new THREE.MeshStandardMaterial({ color: 0xffd166 });
    const marker = new THREE.Mesh(markerGeometry, markerMaterial);
    marker.position.set(0, 1.2, 0);
    this.scene.add(marker);
    this.remotePlayers.set(id, marker);
    return marker;
  }

  updateRemotePlayer(id, { position = { x: 0, y: 0, z: 0 } }) {
    if (!this.remotePlayers || !this.remotePlayers.has(id)) {
      this.addRemotePlayer(id);
    }
    const mesh = this.remotePlayers.get(id);
    mesh.position.set(position.x, position.y, position.z);
  }

  applyPointerDrag(deltaX, deltaY) {
    const euler = new THREE.Euler();
    euler.setFromQuaternion(this.targetQuaternion, "YXZ");
    euler.y -= deltaX * 0.005;
    euler.x -= deltaY * 0.005;
    euler.x = THREE.MathUtils.clamp(euler.x, -Math.PI / 3, Math.PI / 3);
    this.targetQuaternion.setFromEuler(euler);
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
    this.racketPivot.quaternion.slerp(this.targetQuaternion, 1 - Math.exp(-delta * 15));

    this.positionOffset.multiplyScalar(0.92);
    const targetPos = this.basePivotPosition.clone().add(this.positionOffset);
    this.racketPivot.position.lerp(targetPos, 0.12);

    this.renderer.render(this.scene, this.camera);
  }
}
