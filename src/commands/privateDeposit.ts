// src/commands/privateDeposit.ts
import {
    transact,
    createZeroUtxo,
    NATIVE_SOL_MINT,
    CLOAK_PROGRAM_ID,
    createUtxo,
    serializeUtxo,
    deserializeUtxo
} from "@cloak.dev/sdk-devnet";

import { Connection, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

export async function PrivateDeposit(
    depositAmount: bigint,
    signer: Keypair,
    treasuryId: bigint, // ✅ Changed from PublicKey to bigint
    depositorUtxo: string
) {
    const connection = new Connection("https://api.devnet.solana.com", "confirmed");

    // 1. Build the Output UTXO using the BigInt ID directly
    const treasuryOutput = await createUtxo(depositAmount, {
        privateKey: 0n,
        publicKey: treasuryId, // ✅ Use the bigint directly
    }, NATIVE_SOL_MINT);

    // 2. Build Change Output
    const changeOutput = await createZeroUtxo(NATIVE_SOL_MINT);

    // 3. Deserialize your input UTXO
    const inputUtxoBytes = bs58.decode(depositorUtxo);
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
        }
    );

    // 5. Wait for indexing
    console.log("Waiting for chain indexing...");
    await new Promise(r => setTimeout(r, 10000));

    if (transferResult.outputUtxos.length > 0) {
        console.log("✅ Done. Note index:", transferResult.outputUtxos[0].index);
        console.log("New Treasury Utxo (Base58):", bs58.encode(serializeUtxo(transferResult.outputUtxos[0])));
    } else {
        console.warn("⚠️ Transaction sent but no output UTXOs found.");
    }
}