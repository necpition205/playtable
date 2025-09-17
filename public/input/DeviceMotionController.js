const hasMotionPermissionAPI = () =>
  typeof DeviceMotionEvent !== "undefined" &&
  typeof DeviceMotionEvent.requestPermission === "function";

const hasOrientationPermissionAPI = () =>
  typeof DeviceOrientationEvent !== "undefined" &&
  typeof DeviceOrientationEvent.requestPermission === "function";

export class DeviceMotionController {
  constructor({ onMotion, onOrientation, statusElement, autoStart = true } = {}) {
    this.onMotion = onMotion ?? (() => {});
    this.onOrientation = onOrientation ?? (() => {});
    this.statusElement = statusElement ?? null;
    this.autoStart = autoStart;

    this.active = false;
    this.lockedUntil = 0;
    this.permissionsGranted = !hasMotionPermissionAPI() && !hasOrientationPermissionAPI();

    this._handleMotion = this._handleMotion.bind(this);
    this._handleOrientation = this._handleOrientation.bind(this);

    // if (!window.isSecureContext) {
    //   this._setStatus("HTTPS 환경에서만 센서를 사용할 수 있습니다", "error");
    //   return;
    // }

    if (!this.isSupported()) {
      this._setStatus("이 기기는 DeviceMotion/Orientation을 지원하지 않습니다", "error");
      return;
    }

    if (!hasMotionPermissionAPI() && !hasOrientationPermissionAPI()) {
      if (this.permissionsGranted && this.autoStart) {
        this.startListeners();
      } else {
        this._setStatus("센서를 사용할 준비가 되었습니다", "success");
      }
    } else {
      this.permissionsGranted = false;
      this._setStatus("센서 권한을 요청하세요", "muted");
    }
  }

  isSupported() {
    return (
      typeof window !== "undefined" &&
      ("DeviceMotionEvent" in window || "DeviceOrientationEvent" in window)
    );
  }

  async requestPermissions() {
    if (!this.isSupported()) {
      this._setStatus("센서를 지원하지 않는 브라우저", "error");
      return false;
    }

    try {
      let motionGranted = true;
      let orientationGranted = true;

      if (hasMotionPermissionAPI()) {
        motionGranted = (await DeviceMotionEvent.requestPermission()) === "granted";
      }

      if (hasOrientationPermissionAPI()) {
        orientationGranted = (await DeviceOrientationEvent.requestPermission()) === "granted";
      }

      if (motionGranted && orientationGranted) {
        this.permissionsGranted = true;
        this.startListeners();
        return true;
      }

      this.permissionsGranted = false;
      this._setStatus("센서 권한이 거부되었습니다", "error");
      return false;
    } catch (error) {
      console.error("Sensor permission error", error);
      this.permissionsGranted = false;
      this._setStatus("센서 권한 요청 중 오류", "error");
      return false;
    }
  }

  startListeners() {
    if (this.active) return;
    if (!this.permissionsGranted && (hasMotionPermissionAPI() || hasOrientationPermissionAPI())) {
      this._setStatus("센서 권한을 먼저 허용하세요", "warning");
      return;
    }

    window.addEventListener("devicemotion", this._handleMotion, true);
    window.addEventListener("deviceorientation", this._handleOrientation, true);

    this.active = true;
    this._setStatus("센서 입력 수집 중", "success");
  }

  stopListeners() {
    if (!this.active) return;

    window.removeEventListener("devicemotion", this._handleMotion, true);
    window.removeEventListener("deviceorientation", this._handleOrientation, true);

    this.active = false;
    this._setStatus("센서 대기 중", "muted");
  }

  hasPermission() {
    return this.permissionsGranted;
  }

  isActive() {
    return this.active;
  }

  refresh() {
    if (this.active) {
      this.stopListeners();
      this.startListeners();
    }
  }

  _handleMotion(event) {
    const acceleration = event.accelerationIncludingGravity ?? event.acceleration ?? {
      x: 0,
      y: 0,
      z: 0,
    };

    const rotationRate = event.rotationRate
      ? {
          alpha: event.rotationRate.alpha ?? 0,
          beta: event.rotationRate.beta ?? 0,
          gamma: event.rotationRate.gamma ?? 0,
        }
      : null;

    this.onMotion({
      acceleration,
      rotationRate,
      interval: event.interval,
      timestamp: performance.now(),
    });
  }

  _handleOrientation(event) {
    if (!event) return;

    this.onOrientation({
      alpha: event.alpha ?? 0,
      beta: event.beta ?? 0,
      gamma: event.gamma ?? 0,
      absolute: event.absolute ?? false,
      timestamp: performance.now(),
    });
  }

  _setStatus(message, variant = "muted") {
    if (!this.statusElement) return;
    this.statusElement.textContent = message;
    this.statusElement.dataset.variant = variant;
  }
}
