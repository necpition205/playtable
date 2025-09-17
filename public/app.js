import { GameScene } from "./game/GameScene.js";
import { NetworkClient } from "./net/NetworkClient.js";

const canvas = document.getElementById("gameCanvas");
const wsStatusEl = document.getElementById("wsStatus");
const sensorStatusEl = document.getElementById("sensorStatus");
const lobbyPanel = document.querySelector('[data-panel="lobby"]');
const arenaMain = document.querySelector('[data-panel="arena"]');
const playersPanel = document.querySelector('[data-panel="players"]');
const overlayMessage = document.getElementById("overlayMessage");
const roomCodeLabel = document.getElementById("roomCodeLabel");
const matchStatusLabel = document.getElementById("matchStatus");
const scoreALabel = document.getElementById("scoreA");
const scoreBLabel = document.getElementById("scoreB");
const arenaHeader = document.getElementById("arenaHeader");
const controlDock = document.getElementById("controlDock");
const hostControlsWrap = document.getElementById("hostControls");
const playerActionsWrap = document.getElementById("playerActions");
const teamAList = document.getElementById("teamAList");
const teamBList = document.getElementById("teamBList");
const spectatorList = document.getElementById("spectatorList");
const controllerList = document.getElementById("controllerList");
const createRoomForm = document.getElementById("createRoomForm");
const joinRoomForm = document.getElementById("joinRoomForm");
const qrButton = document.getElementById("openQrBtn");
const qrDialog = document.getElementById("qrDialog");
const qrCanvas = document.getElementById("qrCanvas");
const qrLink = document.getElementById("qrLink");
const closeQrBtn = document.getElementById("closeQrBtn");

sensorStatusEl.textContent = "데스크탑: WASD + 마우스";
sensorStatusEl.dataset.variant = "success";

const game = new GameScene(canvas);

const state = {
  playerId: null,
  room: null,
  controllerLink: null,
  keyboard: {
    forward: 0,
    right: 0,
    up: 0,
    rotateYaw: 0,
    rotatePitch: 0,
  },
  keyPressed: new Set(),
};

const network = new NetworkClient({
  statusElement: wsStatusEl,
});

network.on("roomCreated", (payload) => {
  state.playerId = payload?.playerId ?? null;
  state.room = payload?.room ?? null;
  activateArena();
  renderRoomState(payload?.room ?? null);
});

network.on("joinedRoom", (payload) => {
  state.playerId = payload?.playerId ?? null;
  state.room = payload?.room ?? null;
  activateArena();
  renderRoomState(payload?.room ?? null);
});

network.on("roomState", (payload) => {
  state.room = payload;
  renderRoomState(payload);
});

network.on("playerMotion", ({ playerId, data }) => {
  if (!playerId || playerId === state.playerId) return;
  game.applyRemoteMotion(playerId, data);
});

network.on("error", ({ message }) => {
  if (message) {
    showOverlay(message, 1800);
  }
});

network.on("kicked", () => {
  showOverlay("방에서 추방되었습니다", 0);
  resetToLobby();
});

const showOverlay = (message, timeoutMs = 0) => {
  overlayMessage.textContent = message;
  overlayMessage.hidden = false;
  if (timeoutMs > 0) {
    window.setTimeout(() => {
      overlayMessage.hidden = true;
    }, timeoutMs);
  }
};

const hideOverlay = () => {
  overlayMessage.hidden = true;
};

const activateArena = () => {
  hideOverlay();
  lobbyPanel.setAttribute("hidden", "true");
  playersPanel.removeAttribute("hidden");
  arenaHeader.removeAttribute("hidden");
  controlDock.removeAttribute("hidden");
  arenaMain.classList.add("active");
  qrButton.disabled = false;
};

