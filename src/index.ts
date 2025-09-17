import staticPlugin from "@elysiajs/static";
import { Elysia } from "elysia";

type Visibility = "public" | "private";
type PlayerMode = "player" | "spectator";
type TeamSide = "A" | "B";

type ClientRole = "display" | "controller";

type ControllerStatus = "idle" | "paired" | "streaming";

type RoomSettings = {
  targetScore: number;
  matchMinutes: number;
  visibility: Visibility;
};

type Player = {
  id: string;
  name: string;
  team: TeamSide;
  mode: PlayerMode;
  isHost: boolean;
  connected: boolean;
  controllerIds: Set<string>;
};

type Controller = {
  id: string;
  name: string;
  status: ControllerStatus;
  boundPlayerId: string | null;
  socket: RoomSocket | null;
  lastSeen: number;
};

type MatchState = {
  status: "idle" | "countdown" | "playing" | "finished";
  scores: Record<TeamSide, number>;
  startedAt: number | null;
  durationSeconds: number;
};

type RoomSocket = {
  id?: string;
  data: ConnectionState;
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
} & Record<string, unknown>;

type Room = {
  code: string;
  createdAt: number;
  settings: RoomSettings;
  hostPlayerId: string;
  players: Map<string, Player>;
  controllers: Map<string, Controller>;
  displays: Set<RoomSocket>;
  match: MatchState;
};

type ConnectionState = {
  clientId: string;
  role: ClientRole | null;
  roomCode: string | null;
  playerId: string | null;
  controllerId: string | null;
};

type IncomingMessage = {
  type: string;
  payload?: any;
};

const rooms = new Map<string, Room>();

const randomId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);

const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

const generateRoomCode = () => {
  let code = "";
  for (let i = 0; i < 5; i += 1) {
    const index = Math.floor(Math.random() * ROOM_CODE_ALPHABET.length);
    code += ROOM_CODE_ALPHABET[index];
  }
  return code;
};

const createInitialSettings = (visibility: Visibility = "private"): RoomSettings => ({
  targetScore: 11,
  matchMinutes: 10,
  visibility,
});

const createMatchState = (settings: RoomSettings): MatchState => ({
  status: "idle",
  scores: { A: 0, B: 0 },
  startedAt: null,
  durationSeconds: settings.matchMinutes * 60,
});

const ensureBalancedTeam = (room: Room): TeamSide => {
  let teamA = 0;
  let teamB = 0;
  room.players.forEach((player) => {
    if (player.mode === "player") {
      if (player.team === "A") teamA += 1;
      else teamB += 1;
    }
  });
  return teamA <= teamB ? "A" : "B";
};

const serializeRoom = (room: Room) => ({
  code: room.code,
  createdAt: room.createdAt,
  settings: room.settings,
  hostPlayerId: room.hostPlayerId,
  players: Array.from(room.players.values()).map((player) => ({
    id: player.id,
    name: player.name,
    team: player.team,
    mode: player.mode,
    isHost: player.isHost,
    connected: player.connected,
    controllerIds: Array.from(player.controllerIds),
  })),
  controllers: Array.from(room.controllers.values()).map((controller) => ({
    id: controller.id,
    name: controller.name,
    status: controller.status,
    boundPlayerId: controller.boundPlayerId,
    lastSeen: controller.lastSeen,
  })),
  match: room.match,
});

const sendJson = (socket: RoomSocket, data: unknown) => {
  try {
    socket.send(JSON.stringify(data));
  } catch (error) {
    console.error("Failed to send message", error);
  }
};

const broadcastToRoom = (
  room: Room,
  message: unknown,
  filter?: (socket: RoomSocket) => boolean,
) => {
  room.displays.forEach((socket) => {
    if (filter && !filter(socket)) return;
    sendJson(socket, message);
  });
};

const pushRoomState = (room: Room) => {
  const snapshot = serializeRoom(room);
  broadcastToRoom(room, { type: "roomState", payload: snapshot });
};

const removeControllerFromRoom = (room: Room, controllerId: string) => {
  const controller = room.controllers.get(controllerId);
  if (!controller) return;

  if (controller.boundPlayerId) {
    const player = room.players.get(controller.boundPlayerId);
    player?.controllerIds.delete(controllerId);
  }

  room.controllers.delete(controllerId);
};

const asRoomSocket = (socket: unknown): RoomSocket => socket as RoomSocket;

