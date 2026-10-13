import { ClientMessage, ServerMessage } from "@linkora/shared";

export type ConnectionState = "disconnected" | "connecting" | "connected" | "reconnecting" | "error";

export class SignalingClient {
  private ws: WebSocket | null = null;
  private url: string;
  private onMessageCallback: ((msg: ServerMessage) => void) | null = null;
  private onStateChangeCallback: ((state: ConnectionState) => void) | null = null;
  private pingInterval: any = null;
  private state: ConnectionState = "disconnected";

  constructor(url = "ws://127.0.0.1:4000/ws") {
    this.url = url;
  }

  public setUrl(url: string) {
    this.url = url;
  }

  public onMessage(cb: (msg: ServerMessage) => void) {
    this.onMessageCallback = cb;
  }

  public onStateChange(cb: (state: ConnectionState) => void) {
    this.onStateChangeCallback = cb;
  }

  private setState(newState: ConnectionState) {
    this.state = newState;
    if (this.onStateChangeCallback) {
      this.onStateChangeCallback(newState);
    }
  }

  public getState(): ConnectionState {
    return this.state;
  }

  public connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.setState("connecting");
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          this.setState("connected");
          this.startHeartbeat();
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const parsed = JSON.parse(event.data) as ServerMessage;
            if (this.onMessageCallback) {
              this.onMessageCallback(parsed);
            }
          } catch (e) {
            console.error("Failed to parse signaling message:", e);
          }
        };

        this.ws.onerror = (e) => {
          this.setState("error");
          reject(e);
        };

        this.ws.onclose = () => {
          this.stopHeartbeat();
          this.setState("disconnected");
        };
      } catch (err) {
        this.setState("error");
        reject(err);
      }
    });
  }

  public send(msg: ClientMessage) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.pingInterval = setInterval(() => {
      this.send({ type: "ping", timestamp: Date.now() });
    }, 15000);
  }

  private stopHeartbeat() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  public disconnect() {
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setState("disconnected");
  }
}
