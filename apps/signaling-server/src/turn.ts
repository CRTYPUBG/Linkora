import crypto from "crypto";

export interface TurnCredentials {
  urls: string[];
  username: string;
  credential: string;
}

export class TurnManager {
  private secret: string;
  private urls: string[];

  constructor(secret = process.env.TURN_SECRET || "linkora-fallback-turn-secret-2026", urls?: string[]) {
    this.secret = secret;
    let detectedUrls: string[] = ["stun:stun.l.google.com:19302"];
    if (process.env.TURN_URLS) {
      detectedUrls = process.env.TURN_URLS.split(",").map((u) => u.trim());
    } else if (process.env.TURN_URL) {
      detectedUrls = [process.env.TURN_URL.trim()];
    } else if (process.env.EXTERNAL_IP) {
      detectedUrls = [
        `turn:${process.env.EXTERNAL_IP}:3478?transport=udp`,
        `turn:${process.env.EXTERNAL_IP}:3478?transport=tcp`,
      ];
    }
    this.urls = urls || detectedUrls;
  }

  /**
   * Generate ephemeral, time-limited HMAC-SHA1 credentials for coturn REST API.
   * Format: username = "<timestamp>:<client-id>"
   * Password = Base64(HMAC-SHA1(username, secret))
   */
  public generateCredentials(clientId: string, ttlSeconds = 3600 * 4): TurnCredentials {
    const expiry = Math.floor(Date.now() / 1000) + ttlSeconds;
    const username = `${expiry}:${clientId}`;
    const hmac = crypto.createHmac("sha1", this.secret);
    hmac.update(username);
    const credential = hmac.digest("base64");

    return {
      urls: this.urls,
      username,
      credential,
    };
  }

  public getIceServers(clientId: string) {
    const creds = this.generateCredentials(clientId);
    return [
      { urls: "stun:stun.l.google.com:19302" },
      {
        urls: creds.urls,
        username: creds.username,
        credential: creds.credential,
      },
    ];
  }
}
