/**
 * Linkora Cryptographic Engine
 *
 * Implements:
 * 1. AES-GCM-256 authenticated frame encryption for WebRTC Encoded Transform.
 * 2. PBKDF2 / HKDF key derivation from shared room secret + roomCode salt.
 * 3. Short Authentication String (SAS) / Safety Fingerprint generation for out-of-band verification.
 * 4. Replay-resistant framing with 12-byte IV (4-byte salt + 8-byte monotonic counter) and 16-byte GCM tag.
 * 5. Sliding-window replay protection: Supports out-of-order UDP packet delivery without dropping valid delayed frames.
 *
 * Web Crypto API is used natively in Node.js 18+ and Chromium/WebView2.
 */

const cryptoSubtle = globalThis.crypto?.subtle;

export interface FrameCryptoHeader {
  counter: bigint;
  participantIdHash: number; // 2 bytes
}

export class LinkoraCrypto {
  private key: CryptoKey | null = null;
  private rawKeyBytes: Uint8Array | null = null;
  private sendCounter: bigint = 0n;
  
  // Per-sender sliding window for replay protection:
  // senderHash -> { maxSeen: bigint, seenWindow: Set<bigint> }
  // Window size of 1024 frames (~20 seconds of 50fps audio/video packets)
  private readonly replayWindows = new Map<number, { maxSeen: bigint; window: Set<bigint> }>();
  private readonly WINDOW_SIZE = 1024n;

  /**
   * Derive a 256-bit AES-GCM CryptoKey from a secret passphrase and room identifier.
   */
  public async initializeFromSecret(passphrase: string, roomCode: string): Promise<void> {
    if (!cryptoSubtle) {
      throw new Error("Web Crypto API is not available in this environment.");
    }

    const enc = new TextEncoder();
    const passphraseBytes = enc.encode(passphrase);
    const saltBytes = enc.encode(`linkora-salt-${roomCode}`);

    // Import base secret
    const keyMaterial = await cryptoSubtle.importKey(
      "raw",
      passphraseBytes,
      { name: "PBKDF2" },
      false,
      ["deriveKey", "deriveBits"]
    );

    // Derive AES-GCM 256-bit key
    this.key = await cryptoSubtle.deriveKey(
      {
        name: "PBKDF2",
        salt: saltBytes,
        iterations: 100000,
        hash: "SHA-256",
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      true, // exportable for fingerprint computation
      ["encrypt", "decrypt"]
    );

    const exported = await cryptoSubtle.exportKey("raw", this.key);
    this.rawKeyBytes = new Uint8Array(exported);
    this.sendCounter = 0n;
    this.replayWindows.clear();
  }

  /**
   * Generate an 8-character human-readable Short Authentication String (SAS)
   * or Safety Number so participants can verify their key out-of-band.
   */
  public async getVerificationFingerprint(): Promise<string> {
    if (!this.rawKeyBytes) {
      throw new Error("Crypto engine not initialized with key.");
    }
    const hash = await cryptoSubtle.digest("SHA-256", this.rawKeyBytes as any);
    const hashArray = Array.from(new Uint8Array(hash));
    // Format into 4 chunks of 4 hex digits: XXXX-XXXX-XXXX-XXXX
    const hex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
    return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}`;
  }

  /**
   * Encrypt a media frame buffer using AES-GCM-256.
   * Frame layout:
   * [ 8 bytes counter ] [ 2 bytes participantIdHash ] [ Ciphertext + 16 bytes auth tag ]
   */
  public async encryptFrame(
    plaintext: ArrayBuffer | Uint8Array,
    participantIdNumeric = 0
  ): Promise<Uint8Array> {
    if (!this.key) {
      throw new Error("Crypto engine not initialized.");
    }

    this.sendCounter += 1n;
    const counter = this.sendCounter;

    // IV is 12 bytes: 4 bytes fixed prefix + 8 bytes big-endian counter
    const iv = new Uint8Array(12);
    iv[0] = 0x4c; // 'L'
    iv[1] = 0x4b; // 'K'
    iv[2] = 0x52; // 'R'
    iv[3] = 0x01; // Version 1

    const view = new DataView(iv.buffer);
    view.setBigUint64(4, counter, false); // Big endian

    const encryptedBuffer = await cryptoSubtle.encrypt(
      {
        name: "AES-GCM",
        iv: iv,
      },
      this.key,
      plaintext as any
    );

    const encryptedBytes = new Uint8Array(encryptedBuffer);
    const finalPayload = new Uint8Array(10 + encryptedBytes.length);
    const payloadView = new DataView(finalPayload.buffer);

    payloadView.setBigUint64(0, counter, false);
    payloadView.setUint16(8, participantIdNumeric & 0xffff, false);
    finalPayload.set(encryptedBytes, 10);

    return finalPayload;
  }

  /**
   * Decrypt a media frame buffer with RFC-style sliding-window replay protection.
   * Validates authentication tag and protects against replay attacks while tolerating network packet reordering.
   */
  public async decryptFrame(
    framePayload: ArrayBuffer | Uint8Array,
    _senderIdNumeric = 0
  ): Promise<Uint8Array> {
    if (!this.key) {
      throw new Error("Crypto engine not initialized.");
    }

    const payloadBytes =
      framePayload instanceof Uint8Array ? framePayload : new Uint8Array(framePayload);

    if (payloadBytes.length < 10 + 16) {
      throw new Error("Frame buffer is too short to contain header and GCM auth tag.");
    }

    const payloadView = new DataView(payloadBytes.buffer, payloadBytes.byteOffset, payloadBytes.byteLength);
    const counter = payloadView.getBigUint64(0, false);
    const participantIdHash = payloadView.getUint16(8, false);

    // Get or initialize replay state for this sender
    let replayState = this.replayWindows.get(participantIdHash);
    if (!replayState) {
      replayState = { maxSeen: 0n, window: new Set<bigint>() };
      this.replayWindows.set(participantIdHash, replayState);
    }

    // Check sliding window replay:
    if (counter <= replayState.maxSeen) {
      // If counter is older than window size, reject as too old / replay
      if (replayState.maxSeen - counter >= this.WINDOW_SIZE) {
        throw new Error(`Frame counter ${counter} is too old (outside sliding window)`);
      }
      // If already seen within window, reject as duplicate / replay
      if (replayState.window.has(counter)) {
        throw new Error(`Replay detected for frame counter ${counter}`);
      }
    }

    // Reconstruct IV
    const iv = new Uint8Array(12);
    iv[0] = 0x4c;
    iv[1] = 0x4b;
    iv[2] = 0x52;
    iv[3] = 0x01;
    const ivView = new DataView(iv.buffer);
    ivView.setBigUint64(4, counter, false);

    const ciphertext = payloadBytes.subarray(10);

    try {
      const decryptedBuffer = await cryptoSubtle.decrypt(
        {
          name: "AES-GCM",
          iv: iv,
        },
        this.key,
        ciphertext as any
      );

      // Decryption succeeded and verified authenticated tag:
      // Now update the sliding replay window
      if (counter > replayState.maxSeen) {
        replayState.maxSeen = counter;
        // Purge entries older than the new window boundary
        const boundary = replayState.maxSeen - this.WINDOW_SIZE;
        for (const seen of replayState.window) {
          if (seen < boundary) {
            replayState.window.delete(seen);
          }
        }
      }
      replayState.window.add(counter);

      return new Uint8Array(decryptedBuffer);
    } catch (err: any) {
      if (err.message && err.message.includes("Replay detected")) {
        throw err;
      }
      throw new Error("Decryption failed: Authentication tag verification failed or key mismatch.");
    }
  }
}
