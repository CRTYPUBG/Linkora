import { WebSocket } from "ws";
import { Participant, ROOM_CONSTANTS } from "@linkora/shared";

export interface ConnectedPeer {
  id: string;
  socket: WebSocket;
  roomCode: string;
  participant: Participant;
  keyFingerprint?: string;
  lastPing: number;
}

export class RoomManager {
  // roomCode -> Map of peerId -> ConnectedPeer
  private rooms = new Map<string, Map<string, ConnectedPeer>>();
  // socket -> ConnectedPeer
  private socketPeerMap = new Map<WebSocket, ConnectedPeer>();

  public getPeerBySocket(socket: WebSocket): ConnectedPeer | undefined {
    return this.socketPeerMap.get(socket);
  }

  public getRoomParticipants(roomCode: string): Participant[] {
    const room = this.rooms.get(roomCode);
    if (!room) return [];
    return Array.from(room.values()).map((p) => p.participant);
  }

  public getRoomPeers(roomCode: string): ConnectedPeer[] {
    const room = this.rooms.get(roomCode);
    if (!room) return [];
    return Array.from(room.values());
  }

  public joinRoom(
    socket: WebSocket,
    roomCode: string,
    peerId: string,
    displayName: string,
    keyFingerprint?: string
  ): { success: boolean; error?: string; peer?: ConnectedPeer } {
    let room = this.rooms.get(roomCode);
    if (!room) {
      room = new Map<string, ConnectedPeer>();
      this.rooms.set(roomCode, room);
    }

    if (room.size >= ROOM_CONSTANTS.MAX_ROOM_CAPACITY) {
      return { success: false, error: "ROOM_CAPACITY_EXCEEDED" };
    }

    // Check if duplicate peer id
    if (room.has(peerId)) {
      const existing = room.get(peerId)!;
      try {
        existing.socket.close(1000, "Replaced by new connection");
      } catch (e) {}
      this.socketPeerMap.delete(existing.socket);
      room.delete(peerId);
    }

    const participant: Participant = {
      id: peerId,
      displayName,
      joinedAt: Date.now(),
      isMuted: false,
      isDeafened: false,
      isScreenSharing: false,
    };

    const peer: ConnectedPeer = {
      id: peerId,
      socket,
      roomCode,
      participant,
      keyFingerprint,
      lastPing: Date.now(),
    };

    room.set(peerId, peer);
    this.socketPeerMap.set(socket, peer);

    return { success: true, peer };
  }

  public updateMediaState(
    socket: WebSocket,
    updates: {
      isMuted?: boolean;
      isDeafened?: boolean;
      isScreenSharing?: boolean;
      screenSharingFps?: 15 | 30 | 60;
    }
  ): ConnectedPeer | undefined {
    const peer = this.socketPeerMap.get(socket);
    if (!peer) return undefined;

    if (updates.isMuted !== undefined) peer.participant.isMuted = updates.isMuted;
    if (updates.isDeafened !== undefined) peer.participant.isDeafened = updates.isDeafened;
    if (updates.isScreenSharing !== undefined) peer.participant.isScreenSharing = updates.isScreenSharing;
    if (updates.screenSharingFps !== undefined) peer.participant.screenSharingFps = updates.screenSharingFps;

    return peer;
  }

  public removePeer(socket: WebSocket): { peer?: ConnectedPeer; remainingPeers: ConnectedPeer[] } {
    const peer = this.socketPeerMap.get(socket);
    if (!peer) return { remainingPeers: [] };

    this.socketPeerMap.delete(socket);
    const room = this.rooms.get(peer.roomCode);
    if (room) {
      room.delete(peer.id);
      if (room.size === 0) {
        this.rooms.delete(peer.roomCode);
      }
      return {
        peer,
        remainingPeers: room ? Array.from(room.values()) : [],
      };
    }

    return { peer, remainingPeers: [] };
  }

  public cleanupDeadConnections(): string[] {
    const now = Date.now();
    const closedIds: string[] = [];

    for (const [socket, peer] of this.socketPeerMap.entries()) {
      if (now - peer.lastPing > ROOM_CONSTANTS.CLIENT_TIMEOUT_MS) {
        closedIds.push(peer.id);
        try {
          socket.terminate();
        } catch (e) {}
        this.removePeer(socket);
      }
    }

    return closedIds;
  }
}
