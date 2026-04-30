#!/usr/bin/env node
import cac from 'cac';
import chalk from 'chalk';
import { createMultisig } from './commands/createMultisig';
import { executeProposal } from './commands/executeProposal';
// Import the new deposit function (you will need to create this in your commands folder)
import { approveProposal } from './commands/approveProposal';
import { PrivateDeposit } from './commands/privateDeposit';
import { publicDeposit } from './commands/publicDeposit';
import { CloakDeposit } from './commands/cloakDeposit'; // Import the new function
import { createTransferProposal } from './commands/createTransferProposal';
import { PublicKey, Keypair, Connection } from '@solana/web3.js';
import { readFileSync } from "fs";
import {
    appendTransactionMessageInstruction,
    createTransactionMessage,
    generateKeyPairSigner,
    lamports,
    pipe,
    setTransactionMessageFeePayerSigner,
    setTransactionMessageLifetimeUsingBlockhash,
    signTransactionMessageWithSigners,
    createKeyPairSignerFromBytes, TransactionSigner
} from "@solana/kit";
import path from "path";

const cli = cac('fortisign');

// --- Existing Command: create_multisig ---
cli
    .command('create_multisig', 'Create a new multisig configuration')
    .option('--addresses <addresses>', 'Space-separated list of public keys')
    .option('--threshold <threshold>', 'Number of required signatures', { type: Number })
    .action(async (options) => {
        try {
            const creator = Keypair.fromSecretKey(
                Uint8Array.from(JSON.parse(readFileSync("/home/mubariz/.config/solana/id.json", "utf8")))
            );

            // 1. Parse Input
            let rawAddresses = options.addresses;
            if (typeof rawAddresses === 'string') {
                rawAddresses = rawAddresses.split(' ').filter(Boolean);
            }

            const addresses = Array.isArray(rawAddresses)
                ? rawAddresses.map((a: any) => String(a).trim()).filter(Boolean)
                : [];

            if (addresses.length === 0) {
                throw new Error('At least one address is required');
            }

            // 2. Convert to PublicKey with validation
            const members: PublicKey[] = addresses.map(a => {
                try {
                    return new PublicKey(a);
                } catch (e: any) {
                    throw new Error(`Invalid public key: "${a}". ${e.message}`);
                }
            });

            const threshold = options.threshold;
            if (!threshold || threshold < 1 || threshold > members.length) {
                throw new Error(`Threshold must be between 1 and ${members.length}`);
            }

            // 3. Call the pure function
            // Note: Ensure createMultisigInstruction returns the result so you can log it/send it
            const result = await createMultisig(
                members,
                threshold,
                creator.publicKey,
                creator
            );

            console.log(chalk.green('✅ Multisig Instruction Created!'));

        } catch (error: any) {
            console.error(chalk.red('❌ Error:'), error.message);
            process.exit(1);
        }
    });

cli
    .command('public_deposit', 'Deposit SOL into a public treasury')
    .option('--keypair <path>', 'Path to the depositor keypair file (JSON)', { default: "/home/mubariz/.config/solana/id.json" })
    .option('--amount <lamports>', 'Amount to deposit in lamports', { type: Number })
    .option('--multisig <address>', 'The base Public Key of the Multisig Configuration') // Added this required arg
    .action(async (options) => {
        try {
            // 1. Validate Amount
            const amount = options.amount;
            if (!amount || amount <= 0) {
                throw new Error('Valid --amount (in lamports) is required');
            }

            // 2. Validate Multisig Address
            if (!options.multisig) {
                throw new Error('--multisig <address> is required');
            }
            const multisigPubkey = new PublicKey(options.multisig);

            // 3. Load Deposition Keypair
            const keypairPath = path.resolve(options.keypair);
            console.log(chalk.gray(`Loading keypair from: ${keypairPath}`));

            let depositor: TransactionSigner;
            try {
                const fileContent = readFileSync(keypairPath, "utf8");
                const secretKey = Uint8Array.from(JSON.parse(fileContent));
                depositor = await createKeyPairSignerFromBytes(secretKey);
            } catch (e) {
                throw new Error(`Failed to load keypair at ${keypairPath}. Ensure it is a valid Solana JSON keypair.`);
            }

            console.log(chalk.blue('Depositor:'), depositor.address);
            console.log(chalk.blue('Amount (Lamports):'), amount);

            // 4. Call the Deposit Function
            // Pass the Legacy Keypair directly

            await publicDeposit(
                depositor,
                BigInt(amount),
                new PublicKey("So11111111111111111111111111111111111111112"), // Native SOL Mint (or unused placeholder)
                multisigPubkey
            );


        } catch (error: any) {
            console.error(chalk.red('❌ Error:'), error.message);
            process.exit(1);
        }
    });
