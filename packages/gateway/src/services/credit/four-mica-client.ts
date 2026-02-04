/**
 * 4Mica Facilitator Client
 * 
 * Handles all interactions with the 4Mica x402 payment protocol.
 * https://4mica.xyz/resources/technical-docs
 * 
 * Main flows:
 * 1. Open Tab → Get tabId for a (user, recipient, asset) triple
 * 2. Sign Payment → Create EIP-712 signed payment guarantee
 * 3. Settle → Submit payment and receive BLS certificate
 */

import { Wallet } from 'ethers';
import {
  TabRequest,
  TabResponse,
  VerifyRequest,
  VerifyResponse,
  SettleRequest,
  SettleResponse,
  HealthResponse,
  SupportedResponse,
  PaymentPayload,
  PaymentRequirements,
  PaymentClaims,
  BLSCertificate,
  NetworkId,
  FOUR_MICA_SCHEME,
} from './types.js';

/**
 * Configuration for 4Mica client
 */
export interface FourMicaClientConfig {
  /** Facilitator API base URL (default: https://x402.4mica.xyz) */
  facilitatorUrl: string;
  /** Signer wallet for payment signatures */
  signer: Wallet;
  /** Default network (CAIP-2 format) */
  defaultNetwork: NetworkId;
  /** Default asset address (USDC) */
  defaultAsset: string;
  /** Request timeout in ms */
  timeoutMs?: number;
}

/**
 * EIP-712 domain for payment signatures
 */
const EIP712_DOMAIN = {
  name: '4Mica Credit',
  version: '1',
  chainId: 1, // Will be overridden per network
};

/**
 * EIP-712 types for payment claims
 */
const EIP712_TYPES = {
  PaymentClaims: [
    { name: 'user_address', type: 'address' },
    { name: 'recipient_address', type: 'address' },
    { name: 'tab_id', type: 'bytes32' },
    { name: 'req_id', type: 'bytes32' },
    { name: 'amount', type: 'uint256' },
    { name: 'asset_address', type: 'address' },
    { name: 'timestamp', type: 'uint256' },
    { name: 'version', type: 'uint256' },
  ],
};

/**
 * Map CAIP-2 network ID to chain ID
 */
function networkToChainId(network: NetworkId): number {
  const parts = network.split(':');
  return parseInt(parts[1], 10);
}

/**
 * 4Mica Facilitator Client
 */
export class FourMicaClient {
  private config: FourMicaClientConfig;
  
