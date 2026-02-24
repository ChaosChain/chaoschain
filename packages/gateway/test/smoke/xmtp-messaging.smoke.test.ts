/**
 * XMTP Node SDK — Smoke Test
 *
 * Validates that @xmtp/node-sdk can:
 *   1. Create two XMTP clients from test wallets
 *   2. Wallet A sends a message to Wallet B via a group conversation
 *   3. Wallet B receives the message
 *   4. Content matches
 *
 * GATING:
 *   Requires XMTP_PRIVATE_KEY_A and XMTP_PRIVATE_KEY_B in the environment.
 *   These should be hex-encoded Ethereum private keys (with or without 0x prefix).
 *   Skips gracefully when either key is absent — will never break CI.
 *
 * This test does NOT wire XMTP into any workflow.
 * XMTP → DKG integration is Week 3.
 */

import { describe, it, expect } from 'vitest';

const KEY_A = process.env.XMTP_PRIVATE_KEY_A;
const KEY_B = process.env.XMTP_PRIVATE_KEY_B;
const SKIP = !KEY_A || !KEY_B;

describe.skipIf(SKIP)('XMTP Node SDK — Smoke', () => {
  it('Wallet A sends message, Wallet B receives it', async () => {
    const { Client, IdentifierKind } = await import('@xmtp/node-sdk');
    const { Wallet } = await import('ethers');
    const { getRandomValues } = await import('node:crypto');

    // Create ethers wallets from the provided private keys
    const walletA = new Wallet(KEY_A!);
    const walletB = new Wallet(KEY_B!);

    console.log('[XMTP SMOKE] Wallet A address:', walletA.address);
    console.log('[XMTP SMOKE] Wallet B address:', walletB.address);

    // Build XMTP signers from ethers wallets
    function makeXmtpSigner(wallet: InstanceType<typeof Wallet>) {
      return {
        type: 'EOA' as const,
        getIdentifier: () => ({
          identifier: wallet.address,
          identifierKind: IdentifierKind.Ethereum,
        }),
        signMessage: async (message: string) => {
          const sig = await wallet.signMessage(message);
          return new Uint8Array(Buffer.from(sig.slice(2), 'hex'));
        },
      };
    }

    const signerA = makeXmtpSigner(walletA);
    const signerB = makeXmtpSigner(walletB);

    // Create XMTP clients on the dev network
    const encKeyA = getRandomValues(new Uint8Array(32));
    const encKeyB = getRandomValues(new Uint8Array(32));

    const clientA = await Client.create(signerA, {
      env: 'dev',
      dbEncryptionKey: encKeyA,
    });
    const clientB = await Client.create(signerB, {
      env: 'dev',
      dbEncryptionKey: encKeyB,
    });

    console.log('[XMTP SMOKE] Client A inbox:', clientA.inboxId);
    console.log('[XMTP SMOKE] Client B inbox:', clientB.inboxId);

    // Create a group conversation from A including B
    const group = await clientA.conversations.createGroup([clientB.inboxId]);
    expect(group).toBeTruthy();
    console.log('[XMTP SMOKE] Group created:', group.id);

    // Send message from A
    const testMessage = `ChaosChain smoke test ${Date.now()}`;
    await group.sendText(testMessage);
    console.log('[XMTP SMOKE] Message sent:', testMessage);

    // Sync B and read messages
    await clientB.conversations.sync();
    const conversations = await clientB.conversations.list();
    const targetConv = conversations.find(
      (c: { id: string }) => c.id === group.id,
    );
    expect(targetConv).toBeTruthy();

    await targetConv!.sync();
    const messages = await targetConv!.messages();
    const received = messages.find(
      (m: { content: string }) =>
        typeof m.content === 'string' && m.content === testMessage,
    );

    expect(received).toBeTruthy();
    console.log('[XMTP SMOKE] Message received and verified. PASS.');

    // Cleanup: close clients
    // (node-sdk clients auto-close on process exit, but explicit is better)
  }, 60_000);
});
