// src/commands/executePrivateProposal.ts
import { PublicKey, Connection, Keypair } from '@solana/web3.js';
import chalk from 'chalk';
import { readFile, writeFile } from 'fs/promises';
import { blake3 } from '@noble/hashes/blake3';
import { bytes32ToBigint } from './createMultisig';
import { StoredUtxoRecord } from './privateDeposit';
import { MultiPayoutEntry, buildPayloadHash, ProposalDbRecord } from './createPrivateTransferProposal.ts';
// Cloak SDK
import {
    CLOAK_PROGRAM_ID,
    fullWithdraw,
    Utxo,
    getNkFromUtxoPrivateKey,
} from '@cloak.dev/sdk-devnet';
// Local utils
import {
    SEED_PREFIX,
    SEED_TRANSACTION,
    SEED_PROPOSAL,
    PROGRAM_ID,
    bigIntToLittleEndianBytes,
} from '../utils';

// ────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────
const VAULT_TRANSACTION_HEADER_SIZE = 73;
const PAYLOAD_HASH_OFFSET = 73;  // [73..105) on-chain
const PAYLOAD_HASH_SIZE = 32;
const PROPOSAL_STATUS_APPROVED = 1;
const PROPOSAL_STATUS_BYTE_OFFSET = 56;
const PAYLOAD_HASH_DOMAIN = new TextEncoder().encode('fortisx-payload-hash-v1');




// ────────────────────────────────────────────────────────────
// DB helpers
// ────────────────────────────────────────────────────────────
async function readProposalHistory(filePath: string): Promise<ProposalDbRecord[]> {
    try {
        return JSON.parse(await readFile(filePath, 'utf8'));
    } catch {
        return [];
    }
}

function findProposalRecord(
    records: ProposalDbRecord[],
    txIndex: bigint,
    multisig: PublicKey,
): ProposalDbRecord | null {
    return records.find(
        r => r.txIndex === txIndex.toString()
            && r.multisig === multisig.toBase58()
    ) ?? null;
}

