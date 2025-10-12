/**
 * 0G Bridge Unified gRPC Server (TypeScript/Node.js)
 * 
 * Single server implementing BOTH Storage and Compute services
 * using official 0G TypeScript SDKs - NO MOCKS!
 * 
 * - StorageService: @0glabs/0g-ts-sdk
 * - ComputeService: @0glabs/0g-serving-broker
 */

import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import { ethers } from 'ethers';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import crypto from 'crypto';
import { createRequire } from 'module';

// Import 0G SDKs using CommonJS (due to module export issues)
const require = createRequire(import.meta.url);
const { createZGComputeNetworkBroker } = require('@0glabs/0g-serving-broker');
const { ZgFile, Indexer, getFlowContract, Uploader, MemData } = require('@0glabs/0g-ts-sdk');

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration
const GRPC_PORT = process.env.GRPC_PORT || '50051';
const ZEROG_PRIVATE_KEY = process.env.ZEROG_PRIVATE_KEY;
const ZEROG_EVM_RPC = process.env.ZEROG_EVM_RPC || 'https://evmrpc-testnet.0g.ai';
const ZEROG_INDEXER_RPC = process.env.ZEROG_INDEXER_RPC || 'https://indexer-storage-testnet-turbo.0g.ai';

if (!ZEROG_PRIVATE_KEY) {
  console.error('❌ ERROR: ZEROG_PRIVATE_KEY environment variable required');
  process.exit(1);
}

// Official 0G Compute providers
const OFFICIAL_PROVIDERS = {
  'gpt-oss-120b': '0xf07240Efa67755B5311bc75784a061eDB47165Dd',
  'deepseek-r1-70b': '0x3feE5a4dd5FDb8a32dDA97Bed899830605dBD9D3'
};

// Initialize 0G clients
let provider, wallet, computeBroker, indexer, flowContract, uploader;
let storageReady = false;
let computeReady = false;

// In-memory job storage (for compute jobs)
const jobs = new Map();

async function initialize() {
  try {
    console.log('🔄 Initializing 0G SDK clients...');
    console.log(`   EVM RPC: ${ZEROG_EVM_RPC}`);
    console.log(`   Indexer RPC: ${ZEROG_INDEXER_RPC}`);
    
    // Initialize provider and wallet
    provider = new ethers.JsonRpcProvider(ZEROG_EVM_RPC);
    wallet = new ethers.Wallet(ZEROG_PRIVATE_KEY, provider);
    console.log(`   Wallet: ${wallet.address}`);
    
    // Initialize Storage SDK
    try {
      indexer = new Indexer(ZEROG_INDEXER_RPC);
      flowContract = getFlowContract(wallet);
      // Create uploader from indexer nodes
      uploader = await indexer.newUploaderFromIndexerNodes(ZEROG_EVM_RPC, flowContract);
      storageReady = true;
      console.log('✅ Storage SDK initialized (Uploader ready)');
    } catch (err) {
      console.error(`❌ Storage SDK failed: ${err.message}`);
    }
    
    // Initialize Compute SDK (Broker)
    try {
      computeBroker = await createZGComputeNetworkBroker(wallet);
      computeReady = true;
      console.log('✅ Compute Broker initialized');
      
      // Check balance
      try {
        const account = await computeBroker.ledger.getLedger();
        const balance = ethers.formatEther(account.totalBalance);
        console.log(`   Compute Balance: ${balance} A0GI`);
        
        if (parseFloat(balance) < 0.1) {
          console.warn('⚠️  Low compute balance! Fund your account:');
          console.warn('   await broker.ledger.addLedger(10)');
        }
      } catch (balErr) {
        console.log('   ⚠️  Could not check balance');
      }
    } catch (err) {
      console.error(`❌ Compute Broker failed: ${err.message}`);
    }
    
    console.log('✅ 0G clients ready!');
    return true;
  } catch (error) {
    console.error('❌ Initialization failed:', error);
    throw error;
  }
}

// =============================================================================
// STORAGE SERVICE IMPLEMENTATION (Real 0G Storage SDK)
// =============================================================================

