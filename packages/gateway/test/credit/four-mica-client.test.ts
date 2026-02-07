/**
 * 4Mica Client Tests
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { Wallet } from 'ethers';
import {
  FourMicaClient,
  createFourMicaConfig,
} from '../../src/services/credit/four-mica-client';

// Mock fetch for tests
const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

describe('FourMicaClient', () => {
  let client: FourMicaClient;
  let testWallet: Wallet;
  
  beforeEach(() => {
    // Reset mock between tests to prevent leakage
    mockFetch.mockReset();
  });
  
  beforeAll(() => {
    // Create test wallet
    testWallet = Wallet.createRandom();
    
    // Create client with Sepolia config
    const config = createFourMicaConfig(
      testWallet,
      'eip155:11155111', // Sepolia
      'https://x402.4mica.xyz',
    );
    client = new FourMicaClient(config);
  });
  
  describe('health', () => {
    it('should check facilitator health', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'ok' }),
      });
      
      const health = await client.health();
      
      expect(health.status).toBe('ok');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://x402.4mica.xyz/health',
        expect.objectContaining({
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });
  });
  
  describe('supported', () => {
    it('should list supported schemes and networks', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          kinds: [
            { scheme: '4mica-credit', network: 'eip155:11155111' },
            { scheme: '4mica-credit', network: 'eip155:80002' },
          ],
          extensions: [],
          signers: {},
        }),
      });
      
      const supported = await client.supported();
      
      expect(supported.kinds).toHaveLength(2);
      expect(supported.kinds[0].scheme).toBe('4mica-credit');
    });
  });
  
  describe('openTab', () => {
    it('should open a payment tab', async () => {
      const recipientAddress = Wallet.createRandom().address;
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          tabId: '0x1234...',
          userAddress: testWallet.address,
          recipientAddress,
          assetAddress: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
          startTimestamp: Math.floor(Date.now() / 1000),
          ttlSeconds: 86400,
          nextReqId: '0x0001',
        }),
      });
      
      const tab = await client.openTab({
        userAddress: testWallet.address,
        recipientAddress,
        network: 'eip155:11155111',
        ttlSeconds: 86400,
      });
      
      expect(tab.tabId).toBe('0x1234...');
      expect(tab.recipientAddress).toBe(recipientAddress);
      expect(tab.ttlSeconds).toBe(86400);
    });
  });
  
  describe('verify', () => {
    it('should verify a payment payload', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          isValid: true,
        }),
      });
      
      const result = await client.verify({
        x402Version: 1,
        paymentPayload: {
          x402Version: 1,
          scheme: '4mica-credit',
          network: 'eip155:11155111',
          payload: {
            claims: {
              user_address: testWallet.address,
              recipient_address: Wallet.createRandom().address,
              tab_id: '0x1234',
              req_id: '0x0001',
              amount: '0x3B9ACA00', // 1 billion
              asset_address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
              timestamp: Math.floor(Date.now() / 1000),
              version: 1,
            },
            signature: '0x...',
            scheme: 'eip712',
          },
        },
        paymentRequirements: {
          scheme: '4mica-credit',
          network: 'eip155:11155111',
          maxAmountRequired: '0x3B9ACA00',
          payTo: Wallet.createRandom().address,
          asset: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
        },
      });
      
      expect(result.isValid).toBe(true);
    });
    
    it('should return invalid for bad payload', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          isValid: false,
          invalidReason: 'Signature verification failed',
        }),
      });
      
      const result = await client.verify({
        x402Version: 1,
        paymentPayload: {} as any, // Invalid
        paymentRequirements: {} as any, // Invalid
      });
      
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe('Signature verification failed');
    });
  });
  
  describe('settle', () => {
    it('should settle and return BLS certificate', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          certificate: {
            claims: '0x1234567890abcdef...',
            signature: '0xabcdef1234567890...',
          },
        }),
      });
      
      const result = await client.settle({
        x402Version: 1,
        paymentPayload: {
          x402Version: 1,
          scheme: '4mica-credit',
          network: 'eip155:11155111',
          payload: {
            claims: {
              user_address: testWallet.address,
              recipient_address: Wallet.createRandom().address,
              tab_id: '0x1234',
              req_id: '0x0001',
              amount: '0x3B9ACA00',
              asset_address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
              timestamp: Math.floor(Date.now() / 1000),
              version: 1,
            },
            signature: '0x...',
            scheme: 'eip712',
          },
        },
        paymentRequirements: {
          scheme: '4mica-credit',
          network: 'eip155:11155111',
          maxAmountRequired: '0x3B9ACA00',
          payTo: Wallet.createRandom().address,
          asset: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
        },
      });
      
      expect(result.success).toBe(true);
      expect(result.certificate).toBeDefined();
      expect(result.certificate!.claims).toBe('0x1234567890abcdef...');
    });
  });
  
  describe('requestCreditGuarantee', () => {
    it('should execute full credit guarantee flow', async () => {
      const recipientAddress = Wallet.createRandom().address;
      const amount = BigInt(1000 * 1e6); // 1000 USDC
      
      // Mock openTab - tab_id and req_id must be bytes32 for EIP-712
      const tabId = '0x0000000000000000000000000000000000000000000000000000000000000042';
      const reqId = '0x0000000000000000000000000000000000000000000000000000000000000001';
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          tabId,
          userAddress: testWallet.address,
          recipientAddress,
          assetAddress: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
          startTimestamp: Math.floor(Date.now() / 1000),
          ttlSeconds: 86400,
          nextReqId: reqId,
        }),
      });
      
      // Mock settle
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          certificate: {
            claims: '0xcreditclaims...',
            signature: '0xblssignature...',
          },
        }),
      });
      
      const certificate = await client.requestCreditGuarantee(
        recipientAddress,
        amount,
        'eip155:11155111',
      );
      
      expect(certificate.claims).toBe('0xcreditclaims...');
      expect(certificate.signature).toBe('0xblssignature...');
    });
  });
  
  describe('error handling', () => {
    it('should handle API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });
      
      await expect(client.health()).rejects.toThrow('4Mica API error: 500');
    });
    
    it('should handle timeout', async () => {
      // Create client with very short timeout
      const shortTimeoutConfig = createFourMicaConfig(
        testWallet,
        'eip155:11155111',
      );
      const shortTimeoutClient = new FourMicaClient({
        ...shortTimeoutConfig,
        timeoutMs: 1, // 1ms timeout
      });
      
      // Mock slow response
      mockFetch.mockImplementationOnce(() => 
        new Promise(resolve => setTimeout(resolve, 100))
      );
      
      await expect(shortTimeoutClient.health()).rejects.toThrow();
    });
  });
});

describe('createFourMicaConfig', () => {
  it('should create config with correct USDC address for Sepolia', () => {
    const wallet = Wallet.createRandom();
    const config = createFourMicaConfig(wallet, 'eip155:11155111');
    
    expect(config.defaultNetwork).toBe('eip155:11155111');
    expect(config.defaultAsset).toBe('0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238');
    expect(config.facilitatorUrl).toBe('https://x402.4mica.xyz');
  });
  
  it('should create config with correct USDC address for Mainnet', () => {
    const wallet = Wallet.createRandom();
    const config = createFourMicaConfig(wallet, 'eip155:1');
    
    expect(config.defaultNetwork).toBe('eip155:1');
    expect(config.defaultAsset).toBe('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
  });
  
  it('should use custom facilitator URL', () => {
    const wallet = Wallet.createRandom();
    const config = createFourMicaConfig(
      wallet,
      'eip155:11155111',
      'https://custom.facilitator.xyz',
    );
    
    expect(config.facilitatorUrl).toBe('https://custom.facilitator.xyz');
  });
});
