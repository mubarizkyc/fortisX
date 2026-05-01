// src/commands/cloakDeposit.ts
import {
    transact,
    createZeroUtxo,
    NATIVE_SOL_MINT,
    CLOAK_PROGRAM_ID, generateUtxoKeypair, createUtxo,
    serializeUtxo,
} from "@cloak.dev/sdk-devnet"; // Ensure correct import path

import {
    Connection,
    Keypair,

} from '@solana/web3.js'


export async function CloakDeposit(
    depoistAmount: bigint,
    signer: Keypair,
) {
    const connection = new Connection("https://api.devnet.solana.com", "confirmed");

    // 1. Generate a new UTXO keypair for the output note
    const utxoKeypair = await generateUtxoKeypair();

    // 2. Create the output UTXO structure
    const output = await createUtxo(depoistAmount, utxoKeypair, NATIVE_SOL_MINT);
    console.log("Output UTXO created:", output);

    // 3. Execute the private deposit transaction
    const depositResult = await transact({
        inputUtxos: [await createZeroUtxo(NATIVE_SOL_MINT)], // Zero-knowledge input
        outputUtxos: [output],
        externalAmount: depoistAmount,
        depositor: signer.publicKey,
    }, {
        connection,
        programId: CLOAK_PROGRAM_ID,
        depositorKeypair: signer,
        walletPublicKey: signer.publicKey,
        enforceViewingKeyRegistration: false,
    });

    // 4. Verify the note was created
    const myNote = depositResult.outputUtxos.find(u => u.amount > 0n);

    // Wait for indexing/leaf settlement
    console.log("Waiting for chain indexing...");
    await new Promise(r => setTimeout(r, 1_000));

    if (!myNote) throw new Error("Transfer failed to create note");

    console.log("✅ Deposit successful. Utxo Index:", myNote.index);
    // 2. Base58 Format (Best if this UTXO is used as an ID/Address)
    const bs58 = require('bs58'); // Ensure you have 'bs58' installed: npm install bs58
    const base58String = bs58.encode(serializeUtxo(myNote));
    console.log("Utxo (Base58):", base58String);
    ;
}