cli
    .command('cloak_deposit', 'Deposit SOL into Cloak Protocol (Private)')
    .option('--keypair <path>', 'Path to the signer keypair file (JSON)', { default: "/home/mubariz/.config/solana/id.json" })
    .option('--amount <lamports>', 'Amount to deposit in lamports', { type: Number })
    .action(async (options) => {
        try {
            // 1. Validate Amount
            const amount = options.amount;
            if (!amount || amount <= 0) {
                throw new Error('Valid --amount (in lamports) is required');
            }

            // 2. Load Signer Keypair
            const keypairPath = path.resolve(options.keypair);
            console.log(chalk.gray(`Loading keypair from: ${keypairPath}`));

            let signer: Keypair;
            try {
                const fileContent = readFileSync(keypairPath, "utf8");
                const secretKey = Uint8Array.from(JSON.parse(fileContent));
                signer = Keypair.fromSecretKey(secretKey);
            } catch (e) {
                throw new Error(`Failed to load keypair at ${keypairPath}. Ensure it is a valid Solana JSON keypair.`);
            }

            console.log(chalk.blue('Signer:'), signer.publicKey.toBase58());
            console.log(chalk.blue('Amount (Lamports):'), amount);
            console.log(chalk.yellow('⏳ Processing private deposit... this may take a moment.'));

            // 3. Call CloakDeposit
            // Note: CloakDeposit is async and handles its own connection/transaction logic
            await CloakDeposit(BigInt(amount), signer);

            console.log(chalk.green('✅ Cloak Deposit Process Completed!'));

        } catch (error: any) {
            console.error(chalk.red('❌ Error:'), error.message);
            // Optional: log stack trace for debugging complex async errors
            // console.error(error.stack);
            process.exit(1);
        }
    });
// --- Updated Command: private_deposit ---
cli
    .command('private_deposit', 'Transfer from Private UTXO to Multisig Treasury')
    .option('--keypair <path>', 'Path to the signer keypair file (JSON)', { default: "/home/mubariz/.config/solana/id.json" })
    .option('--amount <lamports>', 'Amount to transfer in lamports', { type: Number })
    .option('--treasury-id <id>', 'The Treasury ID (BigInt) to deposit into') // Changed name and description
    .option('--utxo <base58>', 'Your existing Private UTXO (Base58 string) to spend')
    .action(async (options) => {
        try {
            // 1. Validate Inputs
            const amount = options.amount;
            if (!amount || amount <= 0) throw new Error('Valid --amount (in lamports) is required');

            if (!options.treasuryId) throw new Error('--treasury-id <bigint> is required');

            // Parse the BigInt (remove 'n' if user pasted it, though JS handles it usually)
            const treasuryId = BigInt(options.treasuryId);

            if (!options.utxo) throw new Error('--utxo <base58> is required');

            // 2. Load Signer
            const keypairPath = path.resolve(options.keypair);
            const signer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keypairPath, "utf8"))));

            console.log(chalk.blue('Signer:'), signer.publicKey.toBase58());
            console.log(chalk.blue('Treasury ID (BigInt):'), treasuryId.toString());
            console.log(chalk.blue('Amount (Lamports):'), amount);
            console.log(chalk.yellow('⏳ Processing private transfer...'));

            // 3. Call PrivateDeposit
            // Note: We are passing treasuryId as bigint now
            await PrivateDeposit(
                BigInt(amount),
                signer,
                treasuryId, // Pass as bigint
                options.utxo
            );

            console.log(chalk.green('✅ Private Transfer Completed!'));

        } catch (error: any) {
            console.error(chalk.red('❌ Error:'), error.message);
            process.exit(1);
        }
    });
