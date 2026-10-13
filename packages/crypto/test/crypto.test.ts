import { describe, it, expect } from "vitest";
import { LinkoraCrypto } from "../src/index.js";

describe("LinkoraCrypto E2EE Engine", () => {
  it("generates consistent key and fingerprint for same secret and room code", async () => {
    const crypto1 = new LinkoraCrypto();
    const crypto2 = new LinkoraCrypto();

    await crypto1.initializeFromSecret("my-super-secret-passphrase", "gaming-lounge");
    await crypto2.initializeFromSecret("my-super-secret-passphrase", "gaming-lounge");

    const fp1 = await crypto1.getVerificationFingerprint();
    const fp2 = await crypto2.getVerificationFingerprint();

    expect(fp1).toBe(fp2);
    expect(fp1).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
  });

  it("produces different fingerprints for different room codes or secrets", async () => {
    const crypto1 = new LinkoraCrypto();
    const crypto2 = new LinkoraCrypto();

    await crypto1.initializeFromSecret("secret-A", "room-1");
    await crypto2.initializeFromSecret("secret-B", "room-1");

    const fp1 = await crypto1.getVerificationFingerprint();
    const fp2 = await crypto2.getVerificationFingerprint();

    expect(fp1).not.toBe(fp2);
  });

  it("encrypts and decrypts media frame payload successfully", async () => {
    const alice = new LinkoraCrypto();
    const bob = new LinkoraCrypto();

    await alice.initializeFromSecret("shared-password", "room-alpha");
    await bob.initializeFromSecret("shared-password", "room-alpha");

    const originalData = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x01, 0x02, 0x03, 0x04]);
    const encrypted = await alice.encryptFrame(originalData, 42);

    expect(encrypted.length).toBeGreaterThan(originalData.length);

    const decrypted = await bob.decryptFrame(encrypted, 42);
    expect(decrypted).toEqual(originalData);
  });

  it("rejects tampered ciphertext (authenticated encryption verification)", async () => {
    const alice = new LinkoraCrypto();
    const bob = new LinkoraCrypto();

    await alice.initializeFromSecret("shared-password", "room-alpha");
    await bob.initializeFromSecret("shared-password", "room-alpha");

    const originalData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const encrypted = await alice.encryptFrame(originalData);

    // Tamper with one byte in the ciphertext payload
    encrypted[15] ^= 0xff;

    await expect(bob.decryptFrame(encrypted)).rejects.toThrow("Decryption failed");
  });

  it("rejects frame decrypted with wrong secret key", async () => {
    const alice = new LinkoraCrypto();
    const eve = new LinkoraCrypto();

    await alice.initializeFromSecret("alice-secret", "room-alpha");
    await eve.initializeFromSecret("eve-different-secret", "room-alpha");

    const originalData = new TextEncoder().encode("Hello secret voice audio frame");
    const encrypted = await alice.encryptFrame(originalData);

    await expect(eve.decryptFrame(encrypted)).rejects.toThrow("Decryption failed");
  });

  it("detects and rejects duplicate replay attacks", async () => {
    const alice = new LinkoraCrypto();
    const bob = new LinkoraCrypto();

    await alice.initializeFromSecret("shared-password", "room-alpha");
    await bob.initializeFromSecret("shared-password", "room-alpha");

    const originalData = new Uint8Array([10, 20, 30, 40]);
    const encrypted = await alice.encryptFrame(originalData, 100);

    // First decryption succeeds
    const decrypted = await bob.decryptFrame(encrypted, 100);
    expect(decrypted).toEqual(originalData);

    // Second decryption of identical frame should fail due to replay prevention
    await expect(bob.decryptFrame(encrypted, 100)).rejects.toThrow("Replay detected");
  });

  it("handles out-of-order UDP packet delivery within sliding window", async () => {
    const alice = new LinkoraCrypto();
    const bob = new LinkoraCrypto();

    await alice.initializeFromSecret("shared-password", "room-alpha");
    await bob.initializeFromSecret("shared-password", "room-alpha");

    const frame1 = await alice.encryptFrame(new Uint8Array([1]), 42);
    const frame2 = await alice.encryptFrame(new Uint8Array([2]), 42);
    const frame3 = await alice.encryptFrame(new Uint8Array([3]), 42);

    // Delivery order: frame 2, then frame 1 (out of order), then frame 3
    const dec2 = await bob.decryptFrame(frame2, 42);
    expect(dec2).toEqual(new Uint8Array([2]));

    const dec1 = await bob.decryptFrame(frame1, 42);
    expect(dec1).toEqual(new Uint8Array([1]));

    const dec3 = await bob.decryptFrame(frame3, 42);
    expect(dec3).toEqual(new Uint8Array([3]));

    // Replay of frame 1 should still be rejected
    await expect(bob.decryptFrame(frame1, 42)).rejects.toThrow("Replay detected");
  });
});
