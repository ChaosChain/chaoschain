/**
 * Circle Gateway Client
 * 
 * Provides instant (<500ms) crosschain USDC transfers via unified balance model.
 * 
 * Architecture:
 * 1. Deposit USDC to Gateway Wallet (one-time setup per chain)
 * 2. Create & sign burn intents for transfer
 * 3. Submit to Gateway API for attestation
 * 4. Call gatewayMint() on destination chain
 * 
 * Reference: https://developers.circle.com/gateway
 */

import { randomBytes } from 'node:crypto';
import {
  Wallet,
  Contract,
  zeroPadValue,
  getAddress,
  formatUnits,
  parseUnits,
  MaxUint256,
  ZeroAddress,
  type Provider,
} from 'ethers';

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS - Same across ALL EVM chains
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Gateway Wallet address (same on all EVM chains)
 * Used for depositing USDC to create unified balance
 */
export const GATEWAY_WALLET_ADDRESS = '0x0077777d7EBA4688BDeF3E311b846F25870A19B9';

/**
 * Gateway Minter address (same on all EVM chains)
 * Used for minting USDC on destination chain
 */
export const GATEWAY_MINTER_ADDRESS = '0x0022222ABE238Cc2C7Bb1f21003F0a260052475B';

/**
 * Gateway API endpoints
 */
export const GATEWAY_API = {
  testnet: 'https://gateway-api-testnet.circle.com/v1',
  mainnet: 'https://gateway-api.circle.com/v1',
} as const;

/**
 * Domain IDs for Circle Gateway (official from docs)
 */
export const GATEWAY_DOMAINS = {
  // EVM chains
  'eip155:1': 0,          // Ethereum Mainnet
  'eip155:11155111': 0,   // Ethereum Sepolia (same domain as mainnet)
  'eip155:43114': 1,      // Avalanche C-Chain
  'eip155:43113': 1,      // Avalanche Fuji
  'eip155:8453': 6,       // Base Mainnet
  'eip155:84532': 6,      // Base Sepolia
  'eip155:146': 13,       // Sonic Mainnet
  'eip155:57054': 13,     // Sonic Testnet
  'eip155:480': 14,       // Worldchain Mainnet
  'eip155:4801': 14,      // Worldchain Sepolia
  'eip155:1329': 16,      // Sei Mainnet
  'eip155:1328': 16,      // Sei Testnet
  'eip155:998': 19,       // Hyperliquid EVM
  'eip155:1301': 26,      // Arc Testnet
  'eip155:42161': 3,      // Arbitrum One
  'eip155:421614': 3,     // Arbitrum Sepolia
  // Solana
  'solana:mainnet': 5,
  'solana:devnet': 5,
} as const;

/**
 * USDC addresses by network
 */
export const USDC_ADDRESSES: Record<string, string> = {
  // Mainnet
  'eip155:1': '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  'eip155:43114': '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
  'eip155:8453': '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  'eip155:42161': '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  // Testnet
  'eip155:11155111': '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
  'eip155:43113': '0x5425890298aed601595a70ab815c96711a31bc65',
  'eip155:84532': '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  'eip155:421614': '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
  'eip155:1328': '0x4fCF1784B31630811181f670Aea7A7bEF803eaED',
  'eip155:57054': '0x0BA304580ee7c9a980CF72e55f5Ed2E9fd30Bc51',
  'eip155:4801': '0x66145f38cBAC35Ca6F1Dfb4914dF98F1614aeA88',
  'eip155:998': '0x2B3370eE501B4a559b57D449569354196457D8Ab',
  'eip155:1301': '0x3600000000000000000000000000000000000000',
};

/**
 * Chain ID to network ID mapping
 */
export const CHAIN_ID_TO_NETWORK: Record<number, string> = {
  1: 'eip155:1',
  11155111: 'eip155:11155111',
  43114: 'eip155:43114',
  43113: 'eip155:43113',
  8453: 'eip155:8453',
  84532: 'eip155:84532',
  42161: 'eip155:42161',
  421614: 'eip155:421614',
  1329: 'eip155:1329',
  1328: 'eip155:1328',
  146: 'eip155:146',
  57054: 'eip155:57054',
  480: 'eip155:480',
  4801: 'eip155:4801',
  998: 'eip155:998',
  1301: 'eip155:1301',
};

// ═══════════════════════════════════════════════════════════════════════════════
// ABIs
// ═══════════════════════════════════════════════════════════════════════════════

