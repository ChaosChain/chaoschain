/**
 * Fund 0G Compute Account
 * Run this ONCE before using compute services
 */

import { ethers } from 'ethers';
import { createRequire } from 'module';
import dotenv from 'dotenv';

dotenv.config();

const require = createRequire(import.meta.url);
const { createZGComputeNetworkBroker } = require('@0glabs/0g-serving-broker');

const ZEROG_PRIVATE_KEY = process.env.ZEROG_PRIVATE_KEY;
const ZEROG_EVM_RPC = process.env.ZEROG_EVM_RPC || 'https://evmrpc-testnet.0g.ai';

if (!ZEROG_PRIVATE_KEY) {
  console.error('❌ ERROR: ZEROG_PRIVATE_KEY environment variable required');
  process.exit(1);
}

async function fundAccount() {
  try {
    console.log('🔄 Initializing broker...');
    const provider = new ethers.JsonRpcProvider(ZEROG_EVM_RPC);
    const wallet = new ethers.Wallet(ZEROG_PRIVATE_KEY, provider);
    const broker = await createZGComputeNetworkBroker(wallet);
    
    console.log(`   Wallet: ${wallet.address}`);
    
    // Check current balance
    console.log('\n📊 Checking current balance...');
    try {
      const account = await broker.ledger.getLedger();
      const balance = ethers.formatEther(account.totalBalance);
      console.log(`   Current Balance: ${balance} A0GI`);
      
      if (parseFloat(balance) >= 1) {
        console.log('\n✅ Account already has sufficient balance!');
        console.log('   You can now use compute services.');
        return;
      }
    } catch (e) {
      console.log('   Could not check balance (might be new account)');
    }
    
    // Add funds
    const amountToAdd = 10; // 10 A0GI tokens
    console.log(`\n💰 Adding ${amountToAdd} A0GI to compute account...`);
    console.log('   (This will take ~30 seconds)');
    
    await broker.ledger.addLedger(amountToAdd);
    
    console.log('✅ Funds added successfully!');
    
    // Verify new balance
    const newAccount = await broker.ledger.getLedger();
    const newBalance = ethers.formatEther(newAccount.totalBalance);
    console.log(`\n💎 New Balance: ${newBalance} A0GI`);
    
    console.log('\n🎉 Account funded! You can now:');
    console.log('   1. Submit compute jobs');
    console.log('   2. Run inference requests');
    console.log('   3. Get TEE-verified results');
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    
    if (error.message.includes('insufficient funds') || error.message.includes('balance')) {
      console.error('\n💡 Your wallet needs A0GI tokens first!');
      console.error('   Get testnet tokens from: https://faucet.0g.ai/');
      console.error(`   Your wallet address: ${wallet ? wallet.address : 'unknown'}`);
    }
    
    process.exit(1);
  }
}

fundAccount();

