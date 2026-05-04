#!/usr/bin/env node
import cac from 'cac';
import chalk from 'chalk';
import { request, Agent } from 'undici';
import { readFileSync } from 'fs';
import path from 'path';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { executePrivateProposal } from './commands/executePrivateProposal';

// Import all command functions
import { createMultisig } from './commands/createMultisig';
import { publicDeposit } from './commands/publicDeposit';
import { CloakDeposit } from './commands/cloakDeposit';
import { PrivateDeposit } from './commands/privateDeposit';
import { createTransferProposal } from './commands/createTransferProposal';
import { approveProposal } from './commands/approveProposal';
import { executeProposal } from './commands/executeProposal';
import { createPrivateTransferProposal } from './commands/createPrivateTransferProposal.ts';
import { fetchAndDecryptShare } from './shareCrypto';
function rawArg(flag: string): string | undefined {
    const idx = process.argv.indexOf(flag)
    return idx !== -1 ? process.argv[idx + 1] : undefined
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

/**
 * Safe BigInt parsing: handles decimal, hex (0x...), and trailing 'n'
 */
/**
 * Safe BigInt parsing: handles decimal, hex (0x...), trailing 'n', or already-parsed values
 */
function parseBigInt(value: string | number | bigint): bigint {
    // If already a bigint, return as-is
    if (typeof value === 'bigint') return value;

    // If a number, warn about precision loss (shouldn't happen with {type: String})
    if (typeof value === 'number') {
        console.warn('⚠️ Warning: value was parsed as Number - may lose precision');
        return BigInt(Math.round(value));
    }

    // Handle string input
    const cleaned = String(value).trim().replace(/^0x/, '').replace(/n$/, '');

    // Validate it's not empty
    if (!cleaned) {
        throw new Error('Cannot parse empty value as BigInt');
    }

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
 * Load keypair from JSON file
 */
function loadKeypair(keypairPath: string): Keypair {
    const resolved = path.resolve(keypairPath);
    return Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(readFileSync(resolved, 'utf8')))
    );
}

/**
 * Default Devnet connection
 */
function getDevnetConnection(): Connection {
    return new Connection('https://api.devnet.solana.com', 'confirmed');
}

// ────────────────────────────────────────────────────────────
// CLI Setup
// ────────────────────────────────────────────────────────────

const cli = cac('fortisign');
// ────────────────────────────────────────────────────────────
// CLI Command: submit_share
// ────────────────────────────────────────────────────────────
cli
    .command('submit_share', 'Fetch, decrypt, and submit your Shamir share to the collector')
    .option('--keypair <path>', 'Path to YOUR member keypair JSON (for decryption)', {
        default: '/home/mubariz/.config/solana/id.json'
    })
    .option('--multisig <address>', 'Multisig account address (base58)')
    .option('--collector-url <url>', 'Share collector endpoint', {
        default: 'https://localhost:3456/api/submit-share'
    })
    .option('--insecure', 'Allow self-signed HTTPS certificates (for local testing)', { default: false })
    .option('--timeout <ms>', 'Request timeout in milliseconds', { type: Number, default: 30000 })
    .action(async (options) => {
        try {
            // 1. Validate inputs
            if (!options.multisig) throw new Error('--multisig <address> is required');
            if (!options.keypair) throw new Error('--keypair <path> is required');

            const multisigAddress = new PublicKey(options.multisig);
            const memberKeypair = loadKeypair(options.keypair);
            const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

            console.log(chalk.blue('Member:'), memberKeypair.publicKey.toBase58());
            console.log(chalk.blue('Multisig:'), multisigAddress.toBase58());
            console.log(chalk.blue('Collector URL:'), options.collectorUrl);
            console.log(chalk.yellow('🔐 Fetching encrypted share from on-chain...'));

            // 2. Fetch and decrypt share
            const decryptedShare = await fetchAndDecryptShare(
                multisigAddress,
                memberKeypair,
                connection
            );

            console.log(chalk.green('✅ Share decrypted successfully'));
            console.log('Decrypted share (first 8 bytes, hex):',
                Buffer.from(decryptedShare.slice(0, 8)).toString('hex') + '...');

            // 3. Submit to collector server using undici (supports custom TLS)
            console.log(chalk.yellow('📤 Submitting share to collector...'));

            const requestBody = JSON.stringify({
                memberPubkey: memberKeypair.publicKey.toBase58(),
                decryptedShare: Array.from(decryptedShare),
                timestamp: Date.now(),
            });

            // Configure dispatcher for insecure connections if needed
            const dispatcher = options.insecure
                ? new Agent({
                    connect: {
                        rejectUnauthorized: false, // Skip TLS verification for local testing
                    },
                })
                : undefined;

            const { statusCode, body } = await request(options.collectorUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(requestBody).toString(),
                },
                body: requestBody,
                dispatcher, // Apply custom agent if --insecure flag is set
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
                console.error('💡 Try: npx tsx src/index.ts execute_private_proposal ... (in another terminal)');
            } else if (error.code === 'ERR_TLS_CERT_ALTNAME_INVALID' || error.code === 'DEPTH_ZERO_SELF_SIGNED_CERT') {
                console.error('💡 TLS certificate error. Ensure --insecure flag is set for self-signed certs.');
            } else if (error.name === 'TimeoutError' || error.message?.includes('timeout')) {
                console.error('💡 Request timed out. Increase --timeout or check network connectivity.');
            }

            process.exit(1);
        }
    });
