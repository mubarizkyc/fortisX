import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { readFileSync } from "fs";
import {
    transact,
    fullWithdraw,
    createZeroUtxo,
    CLOAK_PROGRAM_ID,
    generateUtxoKeypair,
    createUtxo,
    partialWithdraw,
    DEVNET_MOCK_USDC_MINT,
    Utxo // Keep if needed for typing
} from "@cloak.dev/sdk-devnet";
import { Sign } from "crypto";
import { sign } from "@stablelib/ed25519";
// Note: Ensure this package is installed and up-to-date

async function sendSameMint(args: {
    mint: PublicKey;
    amount: bigint;
    recipientWallet: PublicKey;
    partialWithdrawAmount?: bigint;
    signer: Keypair;
    connection: Connection;
}) {
    try {
        // 1. Generate a new UTXO owner (private key) for this transaction
        const owner = await generateUtxoKeypair();

        // 2. Create the output UTXO structure
        const output = await createUtxo(args.amount, owner, args.mint);

        // 3. Deposit: Move tokens from Signer's SPL ATA -> Cloak UTXO
        console.log("Initiating Deposit...");
        const deposited = await transact(
            {
                inputUtxos: [await createZeroUtxo(args.mint)], // Zero UTXO represents the SPL source
                outputUtxos: [output],
                externalAmount: args.amount,
                depositor: args.signer.publicKey,
            },
            {
                connection: args.connection,
                programId: CLOAK_PROGRAM_ID,
                enforceViewingKeyRegistration: false,
                depositorKeypair: args.signer,
                walletPublicKey: args.signer.publicKey,


            }
        );

        console.log("Deposit successful. Merkle tree updated.");

        // 4. Withdraw: Move tokens from Cloak UTXO -> Recipient's SPL ATA
        if (args.partialWithdrawAmount !== undefined) {
            console.log("Initiating Partial Withdrawal...");

            // IMPORTANT: Check if partialWithdraw requires the 'owner' Keypair to sign.
            // Most privacy protocols require the UTXO owner to prove ownership.
            // If the SDK needs the keypair, you might need to pass it or sign manually.
            return partialWithdraw(
                deposited.outputUtxos,
                args.recipientWallet,
                args.partialWithdrawAmount,
                {
                    connection: args.connection,
                    programId: CLOAK_PROGRAM_ID,
                    cachedMerkleTree: deposited.merkleTree,
                    enforceViewingKeyRegistration: false,
                },
            );
        } else {
            console.log("Initiating Full Withdrawal...");
            return fullWithdraw(
                deposited.outputUtxos,
                args.recipientWallet,
                {
                    connection: args.connection,
                    programId: CLOAK_PROGRAM_ID,
                    cachedMerkleTree: deposited.merkleTree,
                    enforceViewingKeyRegistration: false,
                }
            );
        }
    } catch (error) {
        console.error("Transaction failed:", error);
        throw error;
    }
}

async function main() {
    // Load signer
    const signer = Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(readFileSync("/home/mubariz/.config/solana/id.json", "utf8")))
    );

    // Fix: Correct Devnet RPC URL
    const connection = new Connection("https://api.devnet.solana.com", "confirmed");

    console.log(`Signer: ${signer.publicKey.toString()}`);
    console.log(`Mint: ${DEVNET_MOCK_USDC_MINT.toString()}`);

    try {
        const result = await sendSameMint({
            mint: DEVNET_MOCK_USDC_MINT,
            amount: 1n, // 1 unit (check decimals! USDC is usually 6, so 1n might be 0.000001 USDC)
            recipientWallet: signer.publicKey,
            connection,
            signer
        });

        console.log("Transaction Signature(s):", result);
    } catch (error) {
        console.error("Main execution failed:", error);
    }
}

main();