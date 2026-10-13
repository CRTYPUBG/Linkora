import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import { createServer } from "../src/server.js";
import { ROOM_CONSTANTS } from "@linkora/shared";

describe("Linkora Signaling Server Suite", () => {
  let fastifyInstance: any;
  let port: number;

  beforeAll(async () => {
    const { fastify } = createServer();
    fastifyInstance = fastify;
    await fastifyInstance.listen({ port: 0, host: "127.0.0.1" });
    port = fastifyInstance.server.address().port;
  });

  afterAll(async () => {
    await fastifyInstance.close();
  });

  function connectClient(): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      ws.on("open", () => resolve(ws));
      ws.on("error", reject);
    });
  }

  function waitForMessage(ws: WebSocket): Promise<any> {
    return new Promise((resolve) => {
      ws.once("message", (data) => {
        resolve(JSON.parse(data.toString()));
      });
    });
  }

  it("health endpoint responds with ok", async () => {
    const res = await fastifyInstance.inject({
      method: "GET",
      url: "/health",
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe("ok");
    expect(body.service).toBe("linkora-signaling-server");
  });

  it("handles valid participant join and pong responses", async () => {
    const ws = await connectClient();

    // Send ping
    ws.send(JSON.stringify({ type: "ping", timestamp: 123456 }));
    const pong = await waitForMessage(ws);
    expect(pong.type).toBe("pong");
    expect(pong.timestamp).toBe(123456);

    // Join room
    ws.send(
      JSON.stringify({
        type: "join",
        roomCode: "test-room-1",
        displayName: "Alice",
      })
    );
    const joined = await waitForMessage(ws);
    expect(joined.type).toBe("joined");
    expect(joined.roomCode).toBe("test-room-1");
    expect(joined.participants).toHaveLength(1);
    expect(joined.iceServers).toBeDefined();

    ws.close();
  });

  it("relays signaling messages strictly between peers in the same room", async () => {
    const client1 = await connectClient();
    const client2 = await connectClient();

    client1.send(
      JSON.stringify({
        type: "join",
        roomCode: "shared-room",
        displayName: "User1",
      })
    );
    const c1Joined = await waitForMessage(client1);

    const c1NotifyPromise = waitForMessage(client1);
    client2.send(
      JSON.stringify({
        type: "join",
        roomCode: "shared-room",
        displayName: "User2",
      })
    );
    const c2Joined = await waitForMessage(client2);
    const peerJoined = await c1NotifyPromise;

    expect(peerJoined.type).toBe("peer-joined");
    expect(peerJoined.participant.displayName).toBe("User2");

    // Client1 sends signal to Client2
    const c2SignalPromise = waitForMessage(client2);
    client1.send(
      JSON.stringify({
        type: "signal",
        targetPeerId: c2Joined.peerId,
        signal: {
          signalType: "offer",
          sdp: "fake-offer-sdp",
          mediaType: "audio",
        },
      })
    );

    const receivedSignal = await c2SignalPromise;
    expect(receivedSignal.type).toBe("signal");
    expect(receivedSignal.fromPeerId).toBe(c1Joined.peerId);
    expect(receivedSignal.signal.sdp).toBe("fake-offer-sdp");

    client1.close();
    client2.close();
  });

  it("rejects signaling to peers outside the room", async () => {
    const client1 = await connectClient();
    const client2 = await connectClient();

    client1.send(
      JSON.stringify({
        type: "join",
        roomCode: "room-A",
        displayName: "Alice",
      })
    );
    await waitForMessage(client1);

    client2.send(
      JSON.stringify({
        type: "join",
        roomCode: "room-B",
        displayName: "Bob",
      })
    );
    const c2Joined = await waitForMessage(client2);

    // Alice tries to signal Bob who is in room-B
    client1.send(
      JSON.stringify({
        type: "signal",
        targetPeerId: c2Joined.peerId,
        signal: {
          signalType: "offer",
          sdp: "fake-sdp",
          mediaType: "audio",
        },
      })
    );

    const err = await waitForMessage(client1);
    expect(err.type).toBe("error");
    expect(err.code).toBe("PEER_NOT_FOUND");

    client1.close();
    client2.close();
  });

  it("rejects invalid messages safely", async () => {
    const ws = await connectClient();
    ws.send(JSON.stringify({ invalidField: "garbage" }));
    const err = await waitForMessage(ws);
    expect(err.type).toBe("error");
    expect(err.code).toBe("INVALID_MESSAGE");
    ws.close();
  });

  it("notifies peers when a participant leaves", async () => {
    const client1 = await connectClient();
    const client2 = await connectClient();

    client1.send(
      JSON.stringify({
        type: "join",
        roomCode: "leave-test-room",
        displayName: "UserA",
      })
    );
    await waitForMessage(client1);

    const c1JoinedPromise = waitForMessage(client1);
    client2.send(
      JSON.stringify({
        type: "join",
        roomCode: "leave-test-room",
        displayName: "UserB",
      })
    );
    const c2Joined = await waitForMessage(client2);
    await c1JoinedPromise;

    // UserB leaves
    const c1LeftPromise = waitForMessage(client1);
    client2.send(JSON.stringify({ type: "leave" }));
    const leftEvent = await c1LeftPromise;

    expect(leftEvent.type).toBe("peer-left");
    expect(leftEvent.peerId).toBe(c2Joined.peerId);

    client1.close();
    client2.close();
  });
});
