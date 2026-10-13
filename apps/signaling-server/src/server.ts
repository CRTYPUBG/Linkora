import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import fastifyCors from "@fastify/cors";
import fastifyRateLimit from "@fastify/rate-limit";
import { WebSocket } from "ws";
import { randomUUID } from "crypto";
import {
  ClientMessageSchema,
  ServerMessage,
  ROOM_CONSTANTS,
} from "@linkora/shared";
import { RoomManager } from "./rooms.js";
import { TurnManager } from "./turn.js";

export function createServer() {
  const fastify = Fastify({
    logger: process.env.NODE_ENV !== "test",
    trustProxy: true,
  });

  const roomManager = new RoomManager();
  const turnManager = new TurnManager();

  fastify.register(fastifyCors, {
    origin: "*",
  });

  fastify.register(fastifyRateLimit, {
    max: ROOM_CONSTANTS.RATE_LIMIT_MAX_PER_MINUTE,
    timeWindow: "1 minute",
  });

  fastify.register(fastifyWebsocket);

  // Health check and resource measurement endpoint
  fastify.get("/health", async () => {
    const mem = process.memoryUsage();
    return {
      status: "ok",
      timestamp: Date.now(),
      service: "linkora-signaling-server",
      version: "0.1.0",
      architecture: "P2P-first, zero-media-processing",
      maxRoomCapacity: ROOM_CONSTANTS.MAX_ROOM_CAPACITY,
      memory: {
        rssMb: Math.round((mem.rss / 1024 / 1024) * 100) / 100,
        heapUsedMb: Math.round((mem.heapUsed / 1024 / 1024) * 100) / 100,
        heapTotalMb: Math.round((mem.heapTotal / 1024 / 1024) * 100) / 100,
        externalMb: Math.round((mem.external / 1024 / 1024) * 100) / 100,
      },
    };
  });

  // WebSocket signaling endpoint
  fastify.register(async (instance) => {
    instance.get("/ws", { websocket: true }, (socket: WebSocket, req) => {
      const socketPeerId = randomUUID();

      function send(msg: ServerMessage) {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify(msg));
        }
      }

      socket.on("message", (raw) => {
        try {
          const parsedJson = JSON.parse(raw.toString());
          const parseResult = ClientMessageSchema.safeParse(parsedJson);

          if (!parseResult.success) {
            send({
              type: "error",
              code: "INVALID_MESSAGE",
              message: "Message validation failed",
            });
            return;
          }

          const msg = parseResult.data;

          switch (msg.type) {
            case "ping": {
              const current = roomManager.getPeerBySocket(socket);
              if (current) current.lastPing = Date.now();
              send({ type: "pong", timestamp: msg.timestamp });
              break;
            }

            case "join": {
              const joinRes = roomManager.joinRoom(
                socket,
                msg.roomCode,
                socketPeerId,
                msg.displayName,
                msg.keyFingerprint
              );

              if (!joinRes.success || !joinRes.peer) {
                send({
                  type: "error",
                  code: joinRes.error || "JOIN_FAILED",
                  message: "Could not join room: capacity reached or invalid",
                });
                return;
              }

              const peersInRoom = roomManager.getRoomPeers(msg.roomCode);
              const otherPeers = peersInRoom.filter((p) => p.id !== socketPeerId);

              // 1. Reply to joining user
              send({
                type: "joined",
                peerId: socketPeerId,
                roomCode: msg.roomCode,
                participants: peersInRoom.map((p) => p.participant),
                iceServers: turnManager.getIceServers(socketPeerId),
                e2eeEnabled: true,
              });

              // 2. Notify existing peers in the room
              for (const other of otherPeers) {
                if (other.socket.readyState === WebSocket.OPEN) {
                  other.socket.send(
                    JSON.stringify({
                      type: "peer-joined",
                      participant: joinRes.peer.participant,
                      keyFingerprint: msg.keyFingerprint,
                    })
                  );
                }
              }
              break;
            }

            case "leave": {
              const { peer, remainingPeers } = roomManager.removePeer(socket);
              if (peer) {
                for (const remaining of remainingPeers) {
                  if (remaining.socket.readyState === WebSocket.OPEN) {
                    remaining.socket.send(
                      JSON.stringify({
                        type: "peer-left",
                        peerId: peer.id,
                      })
                    );
                  }
                }
              }
              break;
            }

            case "signal": {
              const sender = roomManager.getPeerBySocket(socket);
              if (!sender) {
                send({
                  type: "error",
                  code: "NOT_IN_ROOM",
                  message: "You must join a room before sending signals",
                });
                return;
              }

              // Verify target peer is in the EXACT same room
              const roomPeers = roomManager.getRoomPeers(sender.roomCode);
              const target = roomPeers.find((p) => p.id === msg.targetPeerId);

              if (!target) {
                send({
                  type: "error",
                  code: "PEER_NOT_FOUND",
                  message: "Target peer is not in this room",
                });
                return;
              }

              if (target.socket.readyState === WebSocket.OPEN) {
                target.socket.send(
                  JSON.stringify({
                    type: "signal",
                    fromPeerId: sender.id,
                    signal: msg.signal,
                  })
                );
              }
              break;
            }

            case "media-state": {
              const updated = roomManager.updateMediaState(socket, {
                isMuted: msg.isMuted,
                isDeafened: msg.isDeafened,
                isScreenSharing: msg.isScreenSharing,
                screenSharingFps: msg.screenSharingFps,
              });

              if (updated) {
                const roomPeers = roomManager.getRoomPeers(updated.roomCode);
                for (const peer of roomPeers) {
                  if (peer.id !== updated.id && peer.socket.readyState === WebSocket.OPEN) {
                    peer.socket.send(
                      JSON.stringify({
                        type: "peer-media-state",
                        peerId: updated.id,
                        isMuted: msg.isMuted,
                        isDeafened: msg.isDeafened,
                        isScreenSharing: msg.isScreenSharing,
                        screenSharingFps: msg.screenSharingFps,
                      })
                    );
                  }
                }
              }
              break;
            }
          }
        } catch (err) {
          send({
            type: "error",
            code: "INTERNAL_ERROR",
            message: "Malformed data",
          });
        }
      });

      socket.on("close", () => {
        const { peer, remainingPeers } = roomManager.removePeer(socket);
        if (peer) {
          for (const remaining of remainingPeers) {
            if (remaining.socket.readyState === WebSocket.OPEN) {
              remaining.socket.send(
                JSON.stringify({
                  type: "peer-left",
                  peerId: peer.id,
                })
              );
            }
          }
        }
      });
    });
  });

  return { fastify, roomManager, turnManager };
}

// Start if executed directly
if (process.env.NODE_ENV !== "test") {
  const { fastify } = createServer();
  const PORT = Number(process.env.PORT) || 4000;
  const HOST = process.env.HOST || "0.0.0.0";

  fastify.listen({ port: PORT, host: HOST }, (err, address) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
    console.log(`Linkora Signaling Server listening on ${address}`);
  });
}
