#!/usr/bin/env node
/**
 * FortisX CLI — Environment-Configured Multisig & Privacy Tool
 * 
 * Environment Variables:
 *   SOLANA_RPC_URL   - Solana RPC endpoint (default: Helius devnet)
 *   KEYPAIR_PATH     - Default path to signer keypair JSON (default: ~/.config/solana/id.json)
 * 
 * CLI Overrides:
 *   --rpc <url>      - Override SOLANA_RPC_URL for this command
 *   --keypair <path> - Override KEYPAIR_PATH for this command
 */

import cac from 'cac';
import chalk from 'chalk';
import { request, Agent } from 'undici';
import { readFileSync } from 'fs';
import path from 'path';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';

// ────────────────────────────────────────────────────────────
// Environment Configuration
// ────────────────────────────────────────────────────────────
const ENV = {
    RPC_URL: process.env.SOLANA_RPC_URL || 'https://devnet.helius-rpc.com/?api-key=64096058-650d-4e15-99cd-842c236765ef',
    KEYPAIR_PATH: process.env.KEYPAIR_PATH || path.join(process.env.HOME || '', '.config/solana/id.json'),
};

// ────────────────────────────────────────────────────────────
// Import Commands
// ────────────────────────────────────────────────────────────
import { executePrivateProposal } from './commands/executePrivateProposal';
import { ScanComplianceOptions, scanCompliance } from './commands/viewComplianceReport';
import { createMultisig } from './commands/createMultisig';
import { publicDeposit } from './commands/publicDeposit';
import { CloakDeposit } from './commands/cloakDeposit';
import { PrivateDeposit } from './commands/privateDeposit';
import { createTransferProposal } from './commands/createTransferProposal';
import { approveProposal } from './commands/approveProposal';
import { executeProposal } from './commands/executeProposal';
import { createPrivateTransferProposal } from './commands/createPrivateTransferProposal.ts';
import { createPrivateSwapProposal, SwapEntry } from './commands/createPrivateSwapProposal';
import { fetchAndDecryptShare } from './shareCrypto';

// ────────────────────────────────────────────────────────────
// Global Helpers
// ────────────────────────────────────────────────────────────

/**
 * Get RPC URL: CLI arg > env var > default
 */
function getRpcUrl(cliRpc?: string): string {
    return cliRpc || ENV.RPC_URL;
}

/**
 * Get keypair path: CLI arg > env var > default
 */
function getKeypairPath(cliPath?: string): string {
    return path.resolve(cliPath || ENV.KEYPAIR_PATH);
}

/**
 * Load connection with commitment level
 */
function getConnection(rpcUrl?: string, commitment: 'processed' | 'confirmed' | 'finalized' = 'confirmed'): Connection {
    return new Connection(getRpcUrl(rpcUrl), commitment);
}

/**
 * Load keypair from JSON file
 */
function loadKeypair(keypairPath?: string): Keypair {
    const resolved = getKeypairPath(keypairPath);
    try {
        const secretKey = JSON.parse(readFileSync(resolved, 'utf8'));
        return Keypair.fromSecretKey(Uint8Array.from(secretKey));
    } catch (error: any) {
        throw new Error(`Failed to load keypair from "${resolved}": ${error.message}`);
    }
}

/**
 * Safe BigInt parsing: handles decimal, hex (0x...), trailing 'n'
 */
function parseBigInt(value: string | number | bigint): bigint {
    if (typeof value === 'bigint') return value;
    if (typeof value === 'number') {
        console.warn('⚠️ Warning: value was parsed as Number - may lose precision');
        return BigInt(Math.round(value));
    }
    const cleaned = String(value).trim().replace(/^0x/, '').replace(/n$/, '');
    if (!cleaned) throw new Error('Cannot parse empty value as BigInt');
    return BigInt(cleaned);
}

/**
 * Parse PublicKey: accepts base58 (44 chars) or bigint string
 */
