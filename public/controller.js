import { DeviceMotionController } from "./input/DeviceMotionController.js";
import { NetworkClient } from "./net/NetworkClient.js";

const form = document.getElementById("controllerForm");
const wsStatusEl = document.getElementById("ctrlWs");
const sensorStatusEl = document.getElementById("ctrlSensor");
const roomLabel = document.getElementById("ctrlRoom");
const controllerIdLabel = document.getElementById("ctrlId");
const sensorButton = document.getElementById("sensorRequest");
const statusSection = document.querySelector(".controller-status");
const sensorSection = document.querySelector(".sensor-readout");
const sensorLog = document.getElementById("sensorLog");

const initialRoom = new URLSearchParams(window.location.search).get("room");
if (initialRoom) {
  form.elements.code.value = initialRoom.toUpperCase();
}

const state = {
  roomCode: initialRoom ?? "",
  controllerId: null,
  controllerName: "모바일 컨트롤러",
  latestOrientation: null,
  latestMotion: null,
  lastSentAt: 0,
};

const network = new NetworkClient({ statusElement: wsStatusEl });

network.on("open", ({ reconnect }) => {
  if (reconnect && state.roomCode) {
    log("재연결 시도 중");
    network.send("registerController", { code: state.roomCode, name: state.controllerName });
  }
});

network.on("controllerRegistered", ({ controllerId, room }) => {
  state.controllerId = controllerId;
  roomLabel.textContent = room?.code ?? "-";
  controllerIdLabel.textContent = controllerId ?? "-";
  statusSection.hidden = false;
  sensorSection.hidden = false;
  sensorButton.disabled = deviceController.hasPermission();
  log(`컨트롤러 등록 완료. 플레이어에게 배정을 기다리세요.`);
  ensureSensorStreaming();
});

network.on("error", ({ message }) => {
  if (message) log(`오류: ${message}`);
});

network.on("roomState", (room) => {
  if (!room) return;
  const controller = room.controllers?.find?.((item) => item.id === state.controllerId);
  if (!controller) return;
  const statusMessage = controller.boundPlayerId
    ? `플레이어 ${resolvePlayerName(room, controller.boundPlayerId)}에 연결됨`
    : "대기 중";
  log(statusMessage);
});

const resolvePlayerName = (room, playerId) => {
  return room?.players?.find?.((player) => player.id === playerId)?.name ?? "플레이어";
};

const log = (message) => {
  const now = new Date().toLocaleTimeString();
  sensorLog.textContent = `[${now}] ${message}\n` + sensorLog.textContent.slice(0, 600);
};

const deviceController = new DeviceMotionController({
  statusElement: sensorStatusEl,
  autoStart: false,
  onMotion: (motion) => {
    state.latestMotion = motion;
    maybeSendInput();
    debugSensor();
  },
  onOrientation: (orientation) => {
    state.latestOrientation = orientation;
    maybeSendInput();
    debugSensor();
  },
});

const ensureSensorStreaming = () => {
  if (!deviceController.hasPermission()) return;
  if (!deviceController.isActive()) {
    deviceController.startListeners();
  }
};

const maybeSendInput = () => {
  if (!state.controllerId) return;
  const now = performance.now();
  if (now - state.lastSentAt < 70) return;

  if (!state.latestMotion && !state.latestOrientation) return;

  network.sendControllerInput({
    controllerId: state.controllerId,
    data: {
      orientation: state.latestOrientation,
      acceleration: state.latestMotion?.acceleration,
      rotationRate: state.latestMotion?.rotationRate,
      interval: state.latestMotion?.interval,
      timestamp: Date.now(),
    },
  });
  state.lastSentAt = now;
};

const debugSensor = () => {
  const orientation = state.latestOrientation
    ? `α ${state.latestOrientation.alpha?.toFixed(1)} β ${state.latestOrientation.beta?.toFixed(1)} γ ${state.latestOrientation.gamma?.toFixed(1)}`
    : "orientation: --";
  const acceleration = state.latestMotion?.acceleration
    ? `ax ${state.latestMotion.acceleration.x?.toFixed(2)} ay ${state.latestMotion.acceleration.y?.toFixed(2)} az ${state.latestMotion.acceleration.z?.toFixed(2)}`
    : "acc: --";
  sensorLog.textContent = `${orientation}\n${acceleration}`;
};

sensorButton.addEventListener("click", async () => {
  const granted = await deviceController.requestPermissions();
  if (granted) {
    sensorButton.disabled = true;
    log("센서 권한 허용됨");
    ensureSensorStreaming();
  }
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const formData = new FormData(form);
  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  const name = String(formData.get("name") ?? "모바일 컨트롤러").trim();
  if (!code) {
    log("방 코드를 입력하세요");
    return;
  }
  state.roomCode = code;
  state.controllerName = name || "모바일 컨트롤러";
  roomLabel.textContent = code;
  network.send("registerController", { code, name: state.controllerName });
  deviceController.stopListeners();
  log(`${code} 방 연결 시도 중`);
});

window.playtableController = {
  state,
  network,
  deviceController,
};
