#!/usr/bin/env node
import cac from 'cac';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import path from 'path';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';

// Import all command functions
import { createMultisig } from './commands/createMultisig';
import { publicDeposit } from './commands/publicDeposit';
import { CloakDeposit } from './commands/cloakDeposit';
import { PrivateDeposit } from './commands/privateDeposit';
import { createTransferProposal } from './commands/createTransferProposal';
import { approveProposal } from './commands/approveProposal';
import { executeProposal } from './commands/executeProposal';
import { createPrivateTransferProposal } from './commands/createPrivateTransferProposal.ts';

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

/**
 * Safe BigInt parsing: handles decimal, hex (0x...), and trailing 'n'
 */
function parseBigInt(value: string): bigint {
    const cleaned = value.trim().replace(/^0x/, '').replace(/n$/, '');
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
            const amount = options.amount;
            if (!amount || amount <= 0) throw new Error('Valid --amount is required');
            if (!options.treasuryId) throw new Error('--treasury-id <bigint> is required');
            if (!options.utxo) throw new Error('--utxo <base58> is required');

            const treasuryId = parseBigInt(options.treasuryId);
            const signer = loadKeypair(options.keypair);

            console.log(chalk.blue('Signer:'), signer.publicKey.toBase58());
            console.log(chalk.blue('Treasury ID:'), treasuryId.toString());
            console.log(chalk.blue('Amount:'), amount, 'lamports');
            console.log(chalk.yellow('⏳ Processing private transfer...'));

            await PrivateDeposit(BigInt(amount), signer, treasuryId, options.utxo);
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
    .option('--multisig <address>', 'Multisig account address')
    .option('--commitment <value>', 'UTXO commitment (decimal or 0x hex)')
    .option('--target <value>', 'Recipient public key (base58 or bigint)')
    .option('--amount <value>', 'Amount in lamports')
    .action(async (options) => {
        try {
            // Parse BigInt-safe inputs
            const commitment = parseBigInt(options.commitment);
            const amountLamports = parseBigInt(options.amount);
            const multisig = new PublicKey(options.multisig);
            const recipient = parsePublicKey(options.target);
            const creator = loadKeypair(options.keypair);
            const connection = getDevnetConnection();

            console.log(chalk.blue('Creator:'), creator.publicKey.toBase58());
            console.log(chalk.blue('Multisig:'), multisig.toBase58());
            console.log(chalk.blue('Recipient:'), recipient.toBase58());
            console.log(chalk.blue('Amount:'), amountLamports.toString(), 'lamports');
            console.log(chalk.blue('Commitment:'), '0x' + commitment.toString(16).slice(0, 16) + '...');
            console.log(chalk.yellow('⏳ Creating private transfer proposal...'));

            await createPrivateTransferProposal(
                commitment,
                creator,
                multisig,
                recipient,
                amountLamports,
                connection
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