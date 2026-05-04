import { Connection, Keypair } from '@solana/web3.js';
import path from 'path';
import fs from 'fs';
import chalk from 'chalk';
import {
    CLOAK_PROGRAM_ID,
    NATIVE_SOL_MINT,
    transact,
    createUtxo,
    createZeroUtxo,
    generateUtxoKeypair,
    Utxo,
    deserializeUtxo, getNkFromUtxoPrivateKey
} from '@cloak.dev/sdk-devnet';
import bs58 from 'bs58';
export interface StoredUtxoRecord {
    id: string;
    timestamp: number;
    amount: string;          // BigInt as string
    keypair: {
        privateKey: string;  // BigInt as string
        publicKey: string;   // BigInt as string
    };
    blinding: string;        // BigInt as string
    mintAddress: string;     // Base58 string
    index?: number;
    commitment: string;      // BigInt as string
    siblingcommitments: string;
    spent: boolean;
}

export async function PrivateDeposit(
    depositAmount: bigint,
    signer: Keypair,
    treasuryId: bigint,
    depositorUtxo: string // Base58 string of input UTXO
) {
    const connection = new Connection("https://api.devnet.solana.com", "confirmed");

    console.log(chalk.yellow('⏳ Processing private transfer to Treasury...'));


    const treasuryOutput = await createUtxo(depositAmount, {
        privateKey: 0n,
        publicKey: treasuryId,
    }, NATIVE_SOL_MINT);

    // 2. Build Change Output
    const changeOutput = await createZeroUtxo(NATIVE_SOL_MINT);

    // 3. Deserialize Input UTXO
    const inputUtxoBytes = bs58.decode(depositorUtxo); // Or use bs58.decode
    const inputUtxo = await deserializeUtxo(inputUtxoBytes);

    // 4. Execute Transaction
    console.log("Sending transaction...");
    const transferResult = await transact(
        {
            inputUtxos: [inputUtxo],
            outputUtxos: [treasuryOutput, changeOutput],
        },
        {
            connection,
            programId: CLOAK_PROGRAM_ID,
            depositorKeypair: signer,
            walletPublicKey: signer.publicKey,
            useUniqueNullifiers: true,
            enforceViewingKeyRegistration: false,

            chainNoteViewingKeyNk: getNkFromUtxoPrivateKey(inputUtxo.keypair.privateKey)

        }
    );

    // 5. Wait for indexing
    console.log("Waiting for chain indexing...");
    await new Promise(r => setTimeout(r, 1500));

    if (!transferResult.outputUtxos || transferResult.outputUtxos.length === 0) {
        throw new Error("Transaction sent but no output UTXOs returned.");
    }

    const newTreasuryUtxo = transferResult.outputUtxos[0];
    console.log("utxo: ", newTreasuryUtxo);
    console.log(chalk.green("✅ Deposit successful. Utxo Index:"), newTreasuryUtxo.index);

    // --- 📝 SAVE RAW FIELDS TO JSON FILE ---
    const jsonFileName = "treasury_utxos.json";
    const filePath = path.join(process.cwd(), jsonFileName);

    try {
        // 1. Read existing records
        let records: StoredUtxoRecord[] = [];
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf-8');
            if (content.trim()) {
                records = JSON.parse(content);
            }
        }

        // 2. Create new record with RAW fields
        const newRecord: StoredUtxoRecord = {
            id: `utxo_${Date.now()}_${newTreasuryUtxo.index}`,
            timestamp: Date.now(),
            amount: newTreasuryUtxo.amount.toString(),
            keypair: {
                privateKey: newTreasuryUtxo.keypair.privateKey.toString(),
                publicKey: newTreasuryUtxo.keypair.publicKey.toString(),
            },
            blinding: newTreasuryUtxo.blinding.toString(),
            mintAddress: newTreasuryUtxo.mintAddress.toBase58(),
            index: newTreasuryUtxo.index,
            commitment: newTreasuryUtxo.commitment?.toString() || "",
            siblingcommitments: newTreasuryUtxo.siblingCommitment?.toString() || "",
            spent: false
        };

        // 3. Append and Write
        records.push(newRecord);
        fs.writeFileSync(filePath, JSON.stringify(records, null, 2), 'utf-8');

        console.log(chalk.blue(`💾 Raw UTXO fields saved to ${filePath}`));
        console.log(chalk.dim(`   Commitment: ${newRecord.commitment}`));

    } catch (err) {
        console.error("❌ Failed to write UTXO to JSON file:", err);
        throw err;
    }

    console.log(chalk.green("\n✅ Private Transfer Completed!"));
}