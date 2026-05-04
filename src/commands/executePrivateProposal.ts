// src/commands/executePrivateProposal.ts
import { PublicKey, Connection, Keypair } from '@solana/web3.js';
import chalk from 'chalk';
import bs58 from 'bs58';
import { readFile, writeFile } from 'fs/promises';
import { bytes32ToBigint } from './createMultisig';
import { StoredUtxoRecord } from './privateDeposit';
// Cloak SDK
import {
    CLOAK_PROGRAM_ID,
    NATIVE_SOL_MINT,
    transact,
    createUtxo,
    deserializeUtxo,
    Utxo,
    fullWithdraw, computeUtxoCommitment, derivePublicKey
} from '@cloak.dev/sdk-devnet';

// Local utils
import {
    SEED_PREFIX,
    SEED_TRANSACTION,
    SEED_PROPOSAL,
    PROGRAM_ID,
    bigIntToLittleEndianBytes,
} from '../utils';
import { match } from 'assert';

// ────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────
const VAULT_TRANSACTION_HEADER_SIZE = 73;
const PRIVATE_TRANSFER_META_SIZE = 32 + 8 + 32;
const PROPOSAL_STATUS_APPROVED = 1;

// ────────────────────────────────────────────────────────────
// Main Function
// ────────────────────────────────────────────────────────────
export async function executePrivateProposal(
    memberKeypair: Keypair,
    multisigAddress: PublicKey,
    proposalNumber: bigint,
    options?: {
        utxoFilePath?: string;        // Path to file with Base58 UTXOs (one per line)
        treasuryPrivateKey?: bigint;  // Hardcoded for testing
        cloakProgramId?: PublicKey;
        connection?: Connection;
    }
) {
    const {
        utxoFilePath = './treasury_utxos.json',
        // 🔐 HARDCODED TREASURY PRIVATE KEY (replace with Shamir later)
        treasuryPrivateKey = 307056467906366067893145655724826023861939096429627051233140052300132426955n,
        cloakProgramId = CLOAK_PROGRAM_ID,
        connection = new Connection('https://api.devnet.solana.com', 'confirmed'),
    } = options || {};

    console.log(chalk.yellow('🔐 Starting private proposal execution...'));

    // ────────────────────────────────────────────────────────
    // 1. Derive PDAs
    // ────────────────────────────────────────────────────────
    const nextTxIndexBytes = bigIntToLittleEndianBytes(proposalNumber, 8);
    const [proposalPda] = PublicKey.findProgramAddressSync(
        [SEED_PREFIX, multisigAddress.toBytes(), SEED_TRANSACTION, nextTxIndexBytes, SEED_PROPOSAL],
        PROGRAM_ID
    );
    const [txPda] = PublicKey.findProgramAddressSync(
        [SEED_PREFIX, multisigAddress.toBytes(), SEED_TRANSACTION, nextTxIndexBytes],
        PROGRAM_ID
    );

    // ────────────────────────────────────────────────────────
    // 2. Verify proposal is approved
    // ────────────────────────────────────────────────────────
    const proposalAccount = await connection.getAccountInfo(proposalPda);
    if (!proposalAccount) throw new Error(`Proposal not found: ${proposalPda.toBase58()}`);
    if (proposalAccount.data[56] !== PROPOSAL_STATUS_APPROVED) {
        throw new Error(`Proposal not approved. Status: ${proposalAccount.data[56]}`);
    }
    console.log(chalk.green('✅ Proposal is approved'));

    // ────────────────────────────────────────────────────────
    // 3. Fetch vault_transaction and parse metadata
    // ────────────────────────────────────────────────────────
    const txAccount = await connection.getAccountInfo(txPda);
    if (!txAccount) throw new Error('Transaction account not found');

    const metaOffset = VAULT_TRANSACTION_HEADER_SIZE;
    if (txAccount.data.length < metaOffset + PRIVATE_TRANSFER_META_SIZE) {
        throw new Error('Account data too short');
    }

    const utxoCommitmentBytes = txAccount.data.slice(metaOffset, metaOffset + 32);
    const amountBytes = txAccount.data.slice(metaOffset + 32, metaOffset + 40);
    const recipientBytes = txAccount.data.slice(metaOffset + 40, metaOffset + 72);

    const targetCommitment = bytes32ToBigint(utxoCommitmentBytes);

    const transferAmount = amountBytes.readBigUInt64LE(0);
    const recipientPublicKey = new PublicKey(recipientBytes);

    console.log(chalk.blue('Amount:'), transferAmount.toString(), 'lamports');
    console.log(chalk.blue('Recipient:'), recipientPublicKey.toBase58());

    // ────────────────────────────────────────────────────────
    // 4. Load UTXOs from file, deserialize, match by commitment
    // ────────────────────────────────────────────────────────


    const multisigAccount = await connection.getAccountInfo(multisigAddress)
    if (!multisigAccount) throw new Error('Multisig account not found')

    // Multisig header layout:
    // [0..32)   create_key
    // [32..64)  rent_collector  
    // [64..96)  treasury_utxo_pubkey  ← here
    const treasuryPublicKey = bytes32ToBigint(
        new Uint8Array(multisigAccount.data.slice(64, 96))
    )
    console.log(chalk.blue('Treasury pubkey:'), treasuryPublicKey.toString().slice(0, 20) + '...')
    console.log("finding utxo for coommitmnet: ", targetCommitment) //TDOD:VERIFY FETCHED UTXO IS CORRECT
    const matchedUtxo = await findAndRemoveUtxoByCommitmentJson(
        utxoFilePath,
        targetCommitment,
        treasuryPublicKey,
    )
    if (!matchedUtxo) {
        throw new Error(`No UTXO found for commitment ${targetCommitment.toString(16).slice(0, 16)}...`);
    }


    // then plug real private key after matching
    matchedUtxo.keypair.privateKey = treasuryPrivateKey
    // const derivedPublicKey_ = await derivePublicKey(treasuryPrivateKey);
    //matchedUtxo.keypair.publicKey = derivedPublicKey_;
    //matchedUtxo.commitment = await computeUtxoCommitment(matchedUtxo)

    //console.log('Derived pubkey:', derivedPublicKey_.toString())
    console.log('On-chain pubkey:', treasuryPublicKey.toString())
    console.log("treasury publicKey:", treasuryPublicKey)
    //console.log('Match:', derivedPublicKey_ === treasuryPublicKey)
    // recompute commitment one more time with real keypair
    //   matchedUtxo.commitment = await computeUtxoCommitment(matchedUtxo)
    if (!matchedUtxo) {
        throw new Error(`No UTXO found for commitment ${targetCommitment.toString(16).slice(0, 16)}...`);
    }
    console.log(chalk.green('✅ Found matching UTXO'), `amount=${matchedUtxo.amount.toString()}`);





    // ────────────────────────────────────────────────────────
    // 7. Execute Cloak transaction
    // ────────────────────────────────────────────────────────
    console.log(chalk.yellow('📤 Generating ZK proof and submitting...'));
    console.log('Matched UTXO:', matchedUtxo);
    // we need to transfer from private to public
    const transferResult = await fullWithdraw(
        [matchedUtxo],
        recipientPublicKey,
        {
            connection,
            programId: CLOAK_PROGRAM_ID,
            enforceViewingKeyRegistration: false,
            // ✅ UNCOMMENT THESE TWO LINES
            depositorKeypair: memberKeypair,
            walletPublicKey: memberKeypair.publicKey,

        }
    )

    console.log(chalk.green('✅ Cloak transaction submitted!'));
    console.log('Transfer Result:', transferResult);


}
// ────────────────────────────────────────────────────────────
// Helper: Read file, deserialize each UTXO, match by commitment, remove line
// ────────────────────────────────────────────────────────────
// src/commands/executePrivateProposal.ts

