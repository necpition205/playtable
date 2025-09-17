const createDefaultURL = () => {
  if (typeof window === "undefined") return "";
  const { protocol, host } = window.location;
  const wsProtocol = protocol === "https:" ? "wss" : "ws";
  return `${wsProtocol}://${host}/ws`;
};

export class NetworkClient {
  constructor({ url = createDefaultURL(), onMessage, statusElement } = {}) {
    this.url = url;
    this.onMessage = onMessage ?? (() => {});
    this.statusElement = statusElement ?? null;
    this.socket = null;
    this.shouldAttemptReconnect = true;
    this.reconnectDelay = 1500;

    if (this.url) {
      this.connect();
    } else {
      this._setStatus("WS URL이 설정되지 않았습니다", "error");
    }
  }

  connect() {
    this.disconnect({ permanent: false });

    try {
      this.socket = new WebSocket(this.url);
    } catch (error) {
      console.error("WebSocket init error", error);
      this._scheduleReconnect();
      return;
    }

    this.shouldAttemptReconnect = true;

    const socket = this.socket;

    socket.addEventListener("open", () => {
      if (this.socket !== socket) return;
      this._setStatus("WS: 연결됨", "success");
      this.reconnectDelay = 1500;
    });

    socket.addEventListener("close", () => {
      if (this.socket !== socket) return;
      this._setStatus("WS: 연결 끊김", "error");
      if (this.shouldAttemptReconnect) {
        this._scheduleReconnect();
      }
    });

    socket.addEventListener("error", (event) => {
      if (this.socket !== socket) return;
      console.warn("WebSocket error", event);
      this._setStatus("WS: 에러", "error");
    });

    socket.addEventListener("message", (event) => {
      if (this.socket !== socket) return;
      try {
        const payload = JSON.parse(event.data);
        this.onMessage(payload);
      } catch (error) {
        console.warn("WS message parse error", error, event.data);
      }
    });
  }

  disconnect({ permanent = true } = {}) {
    if (!this.socket) return;

    this.shouldAttemptReconnect = !permanent;
    const socket = this.socket;
    this.socket = null;
    try {
      socket.close(1000, "client shutdown");
    } catch (error) {
      console.warn("WS close error", error);
    }
  }

  send(type, payload = {}) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(
      JSON.stringify({
        type,
        payload,
        sentAt: Date.now(),
      })
    );
  }

  sendMotion(payload) {
    this.send("motion", payload);
  }

  _scheduleReconnect() {
    if (!this.shouldAttemptReconnect) return;
    setTimeout(() => {
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.4, 8000);
      this.connect();
    }, this.reconnectDelay);
  }

  _setStatus(message, variant = "muted") {
    if (!this.statusElement) return;
    this.statusElement.textContent = message;
    this.statusElement.dataset.variant = variant;
  }
}