// ────────────────────────────────────────────────────────────
// CLI Command: execute_private_proposal (Simplified)
// ────────────────────────────────────────────────────────────
cli
    .command('execute_private_proposal', 'Execute an approved private Cloak proposal')
    .option('--keypair <path>', 'Path to executing member keypair JSON', {
        default: '/home/mubariz/.config/solana/id.json'
    })
    .option('--multisig <address>', 'Multisig account address (base58)')
    // ✅ FIX: Force string type to prevent Number coercion for BigInt
    .option('--proposal-number <value>', 'Proposal number to execute (decimal or 0x hex)', { type: String })
    // ✅ UTXO file option (one Base58-encoded UTXO per line)
    .option('--utxo-file <path>', 'Path to file with Base58 UTXOs (one per line)', {
        default: './multisig_utxo_logs.txt'
    })
    // Optional: DAO DB for blinding factor lookup (if not in UTXO file)
    .option('--dao-db <path>', 'Path to local DAO UTXO database JSON', {
        default: './dao_utxo_db.json'
    })
    // Optional: Override hardcoded treasury private key for testing
    .option('--treasury-key <value>', 'Treasury private key (bigint, for testing)', { type: String })
    // Optional: Cloak program ID override
    .option('--cloak-program <address>', 'Cloak program ID (base58)')
    .action(async (options) => {
        try {
            // 1. Validate required inputs
            if (!options.multisig) throw new Error('--multisig <address> is required');
            if (!options.proposalNumber) throw new Error('--proposal-number <value> is required');

            // 2. Parse inputs safely
            const multisig = new PublicKey(options.multisig);
            const proposalNumber = parseBigInt(options.proposalNumber);
            const creator = loadKeypair(options.keypair);

            // Optional: parse treasury private key if provided
            const treasuryPrivateKey = options.treasuryKey
                ? parseBigInt(options.treasuryKey)
                : undefined;

            // Optional: parse Cloak program ID if provided
            const cloakProgramId = options.cloakProgram
                ? new PublicKey(options.cloakProgram)
                : undefined;

            console.log(chalk.blue('Executing Member:'), creator.publicKey.toBase58());
            console.log(chalk.blue('Multisig:'), multisig.toBase58());
            console.log(chalk.blue('Proposal Number:'), proposalNumber.toString());
            console.log(chalk.blue('UTXO File:'), options.utxoFile);
            console.log(chalk.yellow('⏳ Executing private transfer proposal...'));

            // 3. Execute the proposal with simplified flow
            const result = await executePrivateProposal(
                creator,
                multisig,
                proposalNumber,
                {
                    treasuryPrivateKey, // undefined = use hardcoded default
                    cloakProgramId,
                }
            );

        } catch (error: any) {
            console.error(chalk.red('❌ Execution Failed:'), error.message);

            if (error.logs && Array.isArray(error.logs)) {
                console.error('📜 Program Logs:');
                error.logs.forEach((log: string) => console.error('  ', log));
            }

            process.exit(1);
        }
    });
