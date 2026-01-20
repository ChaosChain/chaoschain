/**
 * Gateway Adapters
 * 
 * Adapter implementations for external services:
 * - Chain (ethers.js)
 * - Arweave (Irys)
 */

export {
  EthersChainAdapter,
  StudioProxyEncoder,
  createChainAdapter,
  createChainAdapterWithSigner,
} from './chain-adapter.js';

export {
  IrysArweaveAdapter,
  MockArweaveAdapter,
} from './arweave-adapter.js';
