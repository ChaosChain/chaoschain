/**
 * ClawPay Client
 * 
 * Private payments for AI agents using Railgun.
 * https://clawpay.dev
 * 
 * Features:
 * - Private transfers (shielded balances)
 * - Invoice addresses for receiving payments
 * - Cross-agent payments
 */

import { Wallet } from 'ethers';
import { ClawPayTransferRequest, ClawPayTransferResult } from './types.js';

/**
 * ClawPay API base URL
 */
const CLAWPAY_API_BASE = 'https://clawpay.dev';

/**
 * Sign message for ClawPay authentication
 */
const SIGN_MESSAGE = 'b402 Incognito EOA Derivation';

/**
 * Configuration for ClawPay Client
 */
export interface ClawPayClientConfig {
  /** Signer wallet for authentication */
  signer: Wallet;
  /** API base URL (default: https://clawpay.dev) */
  apiBaseUrl?: string;
  /** Request timeout in ms */
  timeoutMs?: number;
}

/**
 * ClawPay balance response
 */
export interface ClawPayBalance {
  token: string;
  shieldedBalance: string;
  availableBalance: string;
}

/**
 * ClawPay invoice response
 */
export interface ClawPayInvoice {
  invoiceAddress: string;
  createdAt: number;
}

/**
 * ClawPay transfer status
 */
export interface ClawPayTransferStatus {
  transferId: string;
  status: 'pending' | 'broadcasting' | 'confirmed' | 'failed';
  txHash?: string;
  error?: string;
  createdAt: number;
  confirmedAt?: number;
}

/**
 * ClawPay Client
 * 
 * Private payment integration for AI agents
 */
export class ClawPayClient {
  private config: ClawPayClientConfig;
  private signature: string | null = null;
  private eoaAddress: string;
  
  constructor(config: ClawPayClientConfig) {
    this.config = {
      apiBaseUrl: CLAWPAY_API_BASE,
      timeoutMs: 60000, // 60 seconds (Railgun proofs take time)
      ...config,
    };
    this.eoaAddress = config.signer.address;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // AUTHENTICATION
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * Sign authentication message
   * Required before any API calls
   */
  async authenticate(): Promise<void> {
    if (this.signature) return;
    
    this.signature = await this.config.signer.signMessage(SIGN_MESSAGE);
    console.log(`ClawPay authenticated: ${this.eoaAddress}`);
  }
  
  /**
   * Ensure authenticated
   */
  private async ensureAuth(): Promise<void> {
    if (!this.signature) {
      await this.authenticate();
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // HEALTH
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * Check ClawPay service health
   */
  async health(): Promise<{ status: 'ok' | 'error'; message?: string }> {
    try {
      const response = await this.fetch('/health');
      return response as { status: 'ok' | 'error' };
    } catch (error) {
      return {
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // INVOICE
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * Get invoice address for receiving private payments
   */
  async getInvoiceAddress(): Promise<string> {
    await this.ensureAuth();
    
    const response = await this.fetch('/invoice', {
      method: 'GET',
      params: {
        eoa: this.eoaAddress,
        signature: this.signature!,
      },
    });
    
    return (response as ClawPayInvoice).invoiceAddress;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // BALANCE
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * Get shielded balance for a token
   */
  async getBalance(token: 'USDT' | 'USDC' = 'USDT'): Promise<ClawPayBalance> {
    await this.ensureAuth();
    
    const response = await this.fetch('/balance', {
      method: 'GET',
      params: {
        eoa: this.eoaAddress,
        signature: this.signature!,
        token,
      },
    });
    
    return response as ClawPayBalance;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // TRANSFERS
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * Transfer tokens privately
   */
  async transfer(request: ClawPayTransferRequest): Promise<ClawPayTransferResult> {
    await this.ensureAuth();
    
    try {
      const response = await this.fetch('/transfer', {
        method: 'POST',
        body: JSON.stringify({
          eoa: this.eoaAddress,
          signature: this.signature,
          recipient: request.recipient,
          amount: request.amount,
          token: request.token,
        }),
      });
      
      const result = response as { transferId: string };
      
      return {
        transferId: result.transferId,
        status: 'pending',
      };
    } catch (error) {
      return {
        transferId: '',
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
  
  /**
   * Get transfer status
   */
  async getTransferStatus(transferId: string): Promise<ClawPayTransferStatus> {
    const response = await this.fetch(`/status/${transferId}`);
    return response as ClawPayTransferStatus;
  }
  
  /**
   * Wait for transfer to confirm
   */
  async waitForConfirmation(
    transferId: string,
    maxWaitMs = 300000, // 5 minutes
    pollIntervalMs = 10000,
  ): Promise<ClawPayTransferStatus> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitMs) {
      const status = await this.getTransferStatus(transferId);
      
      if (status.status === 'confirmed' || status.status === 'failed') {
        return status;
      }
      
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }
    
    throw new Error('Transfer confirmation timed out');
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // HTTP
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * Make fetch request to ClawPay API
   */
  private async fetch(
    path: string,
    options?: {
      method?: 'GET' | 'POST';
      body?: string;
      params?: Record<string, string>;
    },
  ): Promise<unknown> {
    let url = `${this.config.apiBaseUrl}${path}`;
    
    // Add query params for GET requests
    if (options?.params) {
      const searchParams = new URLSearchParams(options.params);
      url = `${url}?${searchParams.toString()}`;
    }
    
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.timeoutMs,
    );
    
    try {
      const response = await fetch(url, {
        method: options?.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        body: options?.body,
        signal: controller.signal,
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`ClawPay API error: ${response.status} ${errorText}`);
      }
      
      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * Create ClawPay client
 */
export function createClawPayClient(
  privateKey: string,
  apiBaseUrl = CLAWPAY_API_BASE,
): ClawPayClient {
  const signer = new Wallet(privateKey);
  
  return new ClawPayClient({
    signer,
    apiBaseUrl,
  });
}
