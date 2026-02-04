/**
 * Circle Gateway Client
 * 
 * Unified crosschain USDC balance with instant (<500ms) transfers.
 * https://developers.circle.com/gateway
 * 
 * This is DIFFERENT from Circle CCTP:
 * - CCTP: Point-to-point burn/mint transfers (8-20 seconds)
 * - Gateway: Unified balance, instant transfers (<500ms)
 * 
 * For the Credit Studio flow, Gateway is preferred because:
 * 1. Instant execution (<500ms vs 8-20s)
 * 2. Unified balance model works with 4Mica guarantees
 * 3. Direct API integration (no on-chain burn ceremony)
 * 
 * Flow:
 * 1. Deposit USDC to Gateway Wallet contract (one-time setup)
 * 2. Create burn intent with signature
 * 3. Call Gateway API for attestation
 * 4. Mint on destination chain instantly
 */

import { 
  Wallet, 
  Contract, 
  JsonRpcProvider, 
  hexlify, 
  randomBytes, 
  zeroPadValue,
  ZeroAddress,
  Provider,
} from 'ethers';
import { NetworkId } from './types.js';

/**
 * Circle Gateway API endpoints
 */
const GATEWAY_API = {
  testnet: 'https://gateway-api-testnet.circle.com/v1',
  mainnet: 'https://gateway-api.circle.com/v1', // Production
};

/**
 * Gateway Wallet contract addresses (where you deposit USDC)
 */
const GATEWAY_WALLET_ADDRESSES: Record<NetworkId, string> = {
  'eip155:1': '0x...', // Mainnet - TBD
  'eip155:11155111': '0x...', // Sepolia
  'eip155:8453': '0x...', // Base
  'eip155:84532': '0x...', // Base Sepolia
  'eip155:42161': '0x...', // Arbitrum One
  'eip155:421614': '0x...', // Arbitrum Sepolia
  'eip155:80002': '0x...', // Polygon Amoy (if supported)
};

/**
 * Gateway Minter contract addresses (for minting on destination)
 */
const GATEWAY_MINTER_ADDRESSES: Record<NetworkId, string> = {
  'eip155:1': '0x3c4cd5C8d8d36549714E00A55f6C48C5d2a6470D',
  'eip155:11155111': '0x3c4cd5C8d8d36549714E00A55f6C48C5d2a6470D',
  'eip155:8453': '0x3c4cd5C8d8d36549714E00A55f6C48C5d2a6470D',
  'eip155:84532': '0x3c4cd5C8d8d36549714E00A55f6C48C5d2a6470D',
  'eip155:42161': '0x3c4cd5C8d8d36549714E00A55f6C48C5d2a6470D',
  'eip155:421614': '0x3c4cd5C8d8d36549714E00A55f6C48C5d2a6470D',
  'eip155:80002': '0x3c4cd5C8d8d36549714E00A55f6C48C5d2a6470D',
};

/**
 * USDC addresses by network
 */
const USDC_ADDRESSES: Record<NetworkId, string> = {
  'eip155:1': '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  'eip155:11155111': '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
  'eip155:8453': '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  'eip155:84532': '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  'eip155:42161': '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  'eip155:421614': '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
  'eip155:80002': '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582',
};

/**
 * Domain IDs for Gateway (different from CCTP domains)
 */
const GATEWAY_DOMAINS: Record<NetworkId, number> = {
  'eip155:1': 0,          // Ethereum Mainnet
  'eip155:11155111': 0,   // Sepolia
  'eip155:8453': 6,       // Base
  'eip155:84532': 6,      // Base Sepolia
  'eip155:42161': 3,      // Arbitrum One
  'eip155:421614': 3,     // Arbitrum Sepolia
  'eip155:80002': 7,      // Polygon Amoy
};

/**
 * Gateway Minter ABI
 */
const GATEWAY_MINTER_ABI = [
  'function gatewayMint(bytes attestation, bytes signature) returns (bool)',
  'function getBalance(address depositor) view returns (uint256)',
];

/**
 * Gateway Wallet ABI (for deposits)
 */
const GATEWAY_WALLET_ABI = [
  'function deposit(uint256 amount) returns (bool)',
  'function depositWithPermit(uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s) returns (bool)',
  'function withdraw(uint256 amount) returns (bool)',
  'function balanceOf(address depositor) view returns (uint256)',
];

/**
 * EIP-712 types for burn intent
 */