function parsePublicKey(value: string): PublicKey {
    if (value.length === 44) return new PublicKey(value);
    const bytes = new Uint8Array(32);
    let remaining = parseBigInt(value);
    for (let i = 0; i < 32; i++) {
        bytes[i] = Number(remaining & 0xFFn);
        remaining >>= 8n;
    }
    return new PublicKey(bytes);
}

/**
 * Read raw argv to bypass CLI framework coercion (for BigInt precision)
 */
function rawArg(flag: string): string | undefined {
    const idx = process.argv.indexOf(flag);
    return idx !== -1 && idx + 1 < process.argv.length ? process.argv[idx + 1] : undefined;
}

/**
 * Parse comma-separated BigInt values
 */
function parseBigIntArray(raw: string | undefined, label: string): bigint[] {
    if (!raw) throw new Error(`--${label} is required`);
    return raw.split(',').map((val, i) => {
        const cleaned = val.trim().replace(/^0x/i, '').replace(/n$/, '');
        if (!cleaned || !/^[0-9a-fA-F]+$/.test(cleaned)) {
            throw new Error(`Invalid ${label}[${i}]: "${val}" (expected decimal or 0x hex)`);
        }
        return BigInt(cleaned);
    });
}

/**
 * Parse comma-separated PublicKey values
 */
function parsePublicKeyArray(raw: string | undefined, label: string): PublicKey[] {
    if (!raw) throw new Error(`--${label} is required`);
    return raw.split(',').map((val, i) => {
        try {
            return new PublicKey(val.trim());
        } catch {
            throw new Error(`Invalid ${label}[${i}]: "${val}" (expected base58 pubkey)`);
        }
    });
}

// ────────────────────────────────────────────────────────────
// CLI Setup
// ────────────────────────────────────────────────────────────
const cli = cac('fortisx');

// Global options (available to all commands)
cli
    .option('--rpc <url>', 'Solana RPC URL (overrides SOLANA_RPC_URL)')
    .option('--keypair <path>', 'Path to signer keypair JSON (overrides KEYPAIR_PATH)')
    .option('--commitment <level>', 'RPC commitment level', {
        default: 'confirmed',
        choices: ['processed', 'confirmed', 'finalized']
    });

// ────────────────────────────────────────────────────────────
// Command: submit_share
// ────────────────────────────────────────────────────────────
cli
    .command('submit_share', 'Fetch, decrypt, and submit your Shamir share to the collector')
    .option('--multisig <address>', 'Multisig account address (base58)', { required: true })
    .option('--collector-url <url>', 'Share collector endpoint', {
        default: 'http://localhost:3456/api/submit-share'
    })
    .option('--insecure', 'Allow self-signed HTTPS certificates (for local testing)', { default: false })
    .option('--timeout <ms>', 'Request timeout in milliseconds', { type: Number, default: 30000 })
    .action(async (options, cmd) => {
        try {
            if (!options.multisig) throw new Error('--multisig <address> is required');

            const multisigAddress = new PublicKey(options.multisig);
            const memberKeypair = loadKeypair(options.keypair);
            const connection = getConnection(options.rpc);

            console.log(chalk.blue('Member:'), memberKeypair.publicKey.toBase58());
            console.log(chalk.blue('Multisig:'), multisigAddress.toBase58());
            console.log(chalk.blue('Collector URL:'), options.collectorUrl);
            console.log(chalk.yellow('🔐 Fetching encrypted share from on-chain...'));

            const decryptedShare = await fetchAndDecryptShare(multisigAddress, memberKeypair, connection);

            console.log(chalk.green('✅ Share decrypted successfully'));
            console.log('Decrypted share (first 8 bytes, hex):',
                Buffer.from(decryptedShare.slice(0, 8)).toString('hex') + '...');

            console.log(chalk.yellow('📤 Submitting share to collector...'));

            const requestBody = JSON.stringify({
                memberPubkey: memberKeypair.publicKey.toBase58(),
                decryptedShare: Array.from(decryptedShare),
                timestamp: Date.now(),
            });

            const dispatcher = options.insecure
                ? new Agent({ connect: { rejectUnauthorized: false } })
                : undefined;

            const { statusCode, body } = await request(options.collectorUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(requestBody).toString(),
                },
                body: requestBody,
                dispatcher,
                signal: AbortSignal.timeout(options.timeout),
            });

            const responseText = await body.text();
            if (statusCode !== 200) {
                throw new Error(`Collector returned ${statusCode}: ${responseText}`);
            }

            const result = JSON.parse(responseText);
            console.log(chalk.green('✅ Share submitted successfully!'));
            console.log('Response:', result);

            if (result.collected >= result.threshold) {
                console.log(chalk.green('🎉 Threshold reached! Execution can proceed.'));
            } else {
                console.log(chalk.blue(`📊 Progress: ${result.collected}/${result.threshold} shares collected`));
            }

        } catch (error: any) {
            console.error(chalk.red('❌ Share submission failed:'), error.message);
            if (error.code === 'ECONNREFUSED') {
                console.error('💡 Is the share collector server running?');
            } else if (error.code?.includes('TLS') || error.code?.includes('CERT')) {
                console.error('💡 TLS certificate error. Use --insecure for self-signed certs.');
            }
            process.exit(1);
        }
    });