// ────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────
export async function executePrivateProposal(
    memberKeypair: Keypair,
    multisigAddress: PublicKey,
    proposalNumber: bigint,
    options?: {
        proposalHistoryPath?: string;
        utxoFilePath?: string;
        treasuryPrivateKey?: bigint;
        connection?: Connection;
    }
) {
    const {
        proposalHistoryPath = './proposal_history.json',
        utxoFilePath = './treasury_utxos.json',
        treasuryPrivateKey = 273359863658514664212296310053104340760987317868162256389733667165716389083n,
        connection = new Connection('https://api.devnet.solana.com', 'confirmed'),
    } = options ?? {};

    console.log(chalk.yellow('🔐 Starting private proposal execution...'));

    // ────────────────────────────────────────────────────────
    // 1. Load proposal record from DB
    // ────────────────────────────────────────────────────────
    const history = await readProposalHistory(proposalHistoryPath);
    const record = findProposalRecord(history, proposalNumber, multisigAddress);

    if (!record) {
        throw new Error(
            `Proposal #${proposalNumber} not found in ${proposalHistoryPath} ` +
            `for multisig ${multisigAddress.toBase58()}`
        );
    }
    console.log(chalk.green('✅ Found proposal in DB'), `txIndex=${record.txIndex}`);

    // Reconstruct typed values from DB strings
    const mint = new PublicKey(record.mint);
    const salt = BigInt(record.salt);
    const entries: MultiPayoutEntry[] = record.entries.map(e => ({
        commitment: BigInt(e.commitment),
        amount: BigInt(e.amount),
        recipient: new PublicKey(e.recipient),
    }));

    // ────────────────────────────────────────────────────────
    // 2. Derive PDAs
    // ────────────────────────────────────────────────────────
    const txIndexBytes = bigIntToLittleEndianBytes(proposalNumber, 8);
    const [proposalPda] = PublicKey.findProgramAddressSync(
        [SEED_PREFIX, multisigAddress.toBytes(), SEED_TRANSACTION, txIndexBytes, SEED_PROPOSAL],
        PROGRAM_ID
    );
    const [txPda] = PublicKey.findProgramAddressSync(
        [SEED_PREFIX, multisigAddress.toBytes(), SEED_TRANSACTION, txIndexBytes],
        PROGRAM_ID
    );

    // ────────────────────────────────────────────────────────
    // 3. Verify proposal is approved on-chain
    // ────────────────────────────────────────────────────────
    const proposalAccount = await connection.getAccountInfo(proposalPda);
    if (!proposalAccount) {
        throw new Error(`Proposal account not found on-chain: ${proposalPda.toBase58()}`);
    }
    if (proposalAccount.data[PROPOSAL_STATUS_BYTE_OFFSET] !== PROPOSAL_STATUS_APPROVED) {
        throw new Error(
            `Proposal not approved. Status: ${proposalAccount.data[PROPOSAL_STATUS_BYTE_OFFSET]}`
        );
    }
    console.log(chalk.green('✅ Proposal approved on-chain'));

    // ────────────────────────────────────────────────────────
    // 4. Read on-chain hash and verify against DB payload
    //    Nothing moves until this passes.
    // ────────────────────────────────────────────────────────
    const txAccount = await connection.getAccountInfo(txPda);
    if (!txAccount) {
        throw new Error(`vault_transaction account not found: ${txPda.toBase58()}`);
    }
    if (txAccount.data.length < VAULT_TRANSACTION_HEADER_SIZE + PAYLOAD_HASH_SIZE) {
        throw new Error(`vault_transaction account data too short: ${txAccount.data.length}`);
    }

    const onChainHash = Buffer.from(
        txAccount.data.slice(PAYLOAD_HASH_OFFSET, PAYLOAD_HASH_OFFSET + PAYLOAD_HASH_SIZE)
    );
    const recomputedHash = buildPayloadHash(mint, salt, entries);

    console.log(chalk.blue('On-chain hash:   '), onChainHash.toString('hex'));
    console.log(chalk.blue('Recomputed hash: '), recomputedHash.toString('hex'));
    console.log(chalk.blue('DB stored hash:  '), record.payloadHash);

    if (!recomputedHash.equals(onChainHash)) {
        throw new Error(
            `🚨 HASH MISMATCH — refusing to execute.\n` +
            `  on-chain:   ${onChainHash.toString('hex')}\n` +
            `  recomputed: ${recomputedHash.toString('hex')}\n` +
            `Possible causes: wrong salt, tampered DB record, or wrong proposal index.`
        );
    }
    console.log(chalk.green('✅ Hash verified — DB payload matches on-chain commitment'));

    // ────────────────────────────────────────────────────────
    // 5. Fetch treasury public key from multisig account
    //    Layout: [create_key:32][rent_collector:32][treasury_utxo_pubkey:32]
    // ────────────────────────────────────────────────────────
    const multisigAccount = await connection.getAccountInfo(multisigAddress);
    if (!multisigAccount) throw new Error('Multisig account not found');

    const treasuryPublicKey = bytes32ToBigint(
        new Uint8Array(multisigAccount.data.slice(64, 96))
    );
    console.log(chalk.blue('Treasury pubkey:'), treasuryPublicKey.toString().slice(0, 20) + '...');

    // ────────────────────────────────────────────────────────
    // 6. Execute each payout — entries come from DB, not chain
    // ────────────────────────────────────────────────────────
    const results: { recipient: string; amount: string; txResult: unknown }[] = [];
    const failures: { index: number; recipient: string; error: string }[] = [];

    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        console.log(chalk.yellow(`\n📤 Payout ${i + 1}/${entries.length}`));
        console.log(`   Recipient: ${entry.recipient.toBase58()}`);
        console.log(`   Amount:    ${entry.amount} lamports`);

        const matchedUtxo = await findAndRemoveUtxoByCommitment(
            utxoFilePath,
            entry.commitment,
            treasuryPublicKey,
        );

        if (!matchedUtxo) {
            const msg = `No unspent UTXO for commitment ${entry.commitment.toString(16).slice(0, 16)}...`;
            console.error(chalk.red(`❌ Entry ${i}: ${msg}`));
            failures.push({ index: i, recipient: entry.recipient.toBase58(), error: msg });
            continue;
        }

        matchedUtxo.keypair.privateKey = treasuryPrivateKey;
        console.log(chalk.green('✅ UTXO matched'), `amount=${matchedUtxo.amount}`);

        try {
            const txResult = await fullWithdraw(
                [matchedUtxo],
                entry.recipient,
                {
                    connection,
                    programId: CLOAK_PROGRAM_ID,
                    enforceViewingKeyRegistration: false,
                    depositorKeypair: memberKeypair,
                    walletPublicKey: memberKeypair.publicKey,
                    chainNoteViewingKeyNk: getNkFromUtxoPrivateKey(matchedUtxo.keypair.privateKey),
                }
            );
            console.log(chalk.green(`✅ Payout ${i + 1} submitted`));
            results.push({
                recipient: entry.recipient.toBase58(),
                amount: entry.amount.toString(),
                txResult,
            });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(chalk.red(`❌ Payout ${i + 1} failed: ${msg}`));
            failures.push({ index: i, recipient: entry.recipient.toBase58(), error: msg });
        }
    }

    // ────────────────────────────────────────────────────────
    // 7. Summary
    // ────────────────────────────────────────────────────────
    console.log(chalk.bold('\n📊 Execution Summary'));
    console.log(`   Total:      ${entries.length}`);
    console.log(`   ${chalk.green('Succeeded:')}  ${results.length}`);
    console.log(`   ${chalk.red('Failed:')}      ${failures.length}`);

    if (failures.length > 0) {
        console.log(chalk.red('\nFailed entries:'));
        for (const f of failures) {
            console.log(`   [${f.index}] ${f.recipient} — ${f.error}`);
        }
    }
    if (failures.length > 0 && results.length === 0) {
        throw new Error(`All ${failures.length} payouts failed`);
    }

    return { results, failures };
}

// ────────────────────────────────────────────────────────────
// UTXO file helper
// ────────────────────────────────────────────────────────────
async function findAndRemoveUtxoByCommitment(
    filePath: string,
    targetCommitment: bigint,
    treasuryPublicKey: bigint,
): Promise<Utxo | null> {
    try {
        const records: StoredUtxoRecord[] = JSON.parse(await readFile(filePath, 'utf8'));

        const matchIndex = records.findIndex(
            r => !r.spent && r.commitment === targetCommitment.toString()
        );
        if (matchIndex === -1) return null;

        const r = records[matchIndex];
        const utxo: Utxo = {
            amount: BigInt(r.amount),
            keypair: {
                privateKey: 0n,                 // caller injects real key
                publicKey: treasuryPublicKey,
            },
            blinding: BigInt(r.blinding),
            mintAddress: new PublicKey(r.mintAddress),
            index: r.index,
            commitment: BigInt(r.commitment),
            siblingCommitment: BigInt(r.siblingcommitments),
        };

        // Mark spent before on-chain tx — prevents double-spend on retry
        records[matchIndex].spent = true;
        await writeFile(filePath, JSON.stringify(records, null, 2), 'utf8');
        console.log(chalk.green('🗑️  Marked UTXO as spent'));

        return utxo;
    } catch (err) {
        console.error('❌ Error reading UTXO file:', err);
        return null;
    }
}