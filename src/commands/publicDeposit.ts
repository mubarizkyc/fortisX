import { PublicKey, TransactionInstruction, SystemProgram, Keypair, Transaction } from '@solana/web3.js';
import chalk from 'chalk';
// Ensure you export LiteSVM correctly based on your installed version
import { LiteSVM, FailedTransactionMetadata } from "litesvm";
import {
    appendTransactionMessageInstruction,
    createTransactionMessage,
    generateKeyPairSigner,
    lamports,
    pipe,
    setTransactionMessageFeePayerSigner,
    setTransactionMessageLifetimeUsingBlockhash,
    signTransactionMessageWithSigners,
    createKeyPairSignerFromBytes, TransactionSigner
} from "@solana/kit";

import { fromLegacyPublicKey, fromLegacyTransactionInstruction, fromVersionedTransaction } from "@solana/compat";
// Define your Program ID
const PROGRAM_ID = new PublicKey('CD6Pnc1gpUQ1XT1bzXEPs2QnqFMcQUHsiRKAV9iYXh36');

export async function publicDeposit(
    depositor: TransactionSigner, // Use Legacy Keypair for simplicity with LiteSVM
    amountLamports: bigint,
    assetAddress: PublicKey,
    multisigAddress: PublicKey // The base address of the multisig config
) {
    // 1. Initialize SVM
    const svm = new LiteSVM();

    // 2. Derive the Vault PDA
    // Ensure these seeds match your Rust program exactly
    const [vaultPda] = PublicKey.findProgramAddressSync(
        [
            Buffer.from('multisig'),
            multisigAddress.toBytes(),
            Buffer.from('vault')
        ],
        PROGRAM_ID
    );
    console.log(chalk.blue('Vault PDA:'), vaultPda.toBase58());

    // 3. Airdrop funds to depositor so they can pay fees/send SOL
    // LiteSVM starts with empty balances
    await svm.airdrop(depositor.address, 2_000_000_000n); // 2 SOL

    // 4. Create the Instruction
    // Note: If your program handles the deposit internally, use a custom IX.
    // If it's just a raw SOL transfer to the PDA, use SystemProgram.
    const ix = SystemProgram.transfer({
        fromPubkey: new PublicKey(depositor.address),
        toPubkey: vaultPda,
        lamports: Number(amountLamports),
    });
    const transaction = await pipe(
        createTransactionMessage({ version: 0 }),
        (tx) => setTransactionMessageFeePayerSigner(depositor, tx),
        (tx) => svm.setTransactionMessageLifetimeUsingLatestBlockhash(tx),
        (tx) => appendTransactionMessageInstruction(fromLegacyTransactionInstruction(ix), tx),
        (tx) => signTransactionMessageWithSigners(tx),
    )
    console.log("hi");
    const result = svm.sendTransaction(transaction)

    if (result instanceof FailedTransactionMetadata) {
        console.error(chalk.red('❌ Transaction Failed!'))
        console.error('Error:', result.err())
        try {
            const meta = result.meta()
            console.error('Logs:', meta?.logMessages)
        } catch (e) {
            console.error('No execution metadata available.')
        }
    } else {
        console.log(chalk.green('✅ Success!'))
        console.log('Logs:', result.logs())
    }
}