// ────────────────────────────────────────────────────────────
// Command: execute_private_proposal
// ────────────────────────────────────────────────────────────
cli
    .command('execute_private_proposal', 'Execute an approved private Cloak proposal')
    .option('--multisig <address>', 'Multisig account address (base58)', { required: true })
    .option('--proposal-number <value>', 'Proposal number to execute (decimal or 0x hex)', { type: String, required: true })
    .option('--utxo-file <path>', 'Path to file with Base58 UTXOs', { default: './multisig_utxo_logs.txt' })
    .option('--collector-port <port>', 'Port for share collector server', { type: Number, default: 3456 })
    .option('--share-timeout-ms <ms>', 'Timeout for share collection', { type: Number, default: 300000 })
    .action(async (options, cmd) => {
        try {
            const multisig = new PublicKey(options.multisig);
            const proposalNumber = parseBigInt(options.proposalNumber);
            const creator = loadKeypair(options.keypair);
            const connection = getConnection(options.rpc, options.commitment);

            console.log(chalk.blue('Executing Member:'), creator.publicKey.toBase58());
            console.log(chalk.blue('Multisig:'), multisig.toBase58());
            console.log(chalk.blue('Proposal Number:'), proposalNumber.toString());
            console.log(chalk.yellow('⏳ Executing private proposal...'));

            const result = await executePrivateProposal(creator, multisig, proposalNumber, {
                connection,
                utxoFilePath: options.utxoFile,
                collectorPort: options.collectorPort,
                shareTimeoutMs: options.shareTimeoutMs,
            });

            console.log(chalk.green('✅ Private proposal executed successfully!'));

        } catch (error: any) {
            console.error(chalk.red('❌ Execution Failed:'), error.message);
            if (error.logs && Array.isArray(error.logs)) {
                console.error('📜 Program Logs:');
                error.logs.forEach((log: string) => console.error('  ', log));
            }
            process.exit(1);
        }
    });

// ────────────────────────────────────────────────────────────
// Command: create_multisig
// ────────────────────────────────────────────────────────────
cli
    .command('create_multisig', 'Create a new multisig configuration')
    .option('--members <members>', 'Space-separated list of public keys', { required: true })
    .option('--threshold <threshold>', 'Number of required signatures', { type: Number, required: true })
    .action(async (options, cmd) => {
        try {
            const creator = loadKeypair(options.keypair);
            const connection = getConnection(options.rpc, options.commitment);

            const rawAddresses = options.members.split(' ').filter(Boolean);
            const members = rawAddresses.map(a => {
                try { return new PublicKey(a.trim()); }
                catch (e: any) { throw new Error(`Invalid public key: "${a}". ${e.message}`); }
            });

            const threshold = options.threshold;
            if (threshold < 1 || threshold > members.length) {
                throw new Error(`Threshold must be between 1 and ${members.length}`);
            }

            await createMultisig(members, threshold, creator.publicKey, creator, connection);
            console.log(chalk.green('✅ Multisig Created!'));

        } catch (error: any) {
            console.error(chalk.red('❌ Error:'), error.message);
            process.exit(1);
        }
    });

