import {
    transact,
    createZeroUtxo,
    NATIVE_SOL_MINT,
    CLOAK_PROGRAM_ID, generateUtxoKeypair, createUtxo, swapWithChange,
    serializeUtxo,
    deserializeUtxo, getNkFromUtxoPrivateKey, deriveUtxoKeypairFromSpendKey, scanTransactions
} from "@cloak.dev/sdk-devnet"; // Ensure correct import path

import {
    Connection,
    Keypair,

} from '@solana/web3.js'
import * as fs from "fs";
import * as path from "path";
import bs58 from "bs58";

// src/commands/cloakDeposit.ts
export async function CloakDeposit(
    depositAmount: bigint, // Fixed typo from 'depoistAmount'
    signer: Keypair,
) {
    const connection = new Connection("https://api.devnet.solana.com", "confirmed");

    const skSpend = signer.secretKey.slice(0, 32);
    const utxoKeypair = await deriveUtxoKeypairFromSpendKey(skSpend);
    const viewingKeyNk = getNkFromUtxoPrivateKey(utxoKeypair.privateKey);

    // 2. Create the output UTXO structure
    const output = await createUtxo(depositAmount, utxoKeypair, NATIVE_SOL_MINT);
    console.log("Output UTXO created:", output);

    // 3. Execute the private deposit transaction
    const depositResult = await transact({
        inputUtxos: [await createZeroUtxo(NATIVE_SOL_MINT)], // Zero-knowledge input
        outputUtxos: [output],
        externalAmount: depositAmount,
        depositor: signer.publicKey,
    }, {
        connection,
        programId: CLOAK_PROGRAM_ID,
        depositorKeypair: signer,
        walletPublicKey: signer.publicKey,
        enforceViewingKeyRegistration: false,
        chainNoteViewingKeyNk: viewingKeyNk, // Helps SDK construct proofs
    });

    // 4. Verify the note was created
    const myNote = depositResult.outputUtxos.find(u => u.amount > 0n);

    // Wait for indexing/leaf settlement
    console.log("Waiting for chain indexing...");
    await new Promise(r => setTimeout(r, 1_000));

    if (!myNote) throw new Error("Transfer failed to create note");

    console.log("✅ Deposit successful. Utxo Index:", myNote.index);

    // Serialize to Base58
    const base58String = bs58.encode(serializeUtxo(myNote));
    console.log("Utxo (Base58):", base58String);

    // --- FILE WRITING LOGIC ---
    try {
        const logFileName = "my_utxo_logs.txt";
        const filePath = path.join(process.cwd(), logFileName);
        const dataToAppend = `${base58String}\n`;
        fs.appendFileSync(filePath, dataToAppend, { encoding: 'utf-8' });

        console.log(`📝 UTXO appended to ${filePath}`);
    } catch (err) {
        console.error("❌ Failed to write UTXO to file:", err);
    }
}