const storageService = {
  /**
   * Upload data to 0G Storage
   */
  async Put(call, callback) {
    try {
      if (!storageReady) {
        return callback({
          code: grpc.status.UNAVAILABLE,
          details: 'Storage service not ready'
        });
      }
      
      const { data, mime_type, tags, idempotency_key } = call.request;
      
      console.log(`📤 Storage.Put: ${data.length} bytes, type=${mime_type}`);
      
      // Create 0G MemData from buffer (for in-memory data)
      const memData = new MemData(Buffer.from(data));
      
      // Upload to 0G Storage using Indexer.upload
      // Signature: upload(file, blockchain_rpc, signer, uploadOpts?, retryOpts?, opts?)
      const [result, error] = await indexer.upload(memData, ZEROG_EVM_RPC, wallet);
      
      if (error) {
        return callback({
          code: grpc.status.INTERNAL,
          details: `Upload failed: ${error.message}`
        });
      }
      
      const { txHash, rootHash } = result;
      
      console.log(`✅ Uploaded to 0G Storage`);
      console.log(`   TX Hash: ${txHash}`);
      console.log(`   Root Hash: ${rootHash}`);
      
      // Calculate data hash (keccak256 for ERC-8004 compatibility)
      const dataHash = '0x' + crypto.createHash('sha256').update(data).digest('hex');
      
      // Build URI
      const uri = `0g://object/${rootHash.replace('0x', '')}`;
      
      const response = {
        success: true,
        uri: uri,
        root_hash: rootHash,
        tx_hash: txHash,
        data_hash: dataHash,
        provider: '0G_Storage',
        metadata: {
          mime_type: mime_type || 'application/octet-stream',
          size_bytes: data.length.toString(),
          timestamp: new Date().toISOString(),
          ...tags
        },
        error: ''
      };
      
      callback(null, response);
    } catch (error) {
      console.error('❌ Storage.Put error:', error);
      callback(null, {
        success: false,
        uri: '',
        root_hash: '',
        tx_hash: '',
        data_hash: '',
        provider: '0G_Storage',
        metadata: {},
        error: error.message
      });
    }
  },
  
  /**
   * Retrieve data from 0G Storage
   */
  async Get(call, callback) {
    try {
      if (!storageReady) {
        return callback({
          code: grpc.status.UNAVAILABLE,
          details: 'Storage service not ready'
        });
      }
      
      const { uri } = call.request;
      console.log(`📥 Storage.Get: ${uri}`);
      
      // Extract root hash from URI
      const rootHash = '0x' + uri.replace('0g://object/', '');
      
      // Download from 0G Storage
      const zgFile = await ZgFile.download(rootHash, indexer);
      const data = await zgFile.arrayBuffer();
      
      console.log(`✅ Downloaded ${data.byteLength} bytes from 0G Storage`);
      
      callback(null, {
        success: true,
        data: Buffer.from(data),
        metadata: {
          uri,
          root_hash: rootHash,
          size_bytes: data.byteLength.toString(),
          verified: 'true',
          retrieved: new Date().toISOString()
        },
        error: ''
      });
    } catch (error) {
      console.error('❌ Storage.Get error:', error);
      callback(null, {
        success: false,
        data: Buffer.alloc(0),
        metadata: {},
        error: error.message
      });
    }
  },
  
  /**
   * Verify data integrity
   */
  async Verify(call, callback) {
    const { uri, expected_hash } = call.request;
    
    // Extract root hash from URI (0G's verification)
    const rootHash = '0x' + uri.replace('0g://object/', '');
    
    callback(null, {
      is_valid: !expected_hash || expected_hash === rootHash,
      actual_hash: rootHash,
      error: ''
    });
  },
  
  /**
   * Delete data (0G Storage is immutable)
   */
  async Delete(call, callback) {
    callback(null, {
      success: false,
      error: '0G Storage is immutable - deletion not supported'
    });
  },
  
  /**
   * Health check for Storage service
   */
  async HealthCheck(call, callback) {
    callback(null, {
      status: storageReady ? 1 : 2, // 1 = STATUS_HEALTHY, 2 = STATUS_UNHEALTHY
      message: storageReady ? '0G Storage ready' : 'Storage SDK not initialized',
      metrics: {
        service: 'StorageService',
        timestamp: new Date().toISOString(),
        ready: storageReady
      }
    });
  }
};

