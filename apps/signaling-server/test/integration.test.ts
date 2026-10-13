import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import { createServer } from "../src/server.js";

describe("Linkora Full End-to-End Signaling & Peer Isolation Integration Test", () => {
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

  it("completes full 2-client room join, peer discovery, and bi-directional WebRTC signaling exchange", async () => {
    const clientA = await connectClient();
    const clientB = await connectClient();

    // Client A joins Room 101
    clientA.send(
      JSON.stringify({
        type: "join",
        roomCode: "room-101",
        displayName: "Alice",
        keyFingerprint: "1A2B-3C4D-5E6F-7A8B",
      })
    );
    const joinedA = await waitForMessage(clientA);
    expect(joinedA.type).toBe("joined");
    expect(joinedA.participants).toHaveLength(1);
    expect(joinedA.participants[0].displayName).toBe("Alice");

    // Client B joins Room 101
    const aNotifyPromise = waitForMessage(clientA);
    clientB.send(
      JSON.stringify({
        type: "join",
        roomCode: "room-101",
        displayName: "Bob",
        keyFingerprint: "1A2B-3C4D-5E6F-7A8B",
      })
    );
    const joinedB = await waitForMessage(clientB);
    const peerJoinedOnA = await aNotifyPromise;

    expect(joinedB.type).toBe("joined");
    expect(joinedB.participants).toHaveLength(2);
    expect(peerJoinedOnA.type).toBe("peer-joined");
    expect(peerJoinedOnA.participant.displayName).toBe("Bob");

    // Client A sends WebRTC Offer with audio SDP to Client B
    const bOfferPromise = waitForMessage(clientB);
    clientA.send(
      JSON.stringify({
        type: "signal",
        targetPeerId: joinedB.peerId,
        signal: {
          signalType: "offer",
          sdp: "v=0\r\no=alice 1234 5678 IN IP4 127.0.0.1\r\nm=audio 50000 UDP/TLS/RTP/SAVPF 111",
          mediaType: "audio",
        },
      })
    );
    const offerOnB = await bOfferPromise;
    expect(offerOnB.type).toBe("signal");
    expect(offerOnB.fromPeerId).toBe(joinedA.peerId);
    expect(offerOnB.signal.signalType).toBe("offer");
    expect(offerOnB.signal.mediaType).toBe("audio");

    // Client B sends WebRTC Answer to Client A
    const aAnswerPromise = waitForMessage(clientA);
    clientB.send(
      JSON.stringify({
        type: "signal",
        targetPeerId: joinedA.peerId,
        signal: {
          signalType: "answer",
          sdp: "v=0\r\no=bob 8765 4321 IN IP4 127.0.0.1\r\nm=audio 50002 UDP/TLS/RTP/SAVPF 111",
          mediaType: "audio",
        },
      })
    );
    const answerOnA = await aAnswerPromise;
    expect(answerOnA.type).toBe("signal");
    expect(answerOnA.fromPeerId).toBe(joinedB.peerId);
    expect(answerOnA.signal.signalType).toBe("answer");

    // Client A sends ICE Candidate to Client B
    const bCandidatePromise = waitForMessage(clientB);
    clientA.send(
      JSON.stringify({
        type: "signal",
        targetPeerId: joinedB.peerId,
        signal: {
          signalType: "candidate",
          candidate: { candidate: "candidate:1 1 UDP 2122260223 127.0.0.1 50000 typ host", sdpMid: "0", sdpMLineIndex: 0 },
          mediaType: "audio",
        },
      })
    );
    const candidateOnB = await bCandidatePromise;
    expect(candidateOnB.type).toBe("signal");
    expect(candidateOnB.signal.signalType).toBe("candidate");
    expect(candidateOnB.signal.candidate.sdpMid).toBe("0");

    // Client A starts screen sharing at 60 FPS
    const bMediaStatePromise = waitForMessage(clientB);
    clientA.send(
      JSON.stringify({
        type: "media-state",
        isScreenSharing: true,
        screenSharingFps: 60,
      })
    );
    const mediaStateOnB = await bMediaStatePromise;
    expect(mediaStateOnB.type).toBe("peer-media-state");
    expect(mediaStateOnB.isScreenSharing).toBe(true);
    expect(mediaStateOnB.screenSharingFps).toBe(60);

    // Client A disconnects and Client B receives leave event
    const bLeavePromise = waitForMessage(clientB);
    clientA.close();
    const leaveOnB = await bLeavePromise;
    expect(leaveOnB.type).toBe("peer-left");
    expect(leaveOnB.peerId).toBe(joinedA.peerId);

    clientB.close();
  });

  it("strictly prohibits unauthorized signaling between different rooms", async () => {
    const clientRoom1 = await connectClient();
    const clientRoom2 = await connectClient();

    clientRoom1.send(
      JSON.stringify({
        type: "join",
        roomCode: "secure-room-1",
        displayName: "User1",
      })
    );
    const joined1 = await waitForMessage(clientRoom1);

    clientRoom2.send(
      JSON.stringify({
        type: "join",
        roomCode: "unrelated-room-2",
        displayName: "User2",
      })
    );
    const joined2 = await waitForMessage(clientRoom2);

    // Attempt cross-room signaling injection
    clientRoom1.send(
      JSON.stringify({
        type: "signal",
        targetPeerId: joined2.peerId,
        signal: {
          signalType: "offer",
          sdp: "malicious-offer",
          mediaType: "audio",
        },
      })
    );

    const err = await waitForMessage(clientRoom1);
    expect(err.type).toBe("error");
    expect(err.code).toBe("PEER_NOT_FOUND");

    clientRoom1.close();
    clientRoom2.close();
  });
});