const resetToLobby = () => {
  lobbyPanel.removeAttribute("hidden");
  playersPanel.setAttribute("hidden", "true");
  arenaHeader.setAttribute("hidden", "true");
  controlDock.setAttribute("hidden", "true");
  arenaMain.classList.remove("active");
  qrButton.disabled = true;
  state.playerId = null;
  state.room = null;
  game.syncRoster([]);
};

const renderRoomState = (room) => {
  if (!room) return;
  game.setLocalPlayerId(state.playerId);
  const players = room.players ?? [];
  game.syncRoster(players);

  roomCodeLabel.textContent = room.code ?? "-----";
  matchStatusLabel.textContent = formatMatchStatus(room.match);
  scoreALabel.textContent = room.match?.scores?.A ?? 0;
  scoreBLabel.textContent = room.match?.scores?.B ?? 0;

  renderHostControls();
  renderPlayerActions();
  renderRoster(players);
  renderControllers(room.controllers ?? []);
  updateQrLink();
};

const formatMatchStatus = (match) => {
  if (!match) return "대기 중";
  switch (match.status) {
    case "playing":
      return "경기 중";
    case "countdown":
      return "카운트다운";
    case "finished":
      return "경기 종료";
    default:
      return "대기 중";
  }
};

const renderHostControls = () => {
  const isHost = getSelf()?.isHost ?? false;
  hostControlsWrap.innerHTML = "";
  if (!isHost) return;

  const room = state.room;
  const fragment = document.createDocumentFragment();

  const startBtn = document.createElement("button");
  startBtn.className = "primary";
  startBtn.textContent = room?.match?.status === "playing" ? "경기 진행 중" : "경기 시작";
  startBtn.disabled = room?.match?.status === "playing";
  startBtn.addEventListener("click", () => network.send("startMatch"));
  fragment.appendChild(startBtn);

  const stopBtn = document.createElement("button");
  stopBtn.className = "secondary";
  stopBtn.textContent = "경기 종료";
  stopBtn.addEventListener("click", () => network.send("stopMatch"));
  fragment.appendChild(stopBtn);

  const settingsForm = document.createElement("form");
  settingsForm.className = "inline-form";
  settingsForm.innerHTML = `
    <label>
      <span>타깃 점수</span>
      <input type="number" name="targetScore" min="1" max="21" value="${room?.settings?.targetScore ?? 11}" />
    </label>
    <label>
      <span>게임 시간</span>
      <input type="number" name="matchMinutes" min="1" max="60" value="${room?.settings?.matchMinutes ?? 10}" />
    </label>
    <label>
      <span>공개</span>
      <select name="visibility">
        <option value="private" ${room?.settings?.visibility !== "public" ? "selected" : ""}>비공개</option>
        <option value="public" ${room?.settings?.visibility === "public" ? "selected" : ""}>공개</option>
      </select>
    </label>
    <button type="submit" class="ghost">설정 저장</button>
  `;
  settingsForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(settingsForm);
    network.send("updateSettings", {
      targetScore: Number(formData.get("targetScore")),
      matchMinutes: Number(formData.get("matchMinutes")),
      visibility: formData.get("visibility"),
    });
  });
  fragment.appendChild(settingsForm);

  hostControlsWrap.appendChild(fragment);
};

const renderPlayerActions = () => {
  playerActionsWrap.innerHTML = "";
  const self = getSelf();
  if (!self) return;

  const toggleMode = document.createElement("button");
  toggleMode.className = "ghost";
  toggleMode.textContent = self.mode === "spectator" ? "참여자로 전환" : "관전 모드";
  toggleMode.addEventListener("click", () => {
    network.send("setPlayerMode", {
      mode: self.mode === "spectator" ? "player" : "spectator",
    });
  });

  const teamButtons = document.createElement("div");
  teamButtons.className = "inline-actions";

  const teamABtn = document.createElement("button");
  teamABtn.className = "ghost";
  teamABtn.textContent = "A 팀";
  teamABtn.disabled = self.team === "A";
  teamABtn.addEventListener("click", () => network.send("setPlayerTeam", { team: "A" }));

  const teamBBtn = document.createElement("button");
  teamBBtn.className = "ghost";
  teamBBtn.textContent = "B 팀";
  teamBBtn.disabled = self.team === "B";
  teamBBtn.addEventListener("click", () => network.send("setPlayerTeam", { team: "B" }));

  teamButtons.append(teamABtn, teamBBtn);

  playerActionsWrap.append(toggleMode, teamButtons);
};