cli
    .command('create_transfer_proposal', 'Create a transfer proposal for multisig')
    .option('--keypair <path>', 'Path to creator keypair JSON')
    .option('--multisig <address>', 'Multisig account address')
    .option('--target <address>', 'Transfer recipient address')
    .option('--amount <lamports>', 'Amount in lamports', { type: Number })
    .action(async (options) => {
        try {
            const multisig = new PublicKey(options.multisig);
            const target = new PublicKey(options.target);
            const amount = BigInt(options.amount);


            console.log(chalk.yellow('Creating transfer proposal...'));
            const creator = Keypair.fromSecretKey(
                Uint8Array.from(JSON.parse(readFileSync(options.keypair, "utf8")))
            );
            await createTransferProposal(
                creator,
                multisig,
                target,
                amount,
            );

            console.log(chalk.green('✅ Done!'));

        } catch (error: any) {
            console.error(chalk.red('❌ Error:'), error.message);
            process.exit(1);
        }
    });
cli
    .command('approve_proposal', 'Approve a multisig proposal as a member')
    .option('--keypair <path>', 'Path to the member keypair JSON', { default: '/home/mubariz/.config/solana/id.json' })
    .option('--multisig <address>', 'The Multisig Account Address')
    .option('--proposal <number>', 'The Proposal  Number to approve')
    .action(async (options) => {
        try {
            // 1. Validate Inputs
            if (!options.multisig) throw new Error('--multisig is required');
            if (!options.proposal) throw new Error('--proposal is required');

            const multisigPubkey = new PublicKey(options.multisig);
            const proposalNumber = BigInt(options.proposal);

            // 2. Load Member Keypair
            const keypairPath = path.resolve(options.keypair);
            const member = Keypair.fromSecretKey(
                Uint8Array.from(JSON.parse(readFileSync(keypairPath, 'utf8')))
            );

            // 3. Setup Connection
            const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

            console.log(chalk.blue('Member:'), member.publicKey.toBase58());
            console.log(chalk.blue('Multisig:'), multisigPubkey.toBase58());
            console.log(chalk.yellow('⏳ Processing approval...'));

            // 4. Call approveProposal
            await approveProposal(
                member,
                multisigPubkey,
                proposalNumber,
                connection
            );

            console.log(chalk.green('✅ Approval Process Completed!'));

        } catch (error: any) {
            console.error(chalk.red('❌ Error:'), error.message);
            process.exit(1);
        }
    });
cli
    .command('execute_proposal', 'Execute an approved multisig proposal')
    .option('--keypair <path>', 'Path to the member keypair JSON', {
        default: '/home/mubariz/.config/solana/id.json'
    })
    .option('--multisig <address>', 'The Multisig Account Address')
    .option('--proposal-number <number>', 'The Proposal Number (transaction index) to execute', {
        type: Number
    })
    .action(async (options) => {
        try {
            // 1. Validate Inputs
            if (!options.multisig) {
                throw new Error('--multisig <address> is required');
            }
            if (!options.proposalNumber || options.proposalNumber < 0) {
                throw new Error('--proposal-number <number> is required (must be >= 0)');
            }

            const multisigPubkey = new PublicKey(options.multisig);
            const proposalNumber = BigInt(options.proposalNumber);

            // 2. Load Member Keypair
            const keypairPath = path.resolve(options.keypair);
            const member = Keypair.fromSecretKey(
                Uint8Array.from(JSON.parse(readFileSync(keypairPath, 'utf8')))
            );

            // 3. Setup Connection


            console.log(chalk.blue('Member:'), member.publicKey.toBase58());
            console.log(chalk.blue('Multisig:'), multisigPubkey.toBase58());
            console.log(chalk.blue('Proposal Number:'), proposalNumber.toString());
            console.log(chalk.yellow('⏳ Executing proposal...'));

            // 4. Call executeProposal
            await executeProposal(
                member,
                multisigPubkey,
                proposalNumber,
            );

            console.log(chalk.green('✅ Proposal Executed Successfully!'));
            console.log('Proposal Number:', proposalNumber.toString());

        } catch (error: any) {
            console.error(chalk.red('❌ Execution Failed:'), error.message);

            // Show program logs if available
            if (error.logs && Array.isArray(error.logs)) {
                console.error('📜 Program Logs:');
                error.logs.forEach((log: string) => console.error('  ', log));
            }

            process.exit(1);
        }
    });
cli.help();
cli.version('1.0.0');
cli.parse();