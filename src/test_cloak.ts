import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { readFileSync } from "fs";
import {
    transact,
    transfer,
    fullWithdraw,
    createZeroUtxo,
    NATIVE_SOL_MINT,
    CLOAK_PROGRAM_ID, generateUtxoKeypair, createUtxo, swapWithChange,
    deriveUtxoKeypairFromSpendKey,
    bigintToBytes32,
    Utxo,
    derivePublicKey, DEVNET_MOCK_USDC_MINT
} from "@cloak.dev/sdk-devnet"; // Ensure correct import path
import { getAssociatedTokenAddressSync, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import { deriveViewingKeyFromUtxoPrivateKey } from "@cloak.dev/sdk-devnet";
import { sign } from "crypto";
function uint8ArrayToBigInt(bytes: Uint8Array): bigint {
    // Create a DataView to read the buffer
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    let result = 0n;
    const length = bytes.length;

    // Iterate through each byte and shift it into place
    // This handles arrays of ANY length (not just 8 or 16 bytes)
    for (let i = 0; i < length; i++) {
        result = (result << 8n) + BigInt(view.getUint8(i));
    }

    return result;
}
async function main() {
    // 1. Parse Arguments
    const amountLamports = BigInt(process.argv[2]); // ✅ Fixed: use index 2
    if (!amountLamports) {
        throw new Error("Usage: npx tsx send-sol-private.ts <lamports>");
    }

    const rpcUrl = "https://api.devnet.solana.com"; // Or use process.env.SOLANA_RPC_URL
    const keypairPath = "/home/mubariz/.config/solana/id.json"; // Or use process.env.KEYPAIR_PATH
    if (!rpcUrl || !keypairPath) {
        throw new Error("Set SOLANA_RPC_URL and KEYPAIR_PATH");
    }

    const connection = new Connection(rpcUrl, "confirmed");
    const signer = Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(readFileSync(keypairPath, "utf8")))
    );



    // --- STEP 1: DEPOSIT (Public -> Private) ---
    console.log("\n1️⃣ Depositing public SOL into private pool...");

    // We don't need to manually create 'output' UTXO, transact handles the logic 
    // but we need to define what we want to receive. 
    // For simplicity, let's just let the SDK handle the output generation via standard deposit flow
    // OR stick to your manual transact approach:
    const owner = await generateUtxoKeypair();
    const output = await createUtxo(amountLamports, owner, NATIVE_SOL_MINT);
    console.log(output);
    const depositResult = await transact({
        inputUtxos: [await createZeroUtxo(NATIVE_SOL_MINT)],
        outputUtxos: [output], // Let transact handle padding/creation if supported, or pass specific output
        externalAmount: amountLamports,
        depositor: signer.publicKey,
    }, {
        connection,
        programId: CLOAK_PROGRAM_ID,
        depositorKeypair: signer,
        walletPublicKey: signer.publicKey,
        enforceViewingKeyRegistration: false,
    });

    // Get the real note you just created
    const myNote = depositResult.outputUtxos.find(u => u.amount > 0)

    await new Promise(r => setTimeout(r, 20_000)) // wait for leaf to settle
    if (!myNote) throw new Error("Transfer failed to create note");
    console.log(myNote);
    console.log("✅ Deposit successful. Note Index:", myNote.index);


    const recipientUsdcAta = await getOrCreateAssociatedTokenAccount(
        connection,
        signer,
        DEVNET_MOCK_USDC_MINT,
        signer.publicKey,
    );
    const swapResult = await swapWithChange(
        [myNote],
        amountLamports, // amount to swap
        DEVNET_MOCK_USDC_MINT,
        recipientUsdcAta.address,
        1n, // replace with quote-based min output
        {
            connection,
            programId: CLOAK_PROGRAM_ID,
            enforceViewingKeyRegistration: false,
            cachedMerkleTree: depositResult.merkleTree,
        },
        signer.publicKey,
    );
    console.log("Swap Result: ", swapResult);

}

main().catch(console.error);