// ────────────────────────────────────────────────────────────
// Command: public_deposit
// ────────────────────────────────────────────────────────────
cli
    .command('public_deposit', 'Deposit SOL into a public treasury')
    .option('--amount <lamports>', 'Amount to deposit in lamports', { type: Number, required: true })
    .option('--multisig <address>', 'Multisig account address', { required: true })
    .action(async (options, cmd) => {
        try {
            const amount = options.amount;
            if (!amount || amount <= 0) throw new Error('Valid --amount (in lamports) is required');

            const depositor = loadKeypair(options.keypair);
            const multisigPubkey = new PublicKey(options.multisig);

            console.log(chalk.blue('Depositor:'), depositor.publicKey.toBase58());
            console.log(chalk.blue('Amount:'), amount, 'lamports');

            await publicDeposit(depositor, BigInt(amount), multisigPubkey);
            console.log(chalk.green('✅ Public Deposit Completed!'));

        } catch (error: any) {
            console.error(chalk.red('❌ Error:'), error.message);
            process.exit(1);
        }
    });

// ────────────────────────────────────────────────────────────
// Command: cloak_deposit
// ────────────────────────────────────────────────────────────
cli
    .command('cloak_deposit', 'Deposit SOL into Cloak Protocol (Private)')
    .option('--mint <mint>', 'Asset Address (base58)', { required: true })
    .option('--amount <lamports>', 'Amount to deposit in lamports', { type: Number, required: true })
    .action(async (options, cmd) => {
        try {
            const amount = options.amount;
            if (!amount || amount <= 0) throw new Error('Valid --amount is required');

            const signer = loadKeypair(options.keypair);
            const connection = getConnection(options.rpc, options.commitment);

            console.log(chalk.blue('Signer:'), signer.publicKey.toBase58());
            console.log(chalk.blue('Amount:'), amount, 'lamports');
            console.log(chalk.yellow('⏳ Processing private deposit...'));

            await CloakDeposit(BigInt(amount), signer, options.mint, connection);
            console.log(chalk.green('✅ Cloak Deposit Completed!'));

        } catch (error: any) {
            console.error(chalk.red('❌ Error:'), error.message);
            process.exit(1);
        }
    });

// ────────────────────────────────────────────────────────────
// Command: private_deposit
// ────────────────────────────────────────────────────────────
cli
    .command('private_deposit', 'Transfer from Private UTXO to Multisig Treasury')
    .option('--amount <lamports>', 'Amount to transfer in lamports', { type: Number, required: true })
    .option('--treasury-id <id>', 'Treasury ID (BigInt) to deposit into', { required: true })
    .option('--utxo <base58>', 'Your existing Private UTXO (Base58) to spend', { required: true })
    .action(async (options, cmd) => {
        try {
            const treasuryid = parseBigInt(rawArg('--treasury-id'));
            const amount = options.amount;
            if (!amount || amount <= 0) throw new Error('Valid --amount is required');

            const signer = loadKeypair(options.keypair);

            console.log(chalk.blue('Signer:'), signer.publicKey.toBase58());
            console.log(chalk.blue('Treasury ID:'), treasuryid.toString());
            console.log(chalk.blue('Amount:'), amount, 'lamports');
            console.log(chalk.yellow('⏳ Processing private transfer...'));

            await PrivateDeposit(BigInt(amount), signer, treasuryid, options.utxo);
            console.log(chalk.green('✅ Private Transfer Completed!'));

        } catch (error: any) {
            console.error(chalk.red('❌ Error:'), error.message);
            process.exit(1);
        }
    });

