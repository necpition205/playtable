import { GameScene } from "./game/GameScene.js";
import { DeviceMotionController } from "./input/DeviceMotionController.js";
import { NetworkClient } from "./net/NetworkClient.js";

const canvas = document.getElementById("gameCanvas");
const enableSensorsButton = document.getElementById("enableSensors");
const sensorStatusEl = document.getElementById("sensorStatus");
const wsStatusEl = document.getElementById("wsStatus");

const game = new GameScene(canvas);

const outboundThrottle = new Map();
const throttleSend = (channel, payload, minInterval = 80) => {
  const now = performance.now();
  const last = outboundThrottle.get(channel) ?? 0;
  if (now - last < minInterval) return;
  outboundThrottle.set(channel, now);
  network.sendMotion({ channel, ...payload });
};

const network = new NetworkClient({
  statusElement: wsStatusEl,
  onMessage: (message) => {
    if (!message) return;
    switch (message.type) {
      case "motion": {
        const { playerId, payload } = message;
        if (playerId && payload?.position) {
          game.updateRemotePlayer(playerId, payload);
        }
        break;
      }
      default:
        break;
    }
  },
});

const controller = new DeviceMotionController({
  statusElement: sensorStatusEl,
  onMotion: (motion) => {
    game.updatePlayerMotion(motion);
    throttleSend("motion", motion, 120);
  },
  onOrientation: (orientation) => {
    game.updatePlayerOrientation(orientation);
    throttleSend("orientation", orientation, 60);
  },
});

if (controller.active) {
  enableSensorsButton.disabled = true;
  enableSensorsButton.textContent = "센서 활성화 완료";
}

enableSensorsButton?.addEventListener("click", async () => {
  const granted = await controller.requestPermissions();
  if (granted) {
    enableSensorsButton.disabled = true;
    enableSensorsButton.textContent = "센서 활성화 완료";
  }
});

let pointerActive = false;
let lastPointer = { x: 0, y: 0 };

canvas.addEventListener("pointerdown", (event) => {
  pointerActive = true;
  lastPointer = { x: event.clientX, y: event.clientY };
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener("pointermove", (event) => {
  if (!pointerActive) return;
  const dx = event.clientX - lastPointer.x;
  const dy = event.clientY - lastPointer.y;
  lastPointer = { x: event.clientX, y: event.clientY };
  game.applyPointerDrag(dx, dy);
});

const endPointer = (event) => {
  pointerActive = false;
  try {
    canvas.releasePointerCapture(event.pointerId);
  } catch (error) {
    /* no-op */
  }
};

canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);

window.playtable = {
  game,
  network,
  controller,
};