const GATEWAY_WALLET_ABI = [
  'function deposit(address token, uint256 value) external',
  'function depositWithPermit(address token, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external',
  'event Deposit(address indexed depositor, address indexed token, uint256 amount)',
];

const GATEWAY_MINTER_ABI = [
  'function gatewayMint(bytes calldata attestationPayload, bytes calldata signature) external',
  'event GatewayMint(address indexed recipient, address indexed token, uint256 amount)',
];

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function balanceOf(address account) external view returns (uint256)',
  'function allowance(address owner, address spender) external view returns (uint256)',
];

// ═══════════════════════════════════════════════════════════════════════════════
// EIP-712 Types for Burn Intent
// ═══════════════════════════════════════════════════════════════════════════════

const EIP712_DOMAIN = {
  name: 'GatewayWallet',
  version: '1',
};

const TRANSFER_SPEC_TYPE = [
  { name: 'version', type: 'uint32' },
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
];

const BURN_INTENT_TYPE = [
  { name: 'maxBlockHeight', type: 'uint256' },
  { name: 'maxFee', type: 'uint256' },
  { name: 'spec', type: 'TransferSpec' },
];

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export type NetworkId = keyof typeof GATEWAY_DOMAINS;

export interface TransferSpec {
  version: number;
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

export interface BurnIntent {
  maxBlockHeight: bigint;
  maxFee: bigint;
  spec: TransferSpec;
}

export interface GatewayTransferRequest {
  /** Amount in USDC (6 decimals) */
  amount: bigint;
  /** Source network (e.g., 'eip155:11155111') */
  sourceNetwork: NetworkId;
  /** Destination network */
  destinationNetwork: NetworkId;
  /** Recipient address on destination chain */
  recipientAddress: string;
  /** Max fee willing to pay (default: 2.01 USDC) */
  maxFee?: bigint;
}

export interface GatewayTransferResult {
  success: boolean;
  /** Transaction hash on destination chain */
  mintTxHash?: string;
  /** Amount minted (may be less than requested due to fees) */
  amountMinted?: bigint;
  /** Error message if failed */
  error?: string;
  /** Attestation from Gateway API */
  attestation?: string;
}

export interface GatewayDepositResult {
  success: boolean;
  txHash?: string;
  amount?: bigint;
  error?: string;
}

export interface GatewayBalance {
  domain: number;
  balance: string;
}

export interface CircleGatewayConfig {
  /** Signer wallet with funded USDC */
  signer: Wallet;
  /** Use testnet (default: true) */
  useTestnet?: boolean;
  /** Request timeout in ms */
  timeoutMs?: number;
  /** Providers for each network (chainId -> provider) */
  providers: Map<number, Provider>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Circle Gateway Client
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Circle Gateway Client
 * 
 * Production-ready client for instant crosschain USDC transfers.
 * 
 * Usage:
 * ```typescript
 * const client = new CircleGatewayClient({
 *   signer: wallet,
 *   providers: new Map([
 *     [11155111, sepoliaProvider],
 *     [84532, baseSepoliaProvider],
 *   ]),
 * });
 * 
 * // One-time: Deposit to create unified balance
 * await client.deposit('eip155:11155111', 1000_000000n); // 1000 USDC
 * 
 * // Instant transfer to any chain
 * const result = await client.transfer({
 *   amount: 100_000000n,
 *   sourceNetwork: 'eip155:11155111',
 *   destinationNetwork: 'eip155:84532',
 *   recipientAddress: '0x...',
 * });
 * ```
 */
export class CircleGatewayClient {
  private config: Required<CircleGatewayConfig>;
  private apiUrl: string;
  