// ────────────────────────────────────────────────────────────
// Command: create_transfer_proposal
// ────────────────────────────────────────────────────────────
cli
    .command('create_transfer_proposal', 'Create a public transfer proposal for multisig')
    .option('--multisig <address>', 'Multisig account address', { required: true })
    .option('--target <address>', 'Transfer recipient address', { required: true })
    .option('--amount <lamports>', 'Amount in lamports', { type: Number, required: true })
    .action(async (options, cmd) => {
        try {
            const multisig = new PublicKey(options.multisig);
            const target = new PublicKey(options.target);
            const amount = BigInt(options.amount);
            const creator = loadKeypair(options.keypair);
            const connection = getConnection(options.rpc, options.commitment);

            console.log(chalk.yellow('Creating transfer proposal...'));
            await createTransferProposal(creator, multisig, target, amount, connection);
            console.log(chalk.green('✅ Proposal Created!'));

        } catch (error: any) {
            console.error(chalk.red('❌ Error:'), error.message);
            process.exit(1);
        }
    });

// ────────────────────────────────────────────────────────────
// Command: approve_proposal
// ────────────────────────────────────────────────────────────
cli
    .command('approve_proposal', 'Approve a multisig proposal as a member')
    .option('--multisig <address>', 'Multisig account address', { required: true })
    .option('--proposal <number>', 'Proposal number to approve', { required: true })
    .action(async (options, cmd) => {
        try {
            const multisigPubkey = new PublicKey(options.multisig);
            const proposalNumber = BigInt(options.proposal);
            const member = loadKeypair(options.keypair);
            const connection = getConnection(options.rpc, options.commitment);

            console.log(chalk.blue('Member:'), member.publicKey.toBase58());
            console.log(chalk.blue('Multisig:'), multisigPubkey.toBase58());
            console.log(chalk.yellow('⏳ Processing approval...'));

            await approveProposal(member, multisigPubkey, proposalNumber, connection);
            console.log(chalk.green('✅ Approval Completed!'));

        } catch (error: any) {
            console.error(chalk.red('❌ Error:'), error.message);
            process.exit(1);
        }
    });

// ────────────────────────────────────────────────────────────
// Command: execute_proposal
// ────────────────────────────────────────────────────────────
cli
    .command('execute_proposal', 'Execute an approved multisig proposal')
    .option('--multisig <address>', 'Multisig account address', { required: true })
    .option('--proposal <number>', 'Proposal number (transaction index) to execute', { type: Number, required: true })
    .action(async (options, cmd) => {
        try {
            const multisigPubkey = new PublicKey(options.multisig);
            const proposalNumber = BigInt(options.proposal);
            const member = loadKeypair(options.keypair);

            console.log(chalk.blue('Member:'), member.publicKey.toBase58());
            console.log(chalk.blue('Multisig:'), multisigPubkey.toBase58());
            console.log(chalk.blue('Proposal Number:'), proposalNumber.toString());
            console.log(chalk.yellow('⏳ Executing proposal...'));

            await executeProposal(member, multisigPubkey, proposalNumber);
            console.log(chalk.green('✅ Proposal Executed!'));

        } catch (error: any) {
            console.error(chalk.red('❌ Error:'), error.message);
            if (error.logs && Array.isArray(error.logs)) {
                console.error('📜 Program Logs:');
                error.logs.forEach((log: string) => console.error('  ', log));
            }
            process.exit(1);
        }
    });