async function findAndRemoveUtxoByCommitmentJson(
    filePath: string,
    targetCommitment: bigint,
    treasuryPublicKey: bigint,   // Inject the real treasury pubkey here
): Promise<Utxo | null> {
    try {
        const content = await readFile(filePath, 'utf8');
        const records: StoredUtxoRecord[] = JSON.parse(content);

        // Find matching unspent UTXO by commitment string
        const matchIndex = records.findIndex(r =>
            !r.spent && r.commitment === targetCommitment.toString()
        );

        if (matchIndex === -1) {
            return null;
        }

        const record = records[matchIndex];

        // ✅ RECONSTRUCT UTXO OBJECT FROM RAW FIELDS
        const reconstructedUtxo: Utxo = {
            amount: BigInt(record.amount),
            keypair: {
                privateKey: 0n, // ✅ Use the REAL treasury private key
                publicKey: treasuryPublicKey,   // ✅ Use the REAL treasury public key
            },
            blinding: BigInt(record.blinding),
            mintAddress: new PublicKey(record.mintAddress),
            index: record.index,
            commitment: BigInt(record.commitment),
            siblingCommitment: BigInt(record.siblingcommitments)
        };

        // Mark as spent in memory
        records[matchIndex].spent = true;

        // Write back to file
        await writeFile(filePath, JSON.stringify(records, null, 2), 'utf8');
        console.log(chalk.green('🗑️ Marked UTXO as spent in JSON file'));

        return reconstructedUtxo;

    } catch (error) {
        console.error('❌ Error reading JSON UTXO file:', error);
        return null;
    }
}