const renderRoster = (players = []) => {
  const teamA = players.filter((p) => p.team === "A" && p.mode === "player");
  const teamB = players.filter((p) => p.team === "B" && p.mode === "player");
  const spectators = players.filter((p) => p.mode === "spectator");

  populateList(teamAList, teamA, createPlayerListItem);
  populateList(teamBList, teamB, createPlayerListItem);
  populateList(spectatorList, spectators, createPlayerListItem);
};

const renderControllers = (controllers = []) => {
  populateList(controllerList, controllers, createControllerItem);
};

const populateList = (container, items, factory) => {
  container.innerHTML = "";
  const fragment = document.createDocumentFragment();
  items.forEach((item) => fragment.appendChild(factory(item)));
  if (!items.length) {
    const empty = document.createElement("li");
    empty.textContent = "비어 있음";
    empty.className = "muted small";
    container.appendChild(empty);
    return;
  }
  container.appendChild(fragment);
};

const createPlayerListItem = (player) => {
  const node = document.createElement("li");
  const meta = document.createElement("div");
  meta.className = "meta";
  meta.innerHTML = `<strong>${player.name}</strong><span>${player.mode === "spectator" ? "관전" : "플레이"}</span>`;

  const badges = document.createElement("div");
  badges.className = "inline-actions";

  if (player.isHost) {
    const hostBadge = document.createElement("span");
    hostBadge.className = "badge host";
    hostBadge.textContent = "HOST";
    badges.appendChild(hostBadge);
  }

  if (player.mode === "spectator") {
    const spectatorBadge = document.createElement("span");
    spectatorBadge.className = "badge spectator";
    spectatorBadge.textContent = "관전자";
    badges.appendChild(spectatorBadge);
  }

  if (player.connected) {
    const active = document.createElement("span");
    active.className = "badge active";
    active.textContent = "온라인";
    badges.appendChild(active);
  }

  const host = getSelf();
  if (host?.isHost && player.id !== host.id) {
    const forceA = document.createElement("button");
    forceA.className = "ghost";
    forceA.textContent = "팀 A";
    forceA.addEventListener("click", () => network.send("setPlayerTeam", { playerId: player.id, team: "A" }));

    const forceB = document.createElement("button");
    forceB.className = "ghost";
    forceB.textContent = "팀 B";
    forceB.addEventListener("click", () => network.send("setPlayerTeam", { playerId: player.id, team: "B" }));

    const toggleMode = document.createElement("button");
    toggleMode.className = "ghost";
    toggleMode.textContent = player.mode === "player" ? "관전 전환" : "참여 전환";
    toggleMode.addEventListener("click", () => network.send("setPlayerMode", {
      playerId: player.id,
      mode: player.mode === "player" ? "spectator" : "player",
    }));

    const kickBtn = document.createElement("button");
    kickBtn.className = "ghost";
    kickBtn.textContent = "킥";
    kickBtn.addEventListener("click", () => network.send("kickPlayer", { playerId: player.id }));

    badges.append(forceA, forceB, toggleMode, kickBtn);
  }

  if (player.controllerIds?.length) {
    const controllerBadge = document.createElement("span");
    controllerBadge.className = "badge";
    controllerBadge.textContent = `연결된 컨트롤러 ${player.controllerIds.length}`;
    badges.appendChild(controllerBadge);
  }

  node.append(meta, badges);
  return node;
};