// ────────────────────────────────────────────────────────────
// Command: create_private_transfer_proposal
// ────────────────────────────────────────────────────────────
cli
    .command('create_private_transfer_proposal', 'Create a private Cloak transfer proposal (single or batch)')
    .option('--multisig <address>', 'Multisig account address (base58)', { required: true })
    .option('--mint <address>', 'Asset address (base58)', { required: true })
    // Batch inputs
    .option('--commitments <values>', 'UTXO commitments (comma-separated, decimal or 0x hex)', { type: String })
    .option('--targets <pubkeys>', 'Recipient public keys (comma-separated, base58)', { type: String })
    .option('--amounts <values>', 'Amounts in lamports (comma-separated, decimal or 0x hex)', { type: String })
    // Legacy single inputs
    .option('--commitment <value>', 'Single UTXO commitment (deprecated: use --commitments)', { type: String })
    .option('--target <pubkey>', 'Single recipient (deprecated: use --targets)', { type: String })
    .option('--amount <value>', 'Single amount (deprecated: use --amounts)', { type: String })
    .option('--deadline <seconds>', 'Voting deadline in seconds (default: 86400)', { type: String })
    .action(async (options, cmd) => {
        try {
            console.log(chalk.yellow('🔐 Creating private transfer proposal...'));

            const isBatchMode = options.commitments || options.targets || options.amounts;
            let commitments: bigint[], recipients: PublicKey[], amounts: bigint[];

            if (isBatchMode) {
                commitments = parseBigIntArray(options.commitments, 'commitments');
                recipients = parsePublicKeyArray(options.targets, 'targets');
                amounts = parseBigIntArray(options.amounts, 'amounts');

                if (commitments.length !== recipients.length || commitments.length !== amounts.length) {
                    throw new Error(`Array length mismatch. All arrays must have the same length.`);
                }
                if (commitments.length === 0) throw new Error('At least one payout entry required');
                if (commitments.length > 255) throw new Error('Max 255 entries per proposal');
                console.log(chalk.blue(`📦 Batch mode: ${commitments.length} payout entries`));
            } else {
                const commitmentStr = rawArg('--commitment');
                const amountStr = rawArg('--amount');
                if (!commitmentStr || !amountStr || !options.target) {
                    throw new Error('--commitment, --amount, and --target are required for single payout');
                }
                commitments = [BigInt(commitmentStr)];
                amounts = [BigInt(amountStr)];
                recipients = [new PublicKey(options.target)];
                console.log(chalk.blue('📦 Single payout mode'));
            }

            const mint = new PublicKey(options.mint);
            const multisig = new PublicKey(options.multisig);
            const creator = loadKeypair(options.keypair);
            const connection = getConnection(options.rpc, options.commitment);
            const votingDeadlineSeconds = options.deadline ? parseInt(options.deadline, 10) : undefined;

            console.log(chalk.blue('Creator:'), creator.publicKey.toBase58());
            console.log(chalk.blue('Multisig:'), multisig.toBase58());
            console.log(chalk.blue('Entries:'), commitments.length);
            console.log(chalk.blue('Preview:'), {
                commitment: '0x' + commitments[0].toString(16).slice(0, 16) + '...',
                amount: amounts[0].toString(),
                recipient: recipients[0].toBase58(),
            });
            if (votingDeadlineSeconds) {
                console.log(chalk.blue('Deadline:'), `${votingDeadlineSeconds}s`);
            }
            console.log(chalk.yellow('⏳ Creating proposal...'));

            const entries = commitments.map((commitment, i) => ({
                commitment,
                amount: amounts[i],
                recipient: recipients[i],
            }));

            await createPrivateTransferProposal(entries, mint, creator, multisig, connection, { votingDeadlineSeconds });
            console.log(chalk.green('✅ Private proposal created!'));

        } catch (error: any) {
            console.error(chalk.red('❌ Proposal creation failed:'), error.message);
            if (error.message?.includes('Array length')) {
                console.error('💡 Hint: All arrays (--commitments, --targets, --amounts) must have the same length');
            }
            process.exit(1);
        }
    });