const resolveRoomFromSocket = (
  socket: unknown,
): Room | null => {
  const ws = asRoomSocket(socket);
  const code = ws.data.roomCode;
  if (!code) return null;
  return rooms.get(code) ?? null;
};

const detachSocket = (socket: unknown) => {
  const ws = asRoomSocket(socket);
  const room = resolveRoomFromSocket(ws);
  if (!room) return;

  const { playerId, controllerId } = ws.data;

  if (playerId && room.players.has(playerId)) {
    const player = room.players.get(playerId)!;
    player.connected = false;
    room.displays.delete(ws);

    if (player.isHost) {
      room.hostPlayerId = Array.from(room.players.values()).find((p) => p.connected)?.id ?? player.id;
      const newHost = room.players.get(room.hostPlayerId);
      if (newHost) newHost.isHost = true;
      if (player.id !== room.hostPlayerId) {
        player.isHost = false;
      }
    }

    pushRoomState(room);
  }

  if (controllerId && room.controllers.has(controllerId)) {
    removeControllerFromRoom(room, controllerId);
    ws.data.controllerId = null;
    pushRoomState(room);
  }
};

const app = new Elysia()
  .use(staticPlugin({ assets: "public", prefix: "/", indexHTML: true }))
  .ws("/ws", {
    open: (socket) => {
      const ws = asRoomSocket(socket);
      ws.data = {
        clientId: randomId(),
        role: null,
        roomCode: null,
        playerId: null,
        controllerId: null,
      };
      console.log("Client connected", ws.id);
      sendJson(ws, {
        type: "handshake",
        payload: { clientId: ws.data.clientId },
      });
    },
    close: (socket) => {
      const ws = asRoomSocket(socket);
      console.log("Client disconnected", ws.id);
      detachSocket(ws);
    },
    message: (socket, raw) => {
      const ws = asRoomSocket(socket);
      let payload: IncomingMessage | null = null;
      if (typeof raw === "string") {
        try {
          payload = JSON.parse(raw);
        } catch (error) {
          console.warn("Invalid JSON payload", error);
          return;
        }
      } else if (typeof raw === "object" && raw && "type" in raw) {
        payload = raw as IncomingMessage;
      }
      if (!payload) return;

      const { type, payload: body } = payload;
      switch (type) {
        case "createRoom": {
          const name = String(body?.name ?? "Host").slice(0, 32);
          const visibility: Visibility = body?.visibility === "public" ? "public" : "private";
          const requestedTargetScore = Number(body?.targetScore ?? 11) || 11;
          const requestedMatchMinutes = Number(body?.matchMinutes ?? 10) || 10;
          const targetScore = Math.max(1, Math.min(requestedTargetScore, 21));
          const matchMinutes = Math.max(1, Math.min(requestedMatchMinutes, 60));

          let roomCode = generateRoomCode();
          while (rooms.has(roomCode)) {
            roomCode = generateRoomCode();
          }

          const playerId = randomId();
          const settings = {
            ...createInitialSettings(visibility),
            targetScore,
            matchMinutes,
          } satisfies RoomSettings;

          const room: Room = {
            code: roomCode,
            createdAt: Date.now(),
            settings,
            hostPlayerId: playerId,
            players: new Map(),
            controllers: new Map(),
            displays: new Set(),
            match: createMatchState(settings),
          };

          const hostPlayer: Player = {
            id: playerId,
            name,
            team: "A",
            mode: "player",
            isHost: true,
            connected: true,
            controllerIds: new Set(),
          };

          room.players.set(playerId, hostPlayer);
          room.displays.add(ws);

          ws.data.role = "display";
          ws.data.roomCode = room.code;
          ws.data.playerId = playerId;

          rooms.set(room.code, room);

          sendJson(ws, {
            type: "roomCreated",
            payload: { room: serializeRoom(room), playerId },
          });
          pushRoomState(room);
          break;
        }
        case "joinRoom": {
          const roomCode: string = String(body?.code ?? "").trim().toUpperCase();
          const name = String(body?.name ?? "Player").slice(0, 32);
          const asSpectator = Boolean(body?.spectator);
          const requestedTeam: TeamSide | null =
            body?.team === "A" || body?.team === "B" ? body.team : null;

          const room = rooms.get(roomCode);
          if (!room) {
            sendJson(ws, { type: "error", payload: { message: "방을 찾을 수 없습니다." } });
            return;
          }

          const playerId = randomId();
          const team = requestedTeam ?? ensureBalancedTeam(room);

          const player: Player = {
            id: playerId,
            name,
            team,
            mode: asSpectator ? "spectator" : "player",
            isHost: false,
            connected: true,
            controllerIds: new Set(),
          };

          room.players.set(playerId, player);
          room.displays.add(ws);

          ws.data.role = "display";
          ws.data.roomCode = room.code;
          ws.data.playerId = playerId;

          sendJson(ws, {
            type: "joinedRoom",
            payload: { room: serializeRoom(room), playerId },
          });
          pushRoomState(room);
          break;
        }
        case "registerController": {
          const roomCode: string = String(body?.code ?? "").trim().toUpperCase();
          const name = String(body?.name ?? "모바일").slice(0, 32);
          const room = rooms.get(roomCode);
          if (!room) {
            sendJson(ws, { type: "error", payload: { message: "방을 찾을 수 없습니다." } });
            return;
          }

          const controllerId = randomId();
          const controller: Controller = {
            id: controllerId,
            name,
            status: "idle",
            boundPlayerId: null,
            socket: ws,
            lastSeen: Date.now(),
          };

          room.controllers.set(controllerId, controller);
          ws.data.role = "controller";
          ws.data.roomCode = room.code;
          ws.data.controllerId = controllerId;

          sendJson(ws, {
            type: "controllerRegistered",
            payload: { controllerId, room: serializeRoom(room) },
          });
          pushRoomState(room);
          break;
        }
        case "bindController": {
          const room = resolveRoomFromSocket(ws);
          if (!room) return;

          const requester = ws.data.playerId ? room.players.get(ws.data.playerId) : null;
          if (!requester) return;
          if (!requester.isHost) {
            sendJson(ws, {
              type: "error",
              payload: { message: "방장만 컨트롤러를 연결할 수 있습니다." },
            });
            return;
          }

          const controllerId: string = body?.controllerId;
          const playerId: string = body?.playerId;

          if (!controllerId || !playerId) return;

          const controller = room.controllers.get(controllerId);
          const player = room.players.get(playerId);
          if (!controller || !player) return;

          if (controller.boundPlayerId && controller.boundPlayerId !== playerId) {
            const previous = room.players.get(controller.boundPlayerId);
            previous?.controllerIds.delete(controllerId);
          }

          controller.boundPlayerId = playerId;
          controller.status = "paired";
          player.controllerIds.add(controllerId);

          sendJson(ws, { type: "controllerBound", payload: { controllerId, playerId } });
          pushRoomState(room);
          break;
        }
        case "unbindController": {
          const room = resolveRoomFromSocket(ws);
          if (!room) return;
          const requester = ws.data.playerId ? room.players.get(ws.data.playerId) : null;
          if (!requester) return;
          if (!requester.isHost) {
            sendJson(ws, {
              type: "error",
              payload: { message: "방장만 컨트롤러 연결을 해제할 수 있습니다." },
            });
            return;
          }
          const controllerId: string = body?.controllerId;
          if (!controllerId) return;
          const controller = room.controllers.get(controllerId);
          if (!controller) return;
          const boundPlayerId = controller.boundPlayerId;
          controller.boundPlayerId = null;
          controller.status = "idle";
          if (boundPlayerId) {
            const player = room.players.get(boundPlayerId);
            player?.controllerIds.delete(controllerId);
          }
          pushRoomState(room);
          break;
        }
        case "updateSettings": {
          const room = resolveRoomFromSocket(ws);
          if (!room) return;
          const requester = ws.data.playerId ? room.players.get(ws.data.playerId) : null;
          if (!requester?.isHost) {
            sendJson(ws, {
              type: "error",
              payload: { message: "방장만 방 설정을 변경할 수 있습니다." },
            });
            return;
          }
          const targetScore = Math.max(1, Math.min(Number(body?.targetScore ?? room.settings.targetScore), 21));
          const matchMinutes = Math.max(1, Math.min(Number(body?.matchMinutes ?? room.settings.matchMinutes), 60));
          const visibility: Visibility = body?.visibility === "public" ? "public" : room.settings.visibility;

          room.settings = {
            targetScore,
            matchMinutes,
            visibility,
          };
          room.match.durationSeconds = room.settings.matchMinutes * 60;
          pushRoomState(room);
          break;
        }
        case "setPlayerMode": {
          const room = resolveRoomFromSocket(ws);
          if (!room) return;

          const targetPlayerId: string = body?.playerId ?? ws.data.playerId;
          const mode: PlayerMode = body?.mode === "spectator" ? "spectator" : "player";

          const actor = ws.data.playerId ? room.players.get(ws.data.playerId) : null;
          const target = targetPlayerId ? room.players.get(targetPlayerId) : null;
          if (!target) return;

          if (target.id !== actor?.id && !actor?.isHost) {
            sendJson(ws, {
              type: "error",
              payload: { message: "방장만 다른 플레이어의 상태를 변경할 수 있습니다." },
            });
            return;
          }

          target.mode = mode;
          pushRoomState(room);
          break;
        }
        case "setPlayerTeam": {
          const room = resolveRoomFromSocket(ws);
          if (!room) return;

          const targetPlayerId: string = body?.playerId ?? ws.data.playerId;
          const team: TeamSide = body?.team === "A" ? "A" : body?.team === "B" ? "B" : "A";

          const actor = ws.data.playerId ? room.players.get(ws.data.playerId) : null;
          const target = targetPlayerId ? room.players.get(targetPlayerId) : null;
          if (!target) return;

          if (target.id !== actor?.id && !actor?.isHost) {
            sendJson(ws, {
              type: "error",
              payload: { message: "방장만 다른 플레이어의 팀을 이동시킬 수 있습니다." },
            });
            return;
          }

          target.team = team;
          pushRoomState(room);
          break;
        }
        case "kickPlayer": {
          const room = resolveRoomFromSocket(ws);
          if (!room) return;
          const actor = ws.data.playerId ? room.players.get(ws.data.playerId) : null;
          if (!actor?.isHost) {
            sendJson(ws, {
              type: "error",
              payload: { message: "방장만 플레이어를 추방할 수 있습니다." },
            });
            return;
          }
          const playerId: string = body?.playerId;
          if (!playerId) return;
          const target = room.players.get(playerId);
          if (!target) return;

          if (target.controllerIds.size > 0) {
            target.controllerIds.forEach((controllerId) => {
              const controller = room.controllers.get(controllerId);
              if (controller) {
                controller.boundPlayerId = null;
                controller.status = "idle";
              }
            });
          }

          room.players.delete(playerId);
          room.displays.forEach((client) => {
            if (client.data.playerId === playerId) {
              sendJson(client, { type: "kicked" });
              client.close(4001, "kicked");
            }
          });
          pushRoomState(room);
          break;
        }
        case "controllerInput": {
          const room = resolveRoomFromSocket(ws);
          if (!room) return;
          const controllerId = ws.data.controllerId ?? body?.controllerId;
          if (!controllerId) return;
          const controller = room.controllers.get(controllerId);
          if (!controller) return;
          controller.lastSeen = Date.now();
          if (!controller.boundPlayerId) return;

          controller.status = "streaming";
          broadcastToRoom(room, {
            type: "playerMotion",
            payload: {
              playerId: controller.boundPlayerId,
              controllerId,
              data: body?.data ?? {},
            },
          });
          break;
        }
        case "startMatch": {
          const room = resolveRoomFromSocket(ws);
          if (!room) return;
          const actor = ws.data.playerId ? room.players.get(ws.data.playerId) : null;
          if (!actor?.isHost) {
            sendJson(ws, {
              type: "error",
              payload: { message: "방장만 게임을 시작할 수 있습니다." },
            });
            return;
          }
          room.match.status = "playing";
          room.match.startedAt = Date.now();
          room.match.scores = { A: 0, B: 0 };
          room.match.durationSeconds = room.settings.matchMinutes * 60;
          pushRoomState(room);
          break;
        }
        case "stopMatch": {
          const room = resolveRoomFromSocket(ws);
          if (!room) return;
          const actor = ws.data.playerId ? room.players.get(ws.data.playerId) : null;
          if (!actor?.isHost) {
            sendJson(ws, {
              type: "error",
              payload: { message: "방장만 게임을 종료할 수 있습니다." },
            });
            return;
          }
          room.match.status = "finished";
          pushRoomState(room);
          break;
        }
        default:
          sendJson(ws, {
            type: "error",
            payload: { message: `알 수 없는 명령: ${type}` },
          });
      }
    },
  })
  .listen(3000, () => console.log("Server started on http://localhost:3000"));

// export default app;
