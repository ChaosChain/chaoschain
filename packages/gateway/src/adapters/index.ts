/**
 * Gateway Adapters
 * 
 * Adapter implementations for external services:
 * - Chain (ethers.js)
 * - Arweave (Turbo / Irys)
 */

export {
  EthersChainAdapter,
  StudioProxyEncoder,
  createChainAdapter,
  createChainAdapterWithSigner,
} from './chain-adapter.js';

// Type-only exports
export type { TurboClient } from './arweave-adapter.js';

// Value exports
export { TurboArweaveAdapter, IrysArweaveAdapter, MockArweaveAdapter } from './arweave-adapter.js';
