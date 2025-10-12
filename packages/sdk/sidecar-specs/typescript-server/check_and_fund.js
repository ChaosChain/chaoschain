/**
 * Check Balance and Fund Compute Account
 */

import { ethers } from 'ethers';
import { createRequire } from 'module';
import dotenv from 'dotenv';

dotenv.config();

const require = createRequire(import.meta.url);
const { createZGComputeNetworkBroker } = require('@0glabs/0g-serving-broker');

const ZEROG_PRIVATE_KEY = process.env.ZEROG_PRIVATE_KEY;
const ZEROG_EVM_RPC = process.env.ZEROG_EVM_RPC || 'https://evmrpc-testnet.0g.ai';

async function checkAndFund() {
  try {
    console.log('🔄 Connecting to 0G Network...\n');
    const provider = new ethers.JsonRpcProvider(ZEROG_EVM_RPC);
    const wallet = new ethers.Wallet(ZEROG_PRIVATE_KEY, provider);
    const broker = await createZGComputeNetworkBroker(wallet);
    
    console.log(`📍 Wallet Address: ${wallet.address}\n`);
    
    // Check wallet balance (A0GI tokens on testnet)
    console.log('💰 Checking wallet balance...');
    const walletBalance = await provider.getBalance(wallet.address);
    const walletBalanceFormatted = ethers.formatEther(walletBalance);
    console.log(`   Wallet Balance: ${walletBalanceFormatted} A0GI`);
    
    if (parseFloat(walletBalanceFormatted) < 0.1) {
      console.log('\n⚠️  WARNING: Low wallet balance!');
      console.log('   Get more tokens from: https://faucet.0g.ai/');
      console.log(`   Your address: ${wallet.address}\n`);
    }
    
    // Check compute ledger balance
    console.log('\n📊 Checking compute ledger balance...');
    try {
      const account = await broker.ledger.getLedger();
      const ledgerBalance = ethers.formatEther(account.totalBalance);
      console.log(`   Compute Ledger Balance: ${ledgerBalance} A0GI`);
      
      if (parseFloat(ledgerBalance) >= 1) {
        console.log('\n✅ You have sufficient compute balance!');
        console.log('   You can now run inference requests.');
        console.log('\n🚀 Ready to test Genesis Studio!');
        return true;
      } else {
        console.log(`\n⚠️  Compute ledger needs at least 1 A0GI (currently: ${ledgerBalance})`);
      }
    } catch (e) {
      console.log('   No compute ledger found (new account)');
    }
    
    // Calculate how much to transfer
    const walletBalanceNum = parseFloat(walletBalanceFormatted);
    if (walletBalanceNum >= 1) {
      // Transfer 1 A0GI to compute ledger
      const amountToAdd = 1;
      console.log(`\n💸 Transferring ${amountToAdd} A0GI to compute ledger...`);
      console.log('   (This will take ~30 seconds)\n');
      
      await broker.ledger.addLedger(amountToAdd);
      
      console.log('✅ Transfer successful!');
      
      // Check new balance
      const newAccount = await broker.ledger.getLedger();
      const newBalance = ethers.formatEther(newAccount.totalBalance);
      console.log(`\n💎 Compute Ledger Balance: ${newBalance} A0GI`);
      
      const remainingWallet = await provider.getBalance(wallet.address);
      console.log(`💰 Remaining Wallet Balance: ${ethers.formatEther(remainingWallet)} A0GI\n`);
      
      console.log('🎉 Account funded successfully!');
      console.log('\n🚀 You can now:');
      console.log('   1. Run inference requests');
      console.log('   2. Test Genesis Studio');
      console.log('   3. Get TEE-verified AI results\n');
      
      return true;
    } else {
      console.log(`\n❌ Insufficient wallet balance: ${walletBalanceFormatted} A0GI`);
      console.log('   You need at least 1 A0GI in your wallet to fund compute.');
      console.log('\n💡 Get more tokens:');
      console.log(`   1. Visit: https://faucet.0g.ai/`);
      console.log(`   2. Enter your address: ${wallet.address}`);
      console.log(`   3. Request tokens`);
      console.log(`   4. Run this script again\n`);
      return false;
    }
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    return false;
  }
}

checkAndFund().then(success => {
  process.exit(success ? 0 : 1);
});