  constructor(config: FourMicaClientConfig) {
    this.config = {
      timeoutMs: 30000,
      ...config,
    };
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // HEALTH & INFO
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * Check facilitator health
   */
  async health(): Promise<HealthResponse> {
    const response = await this.fetch('/health');
    return response as HealthResponse;
  }
  
  /**
   * Get supported schemes and networks
   */
  async supported(): Promise<SupportedResponse> {
    const response = await this.fetch('/supported');
    return response as SupportedResponse;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // TAB MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * Open or reuse a payment tab
   * 
   * A tab represents an open credit line between user and recipient
   * for a specific asset.
   */
  async openTab(request: TabRequest): Promise<TabResponse> {
    const response = await this.fetch('/tabs', {
      method: 'POST',
      body: JSON.stringify({
        userAddress: request.userAddress,
        recipientAddress: request.recipientAddress,
        network: request.network || this.config.defaultNetwork,
        erc20Token: request.erc20Token ?? this.config.defaultAsset,
        ttlSeconds: request.ttlSeconds || 86400, // 24 hours default
      }),
    });
    return response as TabResponse;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // PAYMENT VERIFICATION
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * Verify a payment without settling
   * 
   * Validates the X-PAYMENT header structure against requirements.
   */
  async verify(request: VerifyRequest): Promise<VerifyResponse> {
    const response = await this.fetch('/verify', {
      method: 'POST',
      body: JSON.stringify(request),
    });
    return response as VerifyResponse;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // SETTLEMENT
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * Settle a payment and receive BLS certificate
   * 
   * This is the main function for credit execution:
   * 1. Re-validates the payment
   * 2. Issues a BLS certificate for on-chain remuneration
   */
  async settle(request: SettleRequest): Promise<SettleResponse> {
    const response = await this.fetch('/settle', {
      method: 'POST',
      body: JSON.stringify(request),
    });
    return response as SettleResponse;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // HIGH-LEVEL FLOW
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * Execute full credit guarantee flow
   * 
   * @param recipientAddress Address to receive credit
   * @param amount Amount in USDC (6 decimals)
   * @param network Target network
   * @returns BLS certificate for on-chain settlement
   */
  async requestCreditGuarantee(
    recipientAddress: string,
    amount: bigint,
    network?: NetworkId,
  ): Promise<BLSCertificate> {
    const targetNetwork = network || this.config.defaultNetwork;
    const userAddress = this.config.signer.address;
    
    // Step 1: Open tab
    const tab = await this.openTab({
      userAddress,
      recipientAddress,
      network: targetNetwork,
      erc20Token: this.config.defaultAsset,
      ttlSeconds: 86400, // 24 hours
    });
    
    // Step 2: Create and sign payment
    const timestamp = Math.floor(Date.now() / 1000);
    const claims: PaymentClaims = {
      user_address: userAddress,
      recipient_address: recipientAddress,
      tab_id: tab.tabId,
      req_id: tab.nextReqId,
      amount: amount,
      asset_address: this.config.defaultAsset,
      timestamp,
      version: 1,
    };
    
    // Sign with EIP-712
    const signature = await this.signPaymentClaims(claims, targetNetwork);
    
    // Step 3: Build payment payload
    const paymentPayload: PaymentPayload = {
      x402Version: 1,
      scheme: FOUR_MICA_SCHEME,
      network: targetNetwork,
      payload: {
        claims,
        signature,
        scheme: 'eip712',
      },
    };
    
    // Step 4: Build requirements
    const paymentRequirements: PaymentRequirements = {
      scheme: FOUR_MICA_SCHEME,
      network: targetNetwork,
      maxAmountRequired: amount,
      payTo: recipientAddress,
      asset: this.config.defaultAsset,
      extra: {
        tabEndpoint: `${this.config.facilitatorUrl}/tabs`,
      },
    };
    
    // Step 5: Settle and get certificate
    const settleResult = await this.settle({
      x402Version: 1,
      paymentPayload,
      paymentRequirements,
    });
    
    if (!settleResult.success) {
      throw new Error(`4Mica settlement failed: ${settleResult.error}`);
    }
    
    if (!settleResult.certificate) {
      throw new Error('4Mica settlement succeeded but no certificate returned');
    }
    
    return settleResult.certificate;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // SIGNING
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * Sign payment claims using EIP-712
   */
  private async signPaymentClaims(
    claims: PaymentClaims,
    network: NetworkId,
  ): Promise<string> {
    const chainId = networkToChainId(network);
    
    const domain = {
      ...EIP712_DOMAIN,
      chainId,
    };
    
    // Format claims for EIP-712 (ethers v6 uses bigint)
    const value = {
      user_address: claims.user_address,
      recipient_address: claims.recipient_address,
      tab_id: claims.tab_id,
      req_id: claims.req_id,
      amount: claims.amount,
      asset_address: claims.asset_address,
      timestamp: claims.timestamp,
      version: claims.version,
    };
    
    // ethers v6 uses signTypedData (not _signTypedData)
    const signature = await this.config.signer.signTypedData(
      domain,
      EIP712_TYPES,
      value,
    );
    
    return signature;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // HTTP
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * Make fetch request to facilitator
   */
  private async fetch(
    path: string,
    options?: RequestInit,
  ): Promise<unknown> {
    const url = `${this.config.facilitatorUrl}${path}`;
    
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.timeoutMs,
    );
    
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options?.headers,
        },
        signal: controller.signal,
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`4Mica API error: ${response.status} ${errorText}`);
      }
      
      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * Create default client configuration
 */
export function createFourMicaConfig(
  signer: Wallet,
  network: NetworkId = 'eip155:11155111', // Sepolia default
  facilitatorUrl = 'https://x402.4mica.xyz',
): FourMicaClientConfig {
  // USDC addresses by network (using partial record since not all networks may be configured)
  const USDC_ADDRESSES: Partial<Record<NetworkId, string>> = {
    'eip155:1': '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',        // Mainnet
    'eip155:11155111': '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', // Sepolia
    'eip155:8453': '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',     // Base
    'eip155:84532': '0x036CbD53842c5426634e7929541eC2318f3dCF7e',    // Base Sepolia
    'eip155:42161': '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',    // Arbitrum
    'eip155:421614': '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',   // Arbitrum Sepolia
  };
  
  // Sepolia USDC as fallback (we know this key exists)
  const sepoliaUsdc = USDC_ADDRESSES['eip155:11155111']!;
  
  return {
    facilitatorUrl,
    signer,
    defaultNetwork: network,
    defaultAsset: USDC_ADDRESSES[network] ?? sepoliaUsdc,
    timeoutMs: 30000,
  };
}
