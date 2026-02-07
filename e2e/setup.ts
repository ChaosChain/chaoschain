/**
 * E2E Setup Script
 *
 * Deploys contracts on Anvil, creates a studio, registers agents,
 * and writes addresses.json for the gateway and tests to consume.
 *
 * Usage:
 *   npx tsx e2e/setup.ts
 *
 * Prerequisites:
 *   - Anvil running on localhost:8546 (via docker-compose.e2e.yml)
 *   - Contracts pre-compiled: cd packages/contracts && forge build --skip test --skip DeployFactoryCore
 */

import { ethers } from 'ethers';
import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── Load keys from .env.anvil ────────────────────────────────────────

function loadEnvFile(filePath: string): Record<string, string> {
  const content = readFileSync(filePath, 'utf-8');
  const env: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      env[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
    }
  }
  return env;
}

const envFile = loadEnvFile(resolve(__dirname, '.env.anvil'));

// Anvil exposed on host port 8546
const RPC_URL = process.env.RPC_URL || 'http://localhost:8546';

const DEPLOYER_KEY = envFile.SIGNER_PRIVATE_KEY;
const AGENT_KEYS = [
  envFile.SIGNER_PRIVATE_KEY_2,
  envFile.SIGNER_PRIVATE_KEY_3,
  envFile.SIGNER_PRIVATE_KEY_4,
  envFile.SIGNER_PRIVATE_KEY_5,
  envFile.SIGNER_PRIVATE_KEY_6,
];

// Roles: accounts 1-3 = WORKER (1), accounts 4-5 = VERIFIER (2)
const AGENT_ROLES = [1, 1, 1, 2, 2];

const CONTRACTS_DIR = resolve(__dirname, '../packages/contracts');
const ADDRESSES_FILE = resolve(__dirname, 'addresses.json');

// ─── Helpers ──────────────────────────────────────────────────────────

async function waitForAnvil(provider: ethers.JsonRpcProvider, maxWaitMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      await provider.getBlockNumber();
      console.log('  Anvil is ready');
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`Anvil not ready after ${maxWaitMs}ms`);
}