// --- create_multisig ---
cli
    .command('create_multisig', 'Create a new multisig configuration')
    .option('--addresses <addresses>', 'Space-separated list of public keys')
    .option('--threshold <threshold>', 'Number of required signatures', { type: Number })
    .action(async (options) => {
        try {
            const creator = loadKeypair('/home/mubariz/.config/solana/id.json');

            let rawAddresses = options.addresses;
            if (typeof rawAddresses === 'string') {
                rawAddresses = rawAddresses.split(' ').filter(Boolean);
            }
            const addresses = Array.isArray(rawAddresses)
                ? rawAddresses.map((a: any) => String(a).trim()).filter(Boolean)
                : [];

            if (addresses.length === 0) throw new Error('At least one address is required');

            const members = addresses.map((a: string) => {
                try { return new PublicKey(a); }
                catch (e: any) { throw new Error(`Invalid public key: "${a}". ${e.message}`); }
            });

            const threshold = options.threshold;
            if (!threshold || threshold < 1 || threshold > members.length) {
                throw new Error(`Threshold must be between 1 and ${members.length}`);
            }

            await createMultisig(members, threshold, creator.publicKey, creator);
            console.log(chalk.green('✅ Multisig Created!'));

        } catch (error: any) {
            console.error(chalk.red('❌ Error:'), error.message);
            process.exit(1);
        }
    });

// --- public_deposit ---
cli
    .command('public_deposit', 'Deposit SOL into a public treasury')
    .option('--keypair <path>', 'Path to depositor keypair JSON', { default: '/home/mubariz/.config/solana/id.json' })
    .option('--amount <lamports>', 'Amount to deposit in lamports', { type: Number })
    .option('--multisig <address>', 'Multisig account address (required)')
    .action(async (options) => {
        try {
            const amount = options.amount;
            if (!amount || amount <= 0) throw new Error('Valid --amount (in lamports) is required');
            if (!options.multisig) throw new Error('--multisig <address> is required');

            const depositor = loadKeypair(options.keypair);
            const multisigPubkey = new PublicKey(options.multisig);
            const NATIVE_SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

            console.log(chalk.blue('Depositor:'), depositor.publicKey.toBase58());
            console.log(chalk.blue('Amount:'), amount, 'lamports');

            await publicDeposit(depositor, BigInt(amount), NATIVE_SOL_MINT, multisigPubkey);
            console.log(chalk.green('✅ Public Deposit Completed!'));

        } catch (error: any) {
            console.error(chalk.red('❌ Error:'), error.message);
            process.exit(1);
        }
    });

// --- cloak_deposit ---
cli
    .command('cloak_deposit', 'Deposit SOL into Cloak Protocol (Private)')
    .option('--keypair <path>', 'Path to signer keypair JSON', { default: '/home/mubariz/.config/solana/id.json' })
    .option('--amount <lamports>', 'Amount to deposit in lamports', { type: Number })
    .action(async (options) => {
        try {
            const amount = options.amount;
            if (!amount || amount <= 0) throw new Error('Valid --amount (in lamports) is required');

            const signer = loadKeypair(options.keypair);
            console.log(chalk.blue('Signer:'), signer.publicKey.toBase58());
            console.log(chalk.blue('Amount:'), amount, 'lamports');
            console.log(chalk.yellow('⏳ Processing private deposit...'));

            await CloakDeposit(BigInt(amount), signer);
            console.log(chalk.green('✅ Cloak Deposit Completed!'));

        } catch (error: any) {
            console.error(chalk.red('❌ Error:'), error.message);
            process.exit(1);
        }
    });