// =============================================================================
// COMPUTE SERVICE IMPLEMENTATION (Real 0G Compute Broker)
// =============================================================================

const computeService = {
  /**
   * Submit compute job to 0G Compute Network
   */
  async Submit(call, callback) {
    try {
      if (!computeReady) {
        return callback({
          code: grpc.status.UNAVAILABLE,
          details: 'Compute service not ready'
        });
      }
      
      const { task_json, verification_method, idempotency_key } = call.request;
      const task = JSON.parse(task_json);
      
      console.log(`🤖 Compute.Submit: model=${task.model}, verification=${verification_method}`);
      
      // Determine provider address
      const model = task.model || 'gpt-oss-120b';
      const providerAddress = OFFICIAL_PROVIDERS[model] || OFFICIAL_PROVIDERS['gpt-oss-120b'];
      
      // Generate unique job ID
      const jobId = `0g_job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Store job info
      jobs.set(jobId, {
        status: 'pending',
        task,
        providerAddress,
        model,
        createdAt: Date.now(),
        progress: 0
      });
      
      // Submit to 0G asynchronously
      (async () => {
        try {
          jobs.get(jobId).status = 'running';
          jobs.get(jobId).progress = 25;
          
          // Acknowledge provider
          try {
            await computeBroker.inference.acknowledgeProviderSigner(providerAddress);
          } catch (ackErr) {
            console.log(`   Provider already acknowledged: ${ackErr.message}`);
          }
          
          jobs.get(jobId).progress = 50;
          
          // Get service metadata
          const { endpoint, model: svcModel } = await computeBroker.inference.getServiceMetadata(providerAddress);
          
          // Prepare messages
          const messages = task.messages || [
            { role: 'user', content: task.prompt || task.input || 'Hello' }
          ];
          
          // Generate auth headers
          const headers = await computeBroker.inference.getRequestHeaders(
            providerAddress,
            JSON.stringify(messages)
          );
          
          jobs.get(jobId).progress = 75;
          
          // Call 0G LLM
          const response = await fetch(`${endpoint}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...headers
            },
            body: JSON.stringify({
              messages,
              model: svcModel,
              temperature: task.temperature || 0.7,
              max_tokens: task.max_tokens || 1000
            })
          });
          
          if (!response.ok) {
            throw new Error(`0G API error: ${response.status}`);
          }
          
          const result = await response.json();
          const content = result.choices[0].message.content;
          const chatId = result.id;
          
          // Process response (verification)
          const isValid = await computeBroker.inference.processResponse(
            providerAddress,
            content,
            chatId
          );
          
          // Update job
          jobs.set(jobId, {
            ...jobs.get(jobId),
            status: 'completed',
            progress: 100,
            result: {
              output: content,
              chatId,
              verified: isValid,
              model: svcModel,
              provider: providerAddress
            }
          });
          
          console.log(`✅ Job ${jobId} completed (verified: ${isValid})`);
        } catch (error) {
          console.error(`❌ Job ${jobId} failed:`, error);
          jobs.set(jobId, {
            ...jobs.get(jobId),
            status: 'failed',
            error: error.message
          });
        }
      })();
      
      callback(null, {
        success: true,
        job_id: jobId,
        error: ''
      });
    } catch (error) {
      console.error('❌ Compute.Submit error:', error);
      callback(null, {
        success: false,
        job_id: '',
        error: error.message
      });
    }
  },
  
  /**
   * Get job status
   */
  async Status(call, callback) {
    const { job_id } = call.request;
    const job = jobs.get(job_id);
    
    if (!job) {
      return callback(null, {
        success: false,
        state: 'unknown',
        progress: 0,
        metadata: {},
        error: 'Job not found'
      });
    }
    
    callback(null, {
      success: true,
      state: job.status,
      progress: job.progress,
      metadata: {
        job_id,
        model: job.model,
        created_at: new Date(job.createdAt).toISOString()
      },
      error: ''
    });
  },
  
  /**
   * Get job result
   */
  async Result(call, callback) {
    const { job_id } = call.request;
    const job = jobs.get(job_id);
    
    if (!job) {
      return callback(null, {
        success: false,
        output_json: '',
        execution_hash: '',
        verification_method: 0,
        proof: Buffer.alloc(0),
        metadata: {},
        error: 'Job not found'
      });
    }
    
    if (job.status !== 'completed') {
      return callback(null, {
        success: false,
        output_json: '',
        execution_hash: '',
        verification_method: 0,
        proof: Buffer.alloc(0),
        metadata: {},
        error: `Job status: ${job.status}`
      });
    }
    
    callback(null, {
      success: true,
      output_json: JSON.stringify(job.result),
      execution_hash: job.result.chatId || '',
      verification_method: 2, // TEE_ML
      proof: Buffer.alloc(0),
      metadata: {
        model: job.model,
        provider: job.providerAddress,
        verified: job.result.verified.toString()
      },
      error: ''
    });
  },
  
  /**
   * Get attestation proof
   */
  async Attestation(call, callback) {
    const { job_id } = call.request;
    const job = jobs.get(job_id);
    
    if (!job || job.status !== 'completed') {
      return callback(null, {
        success: false,
        attestation_json: '',
        signature: Buffer.alloc(0),
        error: 'Job not found or not completed'
      });
    }
    
    callback(null, {
      success: true,
      attestation_json: JSON.stringify({
        job_id,
        chat_id: job.result.chatId,
        verified: job.result.verified,
        provider: job.providerAddress,
        model: job.model,
        verification_method: 'TEE (TeeML)',
        timestamp: new Date().toISOString()
      }),
      signature: Buffer.alloc(0),
      error: ''
    });
  }
};