async function waitForGateway(url: string, maxWaitMs = 60_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) {
        console.log('  Gateway is ready');
        return;
      }
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Gateway not ready after ${maxWaitMs}ms`);
}

// ─── Deploy Contracts ─────────────────────────────────────────────────

interface DeployedAddresses {
  IDENTITY_REGISTRY: string;
  REGISTRY: string;
  REWARDS_DISTRIBUTOR: string;
  FACTORY: string;
  CHAOS_CORE: string;
  LOGIC_MODULE: string;
  STUDIO_PROXY: string;
}

function deployContracts(): Omit<DeployedAddresses, 'STUDIO_PROXY'> {
  console.log('==> Deploying contracts via forge script...');

  const output = execSync(
    [
      'forge script script/DeployE2ETestEnv.s.sol',
      '--tc DeployE2ETestEnv',
      `--rpc-url ${RPC_URL}`,
      `--private-key ${DEPLOYER_KEY}`,
      '--broadcast',
      '--skip test --skip DeployFactoryCore',
    ].join(' '),
    {
      cwd: CONTRACTS_DIR,
      encoding: 'utf-8',
      env: { ...process.env, FOUNDRY_DISABLE_NIGHTLY_WARNING: '1' },
      timeout: 120_000,
    },
  );

  // Parse KEY=0xAddress lines from forge output
  const addresses: Record<string, string> = {};
  for (const line of output.split('\n')) {
    const match = line.match(/^\s*([\w]+)=(0x[0-9a-fA-F]{40})\s*$/);
    if (match) {
      addresses[match[1]] = match[2];
    }
  }

  const required = ['IDENTITY_REGISTRY', 'REGISTRY', 'REWARDS_DISTRIBUTOR', 'FACTORY', 'CHAOS_CORE', 'LOGIC_MODULE'];
  for (const key of required) {
    if (!addresses[key]) {
      throw new Error(`Missing address for ${key} in forge output. Got: ${JSON.stringify(addresses)}`);
    }
  }

  for (const [key, addr] of Object.entries(addresses)) {
    console.log(`  ${key}=${addr}`);
  }

  return addresses as Omit<DeployedAddresses, 'STUDIO_PROXY'>;
}

// ─── Studio + Agents ──────────────────────────────────────────────────

async function createStudio(
  provider: ethers.JsonRpcProvider,
  chaosCoreAddress: string,
  logicModuleAddress: string,
): Promise<string> {
  console.log('==> Creating studio...');

  const deployer = new ethers.Wallet(DEPLOYER_KEY, provider);
  const chaosCore = new ethers.Contract(
    chaosCoreAddress,
    ['function createStudio(string name, address logicModule) external returns (address proxy, uint256 studioId)'],
    deployer,
  );

  const tx = await chaosCore.createStudio('E2EStudio', logicModuleAddress);
  const receipt = await tx.wait();

  // Parse StudioCreated event to get proxy address
  // Event: StudioCreated(address indexed proxy, address indexed logicModule, address indexed owner, string name, uint256 studioId)
  const studioCreatedTopic = ethers.id('StudioCreated(address,address,address,string,uint256)');
  const event = receipt.logs.find((log: ethers.Log) => log.topics[0] === studioCreatedTopic);

  if (!event) {
    // Fallback: use getStudio(1) since it's the first studio
    const coreRead = new ethers.Contract(
      chaosCoreAddress,
      ['function getStudio(uint256 studioId) external view returns (address,address,address,string,uint256,bool)'],
      provider,
    );
    const result = await coreRead.getStudio(1);
    const proxy = result[0];
    console.log(`  Studio proxy (via getStudio): ${proxy}`);
    return proxy;
  }

  // topic[1] is the indexed proxy address
  const proxy = ethers.getAddress('0x' + event.topics[1].slice(26));
  console.log(`  Studio proxy: ${proxy}`);
  return proxy;
}

async function registerAgents(
  provider: ethers.JsonRpcProvider,
  identityRegistryAddress: string,
  studioProxyAddress: string,
): Promise<void> {
  console.log('==> Registering agents...');

  const identityAbi = ['function register() external returns (uint256 agentId)'];
  const studioAbi = ['function registerAgent(uint256 agentId, uint8 role) external payable'];

  for (let i = 0; i < AGENT_KEYS.length; i++) {
    const wallet = new ethers.Wallet(AGENT_KEYS[i], provider);
    const role = AGENT_ROLES[i];
    const roleLabel = role === 1 ? 'WORKER' : 'VERIFIER';

    // 1. Register identity (get agentId)
    const identity = new ethers.Contract(identityRegistryAddress, identityAbi, wallet);
    const regTx = await identity.register();
    const regReceipt = await regTx.wait();

    // agentId from Transfer event: Transfer(address(0), msg.sender, agentId)
    const transferTopic = ethers.id('Transfer(address,address,uint256)');
    const transferEvent = regReceipt.logs.find((log: ethers.Log) => log.topics[0] === transferTopic);
    const agentId = transferEvent ? BigInt(transferEvent.topics[3]) : BigInt(i + 1);

    // 2. Register in studio with stake
    const studio = new ethers.Contract(studioProxyAddress, studioAbi, wallet);
    const stakeTx = await studio.registerAgent(agentId, role, { value: ethers.parseEther('1') });
    await stakeTx.wait();

    console.log(`  Account ${i + 1} (${wallet.address}): agentId=${agentId} role=${roleLabel}`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════╗');
  console.log('║     ChaosChain E2E Setup             ║');
  console.log('╚══════════════════════════════════════╝');
  console.log();

  const provider = new ethers.JsonRpcProvider(RPC_URL);

  // 1. Wait for Anvil
  console.log('==> Waiting for Anvil...');
  await waitForAnvil(provider);

  // 2. Deploy contracts
  const addresses = deployContracts();

  // 3. Create studio
  const studioProxy = await createStudio(provider, addresses.CHAOS_CORE, addresses.LOGIC_MODULE);

  // 4. Register agents
  await registerAgents(provider, addresses.IDENTITY_REGISTRY, studioProxy);

  // 5. Write addresses.json
  const allAddresses: DeployedAddresses = { ...addresses, STUDIO_PROXY: studioProxy };
  writeFileSync(ADDRESSES_FILE, JSON.stringify(allAddresses, null, 2) + '\n');
  console.log(`\n==> Wrote ${ADDRESSES_FILE}`);

  // 6. Wait for gateway (it reads addresses.json on startup)
  const gatewayUrl = process.env.GATEWAY_URL || 'http://localhost:3333';
  console.log(`\n==> Waiting for gateway at ${gatewayUrl}...`);
  await waitForGateway(gatewayUrl);

  console.log('\n==> E2E setup complete!');
}

main().catch((err) => {
  console.error('E2E setup failed:', err);
  process.exit(1);
});