  constructor(config: CircleGatewayConfig) {
    this.config = {
      useTestnet: true,
      timeoutMs: 30000,
      ...config,
    };
    
    this.apiUrl = config.useTestnet 
      ? GATEWAY_API.testnet 
      : GATEWAY_API.mainnet;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // DEPOSIT - One-time setup to create unified balance
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * Deposit USDC to Gateway Wallet to create/add to unified balance
   * 
   * This is a one-time setup step. After depositing, you can transfer
   * from this balance instantly to any supported chain.
   * 
   * @param network Source network to deposit from
   * @param amount Amount in USDC (6 decimals)
   */
  async deposit(network: NetworkId, amount: bigint): Promise<GatewayDepositResult> {
    try {
      const chainId = this.networkToChainId(network);
      const provider = this.config.providers.get(chainId);
      
      if (!provider) {
        throw new Error(`No provider configured for chain ${chainId}`);
      }
      
      const signer = this.config.signer.connect(provider);
      const usdcAddress = USDC_ADDRESSES[network];
      
      if (!usdcAddress) {
        throw new Error(`USDC not supported on ${network}`);
      }
      
      // Get contracts
      const usdc = new Contract(usdcAddress, ERC20_ABI, signer);
      const gatewayWallet = new Contract(GATEWAY_WALLET_ADDRESS, GATEWAY_WALLET_ABI, signer);
      
      // Check balance
      const balance = await usdc.balanceOf(signer.address);
      if (balance < amount) {
        throw new Error(`Insufficient USDC balance: have ${formatUnits(balance, 6)}, need ${formatUnits(amount, 6)}`);
      }
      
      // Check allowance and approve if needed
      const allowance = await usdc.allowance(signer.address, GATEWAY_WALLET_ADDRESS);
      if (allowance < amount) {
        console.log(`Approving Gateway Wallet to spend ${formatUnits(amount, 6)} USDC...`);
        const approveTx = await usdc.approve(GATEWAY_WALLET_ADDRESS, amount);
        await approveTx.wait();
        console.log(`Approved: ${approveTx.hash}`);
      }
      
      // Deposit
      console.log(`Depositing ${formatUnits(amount, 6)} USDC to Gateway Wallet...`);
      const depositTx = await gatewayWallet.deposit(usdcAddress, amount);
      const receipt = await depositTx.wait();
      
      console.log(`Deposited: ${receipt.hash}`);
      
      return {
        success: true,
        txHash: receipt.hash,
        amount,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // TRANSFER - Instant crosschain transfer
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * Transfer USDC instantly from unified balance to destination chain
   * 
   * @param request Transfer request details
   */
  async transfer(request: GatewayTransferRequest): Promise<GatewayTransferResult> {
    try {
      const {
        amount,
        sourceNetwork,
        destinationNetwork,
        recipientAddress,
        maxFee = 2_010000n, // 2.01 USDC default max fee
      } = request;
      
      // Validate networks
      const sourceDomain = GATEWAY_DOMAINS[sourceNetwork];
      const destDomain = GATEWAY_DOMAINS[destinationNetwork];
      
      if (sourceDomain === undefined) {
        throw new Error(`Unsupported source network: ${sourceNetwork}`);
      }
      if (destDomain === undefined) {
        throw new Error(`Unsupported destination network: ${destinationNetwork}`);
      }
      
      // Get USDC addresses
      const sourceUsdc = USDC_ADDRESSES[sourceNetwork];
      const destUsdc = USDC_ADDRESSES[destinationNetwork];
      
      if (!sourceUsdc || !destUsdc) {
        throw new Error(`USDC not configured for ${sourceNetwork} or ${destinationNetwork}`);
      }
      
      // Create burn intent
      const burnIntent = this.createBurnIntent({
        sourceDomain,
        destinationDomain: destDomain,
        sourceToken: sourceUsdc,
        destinationToken: destUsdc,
        recipientAddress,
        amount,
        maxFee,
      });
      
      // Sign burn intent (EIP-712)
      const signature = await this.signBurnIntent(burnIntent);
      
      // Format for API
      const apiRequest = this.formatBurnIntentForApi(burnIntent, signature);
      
      // Submit to Gateway API
      console.log(`Submitting burn intent to Gateway API...`);
      const apiResponse = await this.callGatewayApi('/transfer', [apiRequest]);
      
      if (!apiResponse.attestation || !apiResponse.signature) {
        throw new Error('Missing attestation or signature from Gateway API');
      }
      
      console.log(`Received attestation from Gateway API`);
      
      // Mint on destination chain
      const destChainId = this.networkToChainId(destinationNetwork);
      const destProvider = this.config.providers.get(destChainId);
      
      if (!destProvider) {
        throw new Error(`No provider configured for destination chain ${destChainId}`);
      }
      
      const destSigner = this.config.signer.connect(destProvider);
      const gatewayMinter = new Contract(GATEWAY_MINTER_ADDRESS, GATEWAY_MINTER_ABI, destSigner);
      
      console.log(`Minting on ${destinationNetwork}...`);
      const mintTx = await gatewayMinter.gatewayMint(
        apiResponse.attestation,
        apiResponse.signature,
      );
      const mintReceipt = await mintTx.wait();
      
      console.log(`Minted! Tx: ${mintReceipt.hash}`);
      
      return {
        success: true,
        mintTxHash: mintReceipt.hash,
        amountMinted: amount, // May be less after fees
        attestation: apiResponse.attestation,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
  
  /**
   * Transfer from multiple source chains to one destination
   * 
   * Useful for aggregating balances from multiple chains.
   */
  async transferMultiSource(
    sources: Array<{ network: NetworkId; amount: bigint }>,
    destinationNetwork: NetworkId,
    recipientAddress: string,
    maxFeePerSource = 2_010000n,
  ): Promise<GatewayTransferResult> {
    try {
      const requests: Array<{ burnIntent: unknown; signature: string }> = [];
      
      const destDomain = GATEWAY_DOMAINS[destinationNetwork];
      const destUsdc = USDC_ADDRESSES[destinationNetwork];
      
      if (destDomain === undefined || !destUsdc) {
        throw new Error(`Invalid destination network: ${destinationNetwork}`);
      }
      
      // Create and sign burn intents for each source
      for (const source of sources) {
        const sourceDomain = GATEWAY_DOMAINS[source.network];
        const sourceUsdc = USDC_ADDRESSES[source.network];
        
        if (sourceDomain === undefined || !sourceUsdc) {
          throw new Error(`Invalid source network: ${source.network}`);
        }
        
        const burnIntent = this.createBurnIntent({
          sourceDomain,
          destinationDomain: destDomain,
          sourceToken: sourceUsdc,
          destinationToken: destUsdc,
          recipientAddress,
          amount: source.amount,
          maxFee: maxFeePerSource,
        });
        
        const signature = await this.signBurnIntent(burnIntent);
        requests.push(this.formatBurnIntentForApi(burnIntent, signature));
      }
      
      // Submit all to Gateway API
      console.log(`Submitting ${requests.length} burn intents to Gateway API...`);
      const apiResponse = await this.callGatewayApi('/transfer', requests);
      
      if (!apiResponse.attestation || !apiResponse.signature) {
        throw new Error('Missing attestation or signature from Gateway API');
      }
      
      // Mint on destination chain (single tx for all sources!)
      const destChainId = this.networkToChainId(destinationNetwork);
      const destProvider = this.config.providers.get(destChainId);
      
      if (!destProvider) {
        throw new Error(`No provider for destination chain ${destChainId}`);
      }
      
      const destSigner = this.config.signer.connect(destProvider);
      const gatewayMinter = new Contract(GATEWAY_MINTER_ADDRESS, GATEWAY_MINTER_ABI, destSigner);
      
      console.log(`Minting aggregated amount on ${destinationNetwork}...`);
      const mintTx = await gatewayMinter.gatewayMint(
        apiResponse.attestation,
        apiResponse.signature,
      );
      const mintReceipt = await mintTx.wait();
      
      const totalAmount = sources.reduce((sum, s) => sum + s.amount, 0n);
      
      return {
        success: true,
        mintTxHash: mintReceipt.hash,
        amountMinted: totalAmount,
        attestation: apiResponse.attestation,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // BALANCE - Check unified balance
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * Get unified balance across all chains
   */
  async getBalances(networks: NetworkId[]): Promise<GatewayBalance[]> {
    const sources = networks.map(network => ({
      domain: GATEWAY_DOMAINS[network],
      depositor: this.config.signer.address,
    }));
    
    const response = await this.callGatewayApi('/balances', {
      token: 'USDC',
      sources,
    });
    
    return response.balances || [];
  }
  
  /**
   * Get total unified balance in USDC (as a number)
   * 
   * Note: API returns balance as string in USDC format (e.g., "10.200000")
   */
  async getTotalBalance(networks: NetworkId[]): Promise<number> {
    const balances = await this.getBalances(networks);
    return balances.reduce(
      (sum, b) => sum + parseFloat(b.balance),
      0,
    );
  }
  
  /**
   * Get total unified balance in micro-USDC (as bigint, 6 decimals)
   */
  async getTotalBalanceRaw(networks: NetworkId[]): Promise<bigint> {
    const balances = await this.getBalances(networks);
    // Convert USDC string to micro-USDC bigint
    return balances.reduce(
      (sum, b) => sum + BigInt(Math.floor(parseFloat(b.balance) * 1e6)),
      0n,
    );
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE METHODS
  // ═══════════════════════════════════════════════════════════════════════════
  
  private createBurnIntent(params: {
    sourceDomain: number;
    destinationDomain: number;
    sourceToken: string;
    destinationToken: string;
    recipientAddress: string;
    amount: bigint;
    maxFee: bigint;
  }): BurnIntent {
    const salt = '0x' + randomBytes(32).toString('hex');
    
    return {
      maxBlockHeight: MaxUint256,
      maxFee: params.maxFee,
      spec: {
        version: 1,
        sourceDomain: params.sourceDomain,
        destinationDomain: params.destinationDomain,
        sourceContract: this.addressToBytes32(GATEWAY_WALLET_ADDRESS),
        destinationContract: this.addressToBytes32(GATEWAY_MINTER_ADDRESS),
        sourceToken: this.addressToBytes32(params.sourceToken),
        destinationToken: this.addressToBytes32(params.destinationToken),
        sourceDepositor: this.addressToBytes32(this.config.signer.address),
        destinationRecipient: this.addressToBytes32(params.recipientAddress),
        sourceSigner: this.addressToBytes32(this.config.signer.address),
        destinationCaller: this.addressToBytes32(ZeroAddress),
        value: params.amount,
        salt,
        hookData: '0x',
      },
    };
  }
  
  private async signBurnIntent(burnIntent: BurnIntent): Promise<string> {
    const types = {
      TransferSpec: TRANSFER_SPEC_TYPE,
      BurnIntent: BURN_INTENT_TYPE,
    };
    
    // Format message with proper bytes32 padding
    const message = {
      maxBlockHeight: burnIntent.maxBlockHeight,
      maxFee: burnIntent.maxFee,
      spec: {
        version: burnIntent.spec.version,
        sourceDomain: burnIntent.spec.sourceDomain,
        destinationDomain: burnIntent.spec.destinationDomain,
        sourceContract: burnIntent.spec.sourceContract,
        destinationContract: burnIntent.spec.destinationContract,
        sourceToken: burnIntent.spec.sourceToken,
        destinationToken: burnIntent.spec.destinationToken,
        sourceDepositor: burnIntent.spec.sourceDepositor,
        destinationRecipient: burnIntent.spec.destinationRecipient,
        sourceSigner: burnIntent.spec.sourceSigner,
        destinationCaller: burnIntent.spec.destinationCaller,
        value: burnIntent.spec.value,
        salt: burnIntent.spec.salt,
        hookData: burnIntent.spec.hookData,
      },
    };
    
    return await this.config.signer.signTypedData(EIP712_DOMAIN, types, message);
  }
  
  private formatBurnIntentForApi(burnIntent: BurnIntent, signature: string): { burnIntent: unknown; signature: string } {
    // Convert BigInt to string for JSON serialization
    return {
      burnIntent: {
        maxBlockHeight: burnIntent.maxBlockHeight.toString(),
        maxFee: burnIntent.maxFee.toString(),
        spec: {
          ...burnIntent.spec,
          value: burnIntent.spec.value.toString(),
        },
      },
      signature,
    };
  }
  
  private async callGatewayApi(endpoint: string, body: unknown): Promise<any> {
    const url = `${this.apiUrl}${endpoint}`;
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gateway API error ${response.status}: ${errorText}`);
      }
      
      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }
  
  private addressToBytes32(address: string): string {
    return zeroPadValue(getAddress(address), 32);
  }
  
  private networkToChainId(network: NetworkId): number {
    const match = network.match(/eip155:(\d+)/);
    if (!match) {
      throw new Error(`Invalid EVM network ID: ${network}`);
    }
    return parseInt(match[1], 10);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // STATIC HELPERS
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * Check if a network pair is supported by Gateway
   */
  static isSupported(source: NetworkId, destination: NetworkId): boolean {
    return (
      GATEWAY_DOMAINS[source] !== undefined &&
      GATEWAY_DOMAINS[destination] !== undefined &&
      USDC_ADDRESSES[source] !== undefined &&
      USDC_ADDRESSES[destination] !== undefined
    );
  }
  
  /**
   * Get domain ID for a network
   */
  static getDomainId(network: NetworkId): number | undefined {
    return GATEWAY_DOMAINS[network];
  }
  
  /**
   * Get USDC address for a network
   */
  static getUsdcAddress(network: NetworkId): string | undefined {
    return USDC_ADDRESSES[network];
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FACTORY FUNCTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a Circle Gateway client
 * 
 * @example
 * ```typescript
 * const client = createCircleGatewayClient(
 *   privateKey,
 *   new Map([
 *     [11155111, new JsonRpcProvider('https://sepolia.infura.io/...')],
 *     [84532, new JsonRpcProvider('https://base-sepolia.infura.io/...')],
 *   ]),
 *   true, // testnet
 * );
 * ```
 */
export function createCircleGatewayClient(
  privateKey: string,
  providers: Map<number, Provider>,
  useTestnet = true,
): CircleGatewayClient {
  const signer = new Wallet(privateKey);
  
  return new CircleGatewayClient({
    signer,
    providers,
    useTestnet,
  });
}