// --- private_deposit ---
cli
    .command('private_deposit', 'Transfer from Private UTXO to Multisig Treasury')
    .option('--keypair <path>', 'Path to signer keypair JSON', { default: '/home/mubariz/.config/solana/id.json' })
    .option('--amount <lamports>', 'Amount to transfer in lamports', { type: Number })
    .option('--treasury-id <id>', 'Treasury ID (BigInt) to deposit into')
    .option('--utxo <base58>', 'Your existing Private UTXO (Base58) to spend')
    .action(async (options) => {
        try {
            const treasuryidStr = rawArg('--treasury-id');
            if (!treasuryidStr) throw new Error('--treasury-id <bigint> is required');
            const treasuryid = BigInt(treasuryidStr)
            const amount = options.amount;
            if (!amount || amount <= 0) throw new Error('Valid --amount is required');

            if (!options.utxo) throw new Error('--utxo <base58> is required');


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

// --- create_transfer_proposal ---
cli
    .command('create_transfer_proposal', 'Create a public transfer proposal for multisig')
    .option('--keypair <path>', 'Path to creator keypair JSON', { default: '/home/mubariz/.config/solana/id.json' })
    .option('--multisig <address>', 'Multisig account address')
    .option('--target <address>', 'Transfer recipient address')
    .option('--amount <lamports>', 'Amount in lamports', { type: Number })
    .action(async (options) => {
        try {
            const multisig = new PublicKey(options.multisig);
            const target = new PublicKey(options.target);
            const amount = BigInt(options.amount);
            const creator = loadKeypair(options.keypair);

            console.log(chalk.yellow('Creating transfer proposal...'));
            await createTransferProposal(creator, multisig, target, amount);
            console.log(chalk.green('✅ Proposal Created!'));

        } catch (error: any) {
            console.error(chalk.red('❌ Error:'), error.message);
            process.exit(1);
        }
    });

// --- approve_proposal ---
cli
    .command('approve_proposal', 'Approve a multisig proposal as a member')
    .option('--keypair <path>', 'Path to member keypair JSON', { default: '/home/mubariz/.config/solana/id.json' })
    .option('--multisig <address>', 'Multisig account address')
    .option('--proposal <number>', 'Proposal number to approve')
    .action(async (options) => {
        try {
            if (!options.multisig) throw new Error('--multisig is required');
            if (!options.proposal) throw new Error('--proposal is required');

            const multisigPubkey = new PublicKey(options.multisig);
            const proposalNumber = BigInt(options.proposal);
            const member = loadKeypair(options.keypair);
            const connection = getDevnetConnection();

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

// --- execute_proposal ---
cli
    .command('execute_proposal', 'Execute an approved multisig proposal')
    .option('--keypair <path>', 'Path to member keypair JSON', { default: '/home/mubariz/.config/solana/id.json' })
    .option('--multisig <address>', 'Multisig account address')
    .option('--proposal-number <number>', 'Proposal number (transaction index) to execute', { type: Number })
    .action(async (options) => {
        try {
            if (!options.multisig) throw new Error('--multisig is required');
            if (!options.proposalNumber || options.proposalNumber < 0) {
                throw new Error('--proposal-number <number> is required (>= 0)');
            }

            const multisigPubkey = new PublicKey(options.multisig);
            const proposalNumber = BigInt(options.proposalNumber);
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

// --- create_private_transfer_proposal (BigInt-safe) ---
cli
    .command('create_private_transfer_proposal', 'Create a private Cloak transfer proposal')
    .option('--keypair <path>', 'Path to creator keypair JSON', { default: '/home/mubariz/.config/solana/id.json' })
    .option('--multisig <address>', 'Multisig account address (base58)')
    // ✅ FIX: Force string type to preserve full precision
    .option('--commitment <value>', 'UTXO commitment (decimal or 0x hex)', { type: String })
    .option('--target <value>', 'Recipient public key (base58 or bigint)')
    .option('--amount <value>', 'Amount in lamports', { type: String })
    .action(async (options) => {
        try {

            // ✅ read directly from process.argv — never touched by CLI framework
            const commitmentStr = rawArg('--commitment')
            const amountStr = rawArg('--amount')

            if (!commitmentStr) throw new Error('--commitment is required')
            if (!amountStr) throw new Error('--amount is required')

            // now safe — these are raw strings
            const commitment = BigInt(commitmentStr)
            const amount = BigInt(amountStr)

            // these are fine as-is — pubkeys are strings, no precision issue
            const multisig = new PublicKey(options.multisig)
            const recipient = new PublicKey(options.target)
            const creator = loadKeypair(options.keypair)


            console.log(chalk.blue('Creator:'), creator.publicKey.toBase58());
            console.log(chalk.blue('Multisig:'), multisig.toBase58());
            console.log(chalk.blue('Recipient:'), recipient.toBase58());
            console.log(chalk.blue('Amount:'), amount.toString(), 'lamports');
            console.log(chalk.blue('Commitment:'), '0x' + commitment.toString(16).slice(0, 16) + '...');
            console.log(chalk.yellow('⏳ Creating private transfer proposal...'));

            await createPrivateTransferProposal(
                commitment,
                creator,
                multisig,
                recipient,
                amount,

            );

            console.log(chalk.green('✅ Private Proposal Created!'));

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
// Help & Version
// ────────────────────────────────────────────────────────────

cli.help();
cli.version('1.0.0');
cli.parse();