// ────────────────────────────────────────────────────────────
// Command: create_private_swap_proposal
// ────────────────────────────────────────────────────────────
cli
    .command('create_private_swap_proposal', 'Create a private Cloak swap proposal (single swap)')
    .option('--multisig <address>', 'Multisig account address (base58)', { required: true })
    .option('--commitment <value>', 'UTXO commitment to spend (decimal or 0x hex)', { type: String, required: true })
    .option('--amount <value>', 'Amount to swap (input token units)', { type: String, required: true })
    .option('--recipient-ata <pubkey>', "Recipient's ATA for OUTPUT token (base58)", { required: true })
    .option('--target-mint <pubkey>', 'Mint of token being swapped TO (base58)', { required: true })
    .option('--mint <pubkey>', 'Mint of source token (base58)', { required: true })
    .option('--deadline <seconds>', 'Voting deadline in seconds (default: 86400)', { type: String })
    .action(async (options, cmd) => {
        try {
            console.log(chalk.yellow('🔀 Creating private swap proposal...'));

            const commitmentStr = rawArg('--commitment');
            const amountStr = rawArg('--amount');
            if (!commitmentStr || !amountStr) throw new Error('--commitment and --amount are required');

            const commitment = parseBigInt(commitmentStr);
            const amount = parseBigInt(amountStr);
            const recipientAta = new PublicKey(options.recipientAta);
            const targetMint = new PublicKey(options.targetMint);
            const sourceMint = new PublicKey(options.mint);
            const multisig = new PublicKey(options.multisig);
            const creator = loadKeypair(options.keypair);
            const connection = getConnection(options.rpc, options.commitment);
            const votingDeadlineSeconds = options.deadline ? parseInt(options.deadline, 10) : undefined;

            console.log(chalk.blue('Creator:'), creator.publicKey.toBase58());
            console.log(chalk.blue('Multisig:'), multisig.toBase58());
            console.log(chalk.blue('Swap:'), {
                commitment: '0x' + commitment.toString(16).slice(0, 16) + '...',
                amount: amount.toString(),
                sourceMint: sourceMint.toBase58(),
                targetMint: targetMint.toBase58(),
                recipientAta: recipientAta.toBase58(),
            });
            console.log(chalk.yellow('⏳ Creating proposal...'));

            const entry: SwapEntry = {
                commitment,
                mint: sourceMint,
                amount,
                recipientAta,
                targetMint,
            };

            const result = await createPrivateSwapProposal(entry, creator, multisig, connection, { votingDeadlineSeconds });
            console.log(chalk.green('✅ Private swap proposal created!'));
            console.log('Proposal PDA:', result.proposalPda.toBase58());
            console.log('Payload hash:', result.payloadHash.toString('hex'));

        } catch (error: any) {
            console.error(chalk.red('❌ Swap proposal creation failed:'), error.message);
            process.exit(1);
        }
    });

// ────────────────────────────────────────────────────────────
// Command: scan-compliance
// ────────────────────────────────────────────────────────────
cli
    .command('scan-compliance', 'Scan Cloak transaction history for compliance/auditing')
    .option('--viewing-key <key>', 'Base58-encoded viewing key (nk, 32 bytes)', { required: true })
    .option('--limit <number>', 'Maximum transactions to scan', { type: Number })
    .action(async (options, cmd) => {
        try {
            console.log(chalk.yellow('🔐 FortisX Compliance Scanner'));
            console.log(chalk.dim('Scanning private Cloak transactions...'));

            const scanOptions: ScanComplianceOptions = {
                viewingKey: options.viewingKey,
                rpcUrl: getRpcUrl(options.rpc),
                limit: options.limit,
            };

            const result = await scanCompliance(scanOptions);
            console.log(chalk.green('\n✨ Done.'));
            process.exit(0);

        } catch (error: any) {
            console.error(chalk.red('\n❌ Scan failed:'), error.message);
            if (error.message?.includes('32 bytes')) {
                console.error('💡 Viewing key (nk) must be exactly 32 bytes.');
            }
            process.exit(1);
        }
    });

// ────────────────────────────────────────────────────────────
// Help & Version
// ────────────────────────────────────────────────────────────
cli.help((sections) => {
    // Add environment variable info to help output
    sections.push({
        title: 'Environment Variables',
        body: [
            '  SOLANA_RPC_URL   Solana RPC endpoint (default: Helius devnet)',
            '  KEYPAIR_PATH     Default path to signer keypair JSON',
        ].join('\n'),
    });
    return sections;
});

cli.version('0.1.0');

// ────────────────────────────────────────────────────────────
// Run CLI
// ────────────────────────────────────────────────────────────
cli.parse();