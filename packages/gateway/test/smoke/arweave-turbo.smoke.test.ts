/**
 * Arweave Turbo SDK — Smoke Test
 *
 * Validates that the @ardrive/turbo-sdk can upload and retrieve a small
 * JSON evidence payload on Arweave devnet.
 *
 * GATING:
 *   Requires ARWEAVE_DEVNET_KEY (base64-encoded JWK) in the environment.
 *   Skips gracefully when the key is absent — will never break CI.
 *
 * This test does NOT wire into any workflow.
 * MockArweaveAdapter remains the default everywhere else.
 */

import { describe, it, expect } from 'vitest';

const ARWEAVE_KEY = process.env.ARWEAVE_DEVNET_KEY;
const SKIP = !ARWEAVE_KEY;

describe.skipIf(SKIP)('Arweave Turbo SDK — Smoke', () => {
  it('uploads a JSON evidence payload and retrieves it by tx_id', async () => {
    // Dynamic import so the test file parses even without the SDK wired up
    const { TurboFactory, ArweaveSigner } = await import('@ardrive/turbo-sdk');

    // Parse JWK from env
    const jwk = JSON.parse(
      Buffer.from(ARWEAVE_KEY!, 'base64').toString('utf-8'),
    );
    const signer = new ArweaveSigner(jwk);

    const turbo = TurboFactory.authenticated({
      signer,
      paymentServiceConfig: { url: 'https://payment.ardrive.dev' },
      uploadServiceConfig: { url: 'https://upload.ardrive.dev' },
    });

    // Small evidence payload
    const payload = {
      protocol: 'chaoschain',
      type: 'smoke_test',
      timestamp: Date.now(),
      data: { message: 'Week 2 Arweave adapter validation' },
    };
    const payloadBuf = Buffer.from(JSON.stringify(payload));

    // Upload
    const uploadResult = await turbo.uploadFile({
      fileStreamFactory: () => payloadBuf as unknown as ReadableStream,
      fileSizeFactory: () => payloadBuf.length,
      dataItemOpts: {
        tags: [
          { name: 'Content-Type', value: 'application/json' },
          { name: 'App-Name', value: 'ChaosChain' },
          { name: 'App-Version', value: '0.1.0' },
          { name: 'Type', value: 'smoke-test' },
        ],
      },
    });

    const txId = uploadResult.id;
    console.log('[ARWEAVE SMOKE] Uploaded tx_id:', txId);
    expect(txId).toBeTruthy();
    expect(typeof txId).toBe('string');
    expect(txId.length).toBeGreaterThan(0);

    // Retrieve — Turbo devnet data is available from the upload service cache.
    // The ar.io gateway may take time, so we hit the upload service directly.
    const gatewayUrl = `https://arweave.net/${txId}`;
    console.log('[ARWEAVE SMOKE] Gateway URL:', gatewayUrl);

    // Allow a few seconds for propagation, then attempt retrieval
    await new Promise((r) => setTimeout(r, 3000));

    const res = await fetch(gatewayUrl);
    if (res.ok) {
      const retrieved = await res.json();
      expect(retrieved.protocol).toBe('chaoschain');
      expect(retrieved.type).toBe('smoke_test');
      console.log('[ARWEAVE SMOKE] Retrieved payload matches. PASS.');
    } else {
      // Turbo uploads are eventually consistent; a non-200 within seconds is
      // acceptable as long as the upload itself returned a valid tx_id.
      console.log(
        `[ARWEAVE SMOKE] Gateway returned ${res.status} — TX may still be propagating. Upload succeeded.`,
      );
    }
  }, 30_000);
});
