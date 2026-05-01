import { PublicKey, TransactionInstruction, SystemProgram, Keypair, Transaction, Connection, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import chalk from 'chalk';
import { PROGRAM_ID } from '../utils';
export async function publicDeposit(
    depositor: Keypair, // Use Legacy Keypair for simplicity with LiteSVM
    amountLamports: bigint,
    assetAddress: PublicKey,
    multisigAddress: PublicKey // The base address of the multisig config
) {
    const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

    const [vaultPda] = PublicKey.findProgramAddressSync(
        [
            Buffer.from('multisig'),
            multisigAddress.toBytes(),
            Buffer.from('vault')
        ],
        PROGRAM_ID
    );
    console.log(chalk.blue('Vault PDA:'), vaultPda.toBase58());
    const ix = SystemProgram.transfer({
        fromPubkey: new PublicKey(depositor.publicKey),
        toPubkey: vaultPda,
        lamports: Number(amountLamports),
    });
    const { blockhash } = await connection.getLatestBlockhash();

    const msg = new TransactionMessage({
        payerKey: depositor.publicKey,
        recentBlockhash: blockhash,
        instructions: [ix],
    }).compileToV0Message();

    const tx = new VersionedTransaction(msg);
    tx.sign([depositor]);
    try {
        console.log(chalk.yellow('Sending  transaction...'));
        const signature = await connection.sendTransaction(tx, {
            skipPreflight: false,
        });

        console.log(chalk.blue('Signature:'), signature);

        // Wait for confirmation
        const confirmation = await connection.confirmTransaction(signature, 'confirmed');
        if (confirmation.value.err) {
            throw new Error(`Transaction failed: ${confirmation.value.err}`);
        }

        console.log(chalk.green('✅ Deposit Approved & Confirmed!'));


    } catch (error: any) {
        console.error(chalk.red('❌ Deposit Failed:'), error.message);

        // Try to get logs if available
        if (error.logs) {
            console.error('📜 Program Logs:');
            error.logs.forEach((log: string) => console.error('  ', log));
        }

        throw error;
    }
}