const createControllerItem = (controller) => {
  const node = document.createElement("li");
  const meta = document.createElement("div");
  meta.className = "meta";
  const boundText = controller.boundPlayerId ? `→ ${resolvePlayerName(controller.boundPlayerId)}` : "대기 중";
  meta.innerHTML = `<strong>${controller.name}</strong><span>${boundText}</span>`;

  const actions = document.createElement("div");
  actions.className = "inline-actions";

  const host = getSelf();
  if (host?.isHost) {
    if (controller.boundPlayerId) {
      const unbind = document.createElement("button");
      unbind.className = "ghost";
      unbind.textContent = "연결 해제";
      unbind.addEventListener("click", () => network.send("unbindController", { controllerId: controller.id }));
      actions.appendChild(unbind);
    } else {
      const candidates = (state.room?.players ?? []).filter((player) => player.mode === "player");
      candidates.forEach((player) => {
        const assign = document.createElement("button");
        assign.className = "ghost";
        assign.textContent = `${player.name} 배정`;
        assign.addEventListener("click", () => network.send("bindController", {
          controllerId: controller.id,
          playerId: player.id,
        }));
        actions.appendChild(assign);
      });
    }
  }

  node.append(meta, actions);
  return node;
};

const resolvePlayerName = (playerId) => {
  return state.room?.players?.find?.((player) => player.id === playerId)?.name ?? "플레이어";
};

const updateQrLink = () => {
  if (!state.room?.code) return;
  const url = new URL(window.location.href);
  url.pathname = "/controller.html";
  url.searchParams.set("room", state.room.code);
  state.controllerLink = url.toString();
};

qrButton?.addEventListener("click", () => {
  if (!state.controllerLink) return;
  if (typeof QRCode !== "undefined") {
    QRCode.toCanvas(qrCanvas, state.controllerLink, { width: 260 });
  }
  qrLink.textContent = state.controllerLink;
  qrDialog.showModal();
});

closeQrBtn?.addEventListener("click", () => {
  qrDialog.close();
});

createRoomForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const formData = new FormData(createRoomForm);
  network.send("createRoom", {
    name: formData.get("name"),
    targetScore: Number(formData.get("targetScore")),
    matchMinutes: Number(formData.get("matchMinutes")),
    visibility: formData.get("visibility"),
  });
});

joinRoomForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const formData = new FormData(joinRoomForm);
  network.send("joinRoom", {
    code: String(formData.get("code") ?? "").trim().toUpperCase(),
    name: formData.get("name"),
    spectator: formData.get("spectator") === "on",
  });
});

const getSelf = () => {
  return state.room?.players?.find?.((player) => player.id === state.playerId) ?? null;
};

const updateKeyboard = () => {
  const pressed = state.keyPressed;
  state.keyboard.forward = (pressed.has("KeyW") || pressed.has("ArrowUp") ? 1 : 0) - (pressed.has("KeyS") || pressed.has("ArrowDown") ? 1 : 0);
  state.keyboard.right = (pressed.has("KeyD") || pressed.has("ArrowRight") ? 1 : 0) - (pressed.has("KeyA") || pressed.has("ArrowLeft") ? 1 : 0);
  state.keyboard.up = (pressed.has("Space") ? 1 : 0) - (pressed.has("ShiftLeft") || pressed.has("ShiftRight") ? 1 : 0);
  state.keyboard.rotateYaw = (pressed.has("KeyQ") ? 1 : 0) - (pressed.has("KeyE") ? 1 : 0);
  state.keyboard.rotatePitch = (pressed.has("KeyR") ? 1 : 0) - (pressed.has("KeyF") ? 1 : 0);
  game.applyKeyboardInput(state.keyboard);
};

window.addEventListener("keydown", (event) => {
  state.keyPressed.add(event.code);
  updateKeyboard();
});

window.addEventListener("keyup", (event) => {
  state.keyPressed.delete(event.code);
  updateKeyboard();
});

updateKeyboard();

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
  network,
  game,
  state,
};