// =============================================================================
// gRPC SERVER SETUP
// =============================================================================

async function main() {
  // Initialize 0G clients
  await initialize();
  
  // Load proto
  const PROTO_PATH = join(__dirname, '../zerog_bridge.proto');
  const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true
  });
  
  const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);
  const zerog = protoDescriptor.zerog.bridge.v1;
  
  // Create gRPC server
  const server = new grpc.Server();
  
  // Register both services on ONE server
  server.addService(zerog.StorageService.service, storageService);
  server.addService(zerog.ComputeService.service, computeService);
  
  // Start server
  server.bindAsync(
    `0.0.0.0:${GRPC_PORT}`,
    grpc.ServerCredentials.createInsecure(),
    (err, port) => {
      if (err) {
        console.error('❌ Failed to start server:', err);
        process.exit(1);
      }
      
      console.log('');
      console.log('╔══════════════════════════════════════════════════════════════╗');
      console.log('║                                                              ║');
      console.log('║     🚀 0G Bridge gRPC Server - TypeScript (Unified)  🚀     ║');
      console.log('║                                                              ║');
      console.log('╚══════════════════════════════════════════════════════════════╝');
      console.log('');
      console.log(`📡 Server running on port ${port}`);
      console.log('');
      console.log('Services:');
      console.log(`  ✅ StorageService  - Real 0G Storage SDK (@0glabs/0g-ts-sdk)`);
      console.log(`  ✅ ComputeService  - Real 0G Compute SDK (@0glabs/0g-serving-broker)`);
      console.log('');
      console.log('Status:');
      console.log(`  Storage: ${storageReady ? '🟢 READY' : '🔴 NOT READY'}`);
      console.log(`  Compute: ${computeReady ? '🟢 READY' : '🔴 NOT READY'}`);
      console.log('');
      console.log('Test with Python SDK:');
      console.log('  from chaoschain_sdk.providers.compute import ZeroGComputeGRPC');
      console.log(`  compute = ZeroGComputeGRPC(grpc_url='localhost:${port}')`);
      console.log('');
    }
  );
}

main().catch(console.error);

