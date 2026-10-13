import { z } from "zod";

// --- Data Models & Schemas ---

export const ParticipantSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1).max(32),
  joinedAt: z.number(),
  isMuted: z.boolean().default(false),
  isDeafened: z.boolean().default(false),
  isScreenSharing: z.boolean().default(false),
  screenSharingFps: z.union([z.literal(15), z.literal(30), z.literal(60)]).optional(),
});
export type Participant = z.infer<typeof ParticipantSchema>;

export const TurnServerConfigSchema = z.object({
  urls: z.array(z.string()),
  username: z.string().optional(),
  credential: z.string().optional(),
});
export type TurnServerConfig = z.infer<typeof TurnServerConfigSchema>;

export const IceServerConfigSchema = z.object({
  iceServers: z.array(
    z.object({
      urls: z.union([z.string(), z.array(z.string())]),
      username: z.string().optional(),
      credential: z.string().optional(),
    })
  ),
});
export type IceServerConfig = z.infer<typeof IceServerConfigSchema>;

// --- Client -> Server Signaling Messages ---

export const ClientJoinMessageSchema = z.object({
  type: z.literal("join"),
  roomCode: z.string().min(3).max(64),
  displayName: z.string().min(1).max(32),
  keyFingerprint: z.string().optional(), // For E2EE key transparency
});

export const ClientLeaveMessageSchema = z.object({
  type: z.literal("leave"),
});

export const ClientSignalMessageSchema = z.object({
  type: z.literal("signal"),
  targetPeerId: z.string(),
  signal: z.discriminatedUnion("signalType", [
    z.object({
      signalType: z.literal("offer"),
      sdp: z.string(),
      mediaType: z.enum(["audio", "screen"]),
    }),
    z.object({
      signalType: z.literal("answer"),
      sdp: z.string(),
      mediaType: z.enum(["audio", "screen"]),
    }),
    z.object({
      signalType: z.literal("candidate"),
      candidate: z.any(),
      mediaType: z.enum(["audio", "screen"]),
    }),
  ]),
});

export const ClientMediaStateMessageSchema = z.object({
  type: z.literal("media-state"),
  isMuted: z.boolean().optional(),
  isDeafened: z.boolean().optional(),
  isScreenSharing: z.boolean().optional(),
  screenSharingFps: z.union([z.literal(15), z.literal(30), z.literal(60)]).optional(),
});

export const ClientPingMessageSchema = z.object({
  type: z.literal("ping"),
  timestamp: z.number(),
});

export const ClientMessageSchema = z.discriminatedUnion("type", [
  ClientJoinMessageSchema,
  ClientLeaveMessageSchema,
  ClientSignalMessageSchema,
  ClientMediaStateMessageSchema,
  ClientPingMessageSchema,
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

// --- Server -> Client Signaling Messages ---

export const ServerJoinedMessageSchema = z.object({
  type: z.literal("joined"),
  peerId: z.string(),
  roomCode: z.string(),
  participants: z.array(ParticipantSchema),
  iceServers: z.array(
    z.object({
      urls: z.union([z.string(), z.array(z.string())]),
      username: z.string().optional(),
      credential: z.string().optional(),
    })
  ),
  e2eeEnabled: z.boolean(),
});

export const ServerPeerJoinedMessageSchema = z.object({
  type: z.literal("peer-joined"),
  participant: ParticipantSchema,
  keyFingerprint: z.string().optional(),
});

export const ServerPeerLeftMessageSchema = z.object({
  type: z.literal("peer-left"),
  peerId: z.string(),
});

export const ServerSignalMessageSchema = z.object({
  type: z.literal("signal"),
  fromPeerId: z.string(),
  signal: z.discriminatedUnion("signalType", [
    z.object({
      signalType: z.literal("offer"),
      sdp: z.string(),
      mediaType: z.enum(["audio", "screen"]),
    }),
    z.object({
      signalType: z.literal("answer"),
      sdp: z.string(),
      mediaType: z.enum(["audio", "screen"]),
    }),
    z.object({
      signalType: z.literal("candidate"),
      candidate: z.any(),
      mediaType: z.enum(["audio", "screen"]),
    }),
  ]),
});

export const ServerPeerMediaStateMessageSchema = z.object({
  type: z.literal("peer-media-state"),
  peerId: z.string(),
  isMuted: z.boolean().optional(),
  isDeafened: z.boolean().optional(),
  isScreenSharing: z.boolean().optional(),
  screenSharingFps: z.union([z.literal(15), z.literal(30), z.literal(60)]).optional(),
});

export const ServerErrorMessageSchema = z.object({
  type: z.literal("error"),
  code: z.string(),
  message: z.string(),
});

export const ServerPongMessageSchema = z.object({
  type: z.literal("pong"),
  timestamp: z.number(),
});

export const ServerMessageSchema = z.discriminatedUnion("type", [
  ServerJoinedMessageSchema,
  ServerPeerJoinedMessageSchema,
  ServerPeerLeftMessageSchema,
  ServerSignalMessageSchema,
  ServerPeerMediaStateMessageSchema,
  ServerErrorMessageSchema,
  ServerPongMessageSchema,
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;

export const ROOM_CONSTANTS = {
  MAX_ROOM_CAPACITY: 10,
  DEFAULT_ROOM_CODE: "linkora-secret-lounge",
  HEARTBEAT_INTERVAL_MS: 15000,
  CLIENT_TIMEOUT_MS: 30000,
  RATE_LIMIT_MAX_PER_MINUTE: 120,
};
