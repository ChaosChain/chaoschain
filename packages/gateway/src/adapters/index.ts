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

export {
  TurboClient,
  TurboArweaveAdapter,
  IrysArweaveAdapter,
  MockArweaveAdapter,
} from './arweave-adapter.js';