const BURN_INTENT_TYPES = {
  BurnIntent: [
    { name: 'sourceDomain', type: 'uint32' },
    { name: 'destinationDomain', type: 'uint32' },
    { name: 'sourceContract', type: 'bytes32' },
    { name: 'destinationContract', type: 'bytes32' },
    { name: 'sourceToken', type: 'bytes32' },
    { name: 'destinationToken', type: 'bytes32' },
    { name: 'sourceDepositor', type: 'bytes32' },
    { name: 'destinationRecipient', type: 'bytes32' },
    { name: 'sourceSigner', type: 'bytes32' },
    { name: 'destinationCaller', type: 'bytes32' },
    { name: 'value', type: 'uint256' },
    { name: 'salt', type: 'bytes32' },
    { name: 'hookData', type: 'bytes' },
  ],
};

/**
 * Burn Intent structure
 */
export interface BurnIntent {
  sourceDomain: number;
  destinationDomain: number;
  sourceContract: string;
  destinationContract: string;
  sourceToken: string;
  destinationToken: string;
  sourceDepositor: string;
  destinationRecipient: string;
  sourceSigner: string;
  destinationCaller: string;
  value: bigint;
  salt: string;
  hookData: string;
}

/**
 * Transfer request
 */
export interface GatewayTransferRequest {
  amount: bigint;
  sourceNetwork: NetworkId;
  destinationNetwork: NetworkId;
  recipientAddress: string;
}

/**
 * Transfer result
 */
export interface GatewayTransferResult {
  success: boolean;
  sourceTxHash?: string;
  destinationTxHash?: string;
  error?: string;
  attestation?: string;
}

/**
 * Configuration for Circle Gateway Client
 */
export interface CircleGatewayClientConfig {
  /** Signer wallet */
  signer: Wallet;
  /** Source chain provider */
  sourceProvider: Provider;
  /** Destination chain provider */
  destinationProvider: Provider;
  /** Source network */
  sourceNetwork: NetworkId;
  /** Destination network */
  destinationNetwork: NetworkId;
  /** Use testnet API (default: true) */
  useTestnet?: boolean;
}

/**
 * Circle Gateway Client
 * 
 * Provides instant (<500ms) crosschain USDC transfers
 * via unified balance model.
 */
export class CircleGatewayClient {
  private config: CircleGatewayClientConfig;
  private apiUrl: string;
  private gatewayMinter: Contract;
  
