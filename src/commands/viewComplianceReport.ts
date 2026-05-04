// src/commands/scan-compliance.ts
import { Connection } from '@solana/web3.js';
import bs58 from 'bs58';
import chalk from 'chalk';
import {
    scanTransactions,
    toComplianceReport,
    formatComplianceCsv,
    CLOAK_PROGRAM_ID,
} from '@cloak.dev/sdk-devnet';
import { writeFileSync } from 'fs';

export interface ScanComplianceOptions {
    viewingKey: string;           // Base58-encoded nk (32 bytes)
    rpcUrl?: string;              // Solana RPC URL
    limit?: number;               // Max transactions to scan
}

export async function scanCompliance(options: ScanComplianceOptions) {
    try {
        // 1. Validate and decode viewing key
        if (!options.viewingKey) {
            throw new Error('viewingKey is required');
        }

        let viewingKeyNk: Uint8Array;
        try {
            const decoded = bs58.decode(options.viewingKey);
            viewingKeyNk = Uint8Array.from(decoded);
            console.log("viewing key raw: ", viewingKeyNk);


        } catch (err) {
            throw new Error(`Invalid viewing key (must be base58): ${err.message}`);
        }

        // 2. Parse date filters
        const parseDate = (val?: string): number | undefined => {
            if (!val) return undefined;
            if (/^\d+$/.test(val)) return parseInt(val, 10); // Unix ms
            return new Date(val).getTime(); // ISO string
        };

        // 3. Setup connection
        const connection = new Connection(
            options.rpcUrl || 'https://api.devnet.solana.com',
            'confirmed'
        );


        console.log(chalk.yellow('🔍 Scanning Cloak transactions...'));
        console.log(chalk.blue('Viewing Key:'), options.viewingKey.slice(0, 8) + '...');


        // 4. Scan transactions
        const scanResult = await scanTransactions({
            connection,
            programId: CLOAK_PROGRAM_ID,
            viewingKeyNk,
            limit: options.limit,
            onProgress: (processed, total) => {
                process.stdout.write(
                    `\r📊 Progress: ${processed}/${total || '∞'} transactions`
                );
            },
            onStatus: (status) => {
                console.log(chalk.dim(`   ${status}`));
            },
        });
        console.log(); // Newline after progress

        // 5. Convert to compliance report
        const report = toComplianceReport(scanResult);
        console.log(report);
        // 6. Display summary
        console.log(chalk.green('\n✅ Scan complete!'));
        console.log(chalk.blue('Transactions found:'), report.transactions.length);
        console.log(chalk.blue('Summary:'));
        console.log(`  • Deposits:    ${report.summary.totalDeposits.toLocaleString()} lamports`);
        console.log(`  • Withdrawals: ${report.summary.totalWithdrawals.toLocaleString()} lamports`);
        console.log(`  • Fees:        ${report.summary.totalFees.toLocaleString()} lamports`);
        console.log(`  • Net Change:  ${report.summary.netChange.toLocaleString()} lamports`);
        console.log(`  • Final Balance: ${report.summary.finalBalance.toLocaleString()} lamports`);



        // 8. Return for further processing
        return {
            report,
            lastSignature: scanResult.lastSignature, // For incremental scans
            rpcCallsMade: scanResult.rpcCallsMade,
        };

    } catch (error: any) {
        console.error(chalk.red('❌ Compliance scan failed:'), error.message);

        // Helpful hints for common errors
        if (error.message.includes('32 bytes')) {
            console.error('💡 Hint: Viewing key (nk) must be exactly 32 bytes');
        } else if (error.message.includes('base58')) {
            console.error('💡 Hint: Viewing key must be valid base58 encoding');
        } else if (error.message.includes('not found')) {
            console.error('💡 Hint: Check your RPC URL and program ID');
        }

        throw error;
    }
}