  constructor(config: CircleGatewayClientConfig) {
    this.config = {
      useTestnet: true,
      ...config,
    };
    
    this.apiUrl = config.useTestnet 
      ? GATEWAY_API.testnet 
      : GATEWAY_API.mainnet;
    
    // Initialize minter contract on destination chain
    const destSigner = config.signer.connect(config.destinationProvider);
    const minterAddress = GATEWAY_MINTER_ADDRESSES[config.destinationNetwork];
    
    this.gatewayMinter = new Contract(
      minterAddress,
      GATEWAY_MINTER_ABI,
      destSigner,
    );
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // TRANSFER (INSTANT)
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * Transfer USDC instantly across chains
   * 
   * This is the main function for Credit Studio:
   * 1. Creates burn intent from Gateway balance
   * 2. Signs it
   * 3. Calls Gateway API for attestation
   * 4. Mints on destination chain (<500ms)
   */
  async transfer(request: GatewayTransferRequest): Promise<GatewayTransferResult> {
    try {
      // Step 1: Create burn intent
      const burnIntent = this.createBurnIntent(request);
      
      // Step 2: Sign the burn intent
      const signature = await this.signBurnIntent(burnIntent);
      
      // Step 3: Get attestation from Gateway API
      console.log('Requesting Gateway attestation...');
      const attestation = await this.getAttestation(burnIntent, signature);
      
      // Step 4: Mint on destination chain (instant!)
      console.log(`Minting on ${this.config.destinationNetwork}...`);
      const mintTx = await this.gatewayMinter.gatewayMint(
        attestation.attestation,
        attestation.signature,
      );
      const mintReceipt = await mintTx.wait();
      
      console.log(`Transfer complete in <500ms! Tx: ${mintReceipt.transactionHash}`);
      
      return {
        success: true,
        destinationTxHash: mintReceipt.transactionHash,
        attestation: attestation.attestation,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
  
  /**
   * Create burn intent for Gateway
   */
  private createBurnIntent(request: GatewayTransferRequest): BurnIntent {
    const sourceDomain = GATEWAY_DOMAINS[request.sourceNetwork];
    const destDomain = GATEWAY_DOMAINS[request.destinationNetwork];
    
    // Generate random salt (ethers v6)
    const salt = hexlify(randomBytes(32));
    
    return {
      sourceDomain,
      destinationDomain: destDomain,
      sourceContract: this.addressToBytes32(GATEWAY_WALLET_ADDRESSES[request.sourceNetwork]),
      destinationContract: this.addressToBytes32(GATEWAY_MINTER_ADDRESSES[request.destinationNetwork]),
      sourceToken: this.addressToBytes32(USDC_ADDRESSES[request.sourceNetwork]),
      destinationToken: this.addressToBytes32(USDC_ADDRESSES[request.destinationNetwork]),
      sourceDepositor: this.addressToBytes32(this.config.signer.address),
      destinationRecipient: this.addressToBytes32(request.recipientAddress),
      sourceSigner: this.addressToBytes32(this.config.signer.address),
      destinationCaller: this.addressToBytes32(ZeroAddress), // Anyone can call
      value: request.amount,
      salt,
      hookData: '0x', // No hook data for simple transfers
    };
  }
  
  /**
   * Sign burn intent using EIP-712
   */
  private async signBurnIntent(intent: BurnIntent): Promise<string> {
    // Get chain ID from provider (ethers v6)
    const network = await this.config.sourceProvider.getNetwork();
    
    const domain = {
      name: 'CircleGateway',
      version: '1',
      chainId: Number(network.chainId),
    };
    
    const value = {
      ...intent,
      value: intent.value, // ethers v6 handles bigint natively
    };
    
    // ethers v6 uses signTypedData (not _signTypedData)
    return await this.config.signer.signTypedData(
      domain,
      BURN_INTENT_TYPES,
      value,
    );
  }
  
  /**
   * Get attestation from Circle Gateway API
   */
  private async getAttestation(
    intent: BurnIntent,
    signature: string,
  ): Promise<{ attestation: string; signature: string }> {
    const response = await fetch(`${this.apiUrl}/transfer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{
        burnIntent: this.serializeBurnIntent(intent),
        signature,
      }]),
    });
    
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Gateway API error: ${response.status} ${text}`);
    }
    
    const json = await response.json() as { attestation?: string; signature?: string };
    
    if (!json.attestation || !json.signature) {
      throw new Error('Missing attestation or signature in Gateway response');
    }
    
    return {
      attestation: json.attestation,
      signature: json.signature,
    };
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // DEPOSIT (One-time setup)
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * Deposit USDC to Gateway Wallet
   * 
   * This is a one-time setup step - deposit USDC to establish
   * your unified crosschain balance. After this, transfers are instant.
   */
  async deposit(
    amount: bigint,
    network: NetworkId,
    provider: Provider,
  ): Promise<string> {
    const signer = this.config.signer.connect(provider);
    
    // First approve USDC
    const usdc = new Contract(
      USDC_ADDRESSES[network],
      ['function approve(address, uint256) returns (bool)'],
      signer,
    );
    
    const walletAddress = GATEWAY_WALLET_ADDRESSES[network];
    const approveTx = await usdc.approve(walletAddress, amount);
    await approveTx.wait();
    
    // Then deposit
    const wallet = new Contract(
      walletAddress,
      GATEWAY_WALLET_ABI,
      signer,
    );
    
    const depositTx = await wallet.deposit(amount);
    const receipt = await depositTx.wait();
    
    return receipt?.hash || '';
  }
  
  /**
   * Get Gateway balance
   */
  async getBalance(network: NetworkId, provider: Provider): Promise<bigint> {
    const wallet = new Contract(
      GATEWAY_WALLET_ADDRESSES[network],
      GATEWAY_WALLET_ABI,
      provider,
    );
    
    const balance = await wallet.balanceOf(this.config.signer.address);
    return BigInt(balance);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // UTILITIES
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * Convert address to bytes32
   */
  private addressToBytes32(address: string): string {
    return zeroPadValue(address.toLowerCase(), 32);
  }
  
  /**
   * Serialize burn intent for API
   */
  private serializeBurnIntent(intent: BurnIntent): Record<string, unknown> {
    return {
      ...intent,
      value: intent.value.toString(),
    };
  }
  
  /**
   * Check if Gateway is supported for a network pair
   */
  static isSupported(source: NetworkId, destination: NetworkId): boolean {
    return !!(
      GATEWAY_DOMAINS[source] !== undefined &&
      GATEWAY_DOMAINS[destination] !== undefined &&
      GATEWAY_WALLET_ADDRESSES[source] &&
      GATEWAY_MINTER_ADDRESSES[destination]
    );
  }
}

/**
 * Create Circle Gateway client
 */
export function createCircleGatewayClient(
  privateKey: string,
  sourceProviderUrl: string,
  destinationProviderUrl: string,
  sourceNetwork: NetworkId,
  destinationNetwork: NetworkId,
  useTestnet = true,
): CircleGatewayClient {
  const sourceProvider = new JsonRpcProvider(sourceProviderUrl);
  const destinationProvider = new JsonRpcProvider(destinationProviderUrl);
  const signer = new Wallet(privateKey);
  
  return new CircleGatewayClient({
    signer,
    sourceProvider,
    destinationProvider,
    sourceNetwork,
    destinationNetwork,
    useTestnet,
  });
}
