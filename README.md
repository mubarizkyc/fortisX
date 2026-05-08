# FortisX
```
In the landscape of Solana multisig wallets, the standard flow has long been: upload proposal data on-chain, vote on it, then execute the stored transaction by invoking the target program. This is the model Fortis originally followed. Then came the Drift Protocol hack ,a wake-up call that major financial decisions shouldn't always be public. Should competitors really see whom a firm is paying, who it's receiving funds from, its asset valuations, token minting activities, or swap strategies? What about decisions to create new liquidity pools on decentralized exchanges? That's when Fortis began exploring privacy-preserving solutions and discovered Cloak. From that insight, we built FortisX: a multisig that extends Fortis with support for Shielded treasury management: Hide asset balances and transaction histories on-chain
Private multi-type, multi-recipient transfers: Send SOL, USDC, or USDT to multiple parties without exposing amounts or addresses
Private asset swaps: Rebalance portfolios or execute trades without revealing intent
Compliance & scoped auditing: Generate full or time-bound, role-specific audit trails via viewing keys
FortisX isn't just a multisig — it's a privacy-first treasury operating system for organizations that need confidentiality without sacrificing accountability
```

## Prerequisites

- Node.js ≥ 18
- Yarn or npm
- A Solana keypair at `~/.config/solana/id.json` (default) or specify `--keypair`

## Installation

```bash
yarn install
```

## Running Commands

```
npx tsx src/index.ts <command> [options]
```

---

## Commands

---

### `create_multisig`
Create a new on-chain multisig configuration.

**Usage**
```
npx tsx src/index.ts create_multisig --members "<pubkey1> <pubkey2> ..." --threshold <number>
```

**Example**
```bash
npx tsx src/index.ts create_multisig \
  --members "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin 4vJ9JU1bJJE96FWSJKvHsmmFADCg4GPZQSgcvoEkmmER" \
  --threshold 2
```

| Flag | Description | Required |
|---|---|---|
| `--members <members>` | Space-separated list of member public keys (base58) | ✅ |
| `--threshold <number>` | Number of required approvals | ✅ |

---

### `public_deposit`
Deposit SOL (in lamports) into the multisig public treasury.

**Usage**
```
npx tsx src/index.ts public_deposit --multisig <address> --amount <lamports> [--keypair <path>]
```

**Example**
```bash
npx tsx src/index.ts public_deposit \
  --multisig 9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin \
  --amount 1000000000
```

| Flag | Description | Default |
|---|---|---|
| `--keypair <path>` | Path to depositor keypair JSON | `~/.config/solana/id.json` |
| `--multisig <address>` | Multisig account address (base58) | ✅ Required |
| `--amount <lamports>` | Amount to deposit in lamports | ✅ Required |

---

### `cloak_deposit`
Deposit SOL into the **Cloak Protocol** to mint a private UTXO.

**Usage**
```
npx tsx src/index.ts cloak_deposit --mint <address> --amount <lamports> [--keypair <path>]
```

**Example**
```bash
npx tsx src/index.ts cloak_deposit \
  --mint So11111111111111111111111111111111111111112 \
  --amount 1000000000
```

| Flag | Description | Default |
|---|---|---|
| `--keypair <path>` | Path to signer keypair JSON | `~/.config/solana/id.json` |
| `--mint <address>` | Asset (mint) address (base58) | ✅ Required |
| `--amount <lamports>` | Amount to deposit in lamports | ✅ Required |

---

### `private_deposit`
Transfer from a private Cloak UTXO into the multisig treasury.

**Usage**
```
npx tsx src/index.ts private_deposit --treasury-id <bigint> --utxo <base58> --amount <lamports> [--keypair <path>]
```

**Example**
```bash
npx tsx src/index.ts private_deposit \
  --treasury-id 42 \
  --utxo 3Fyd4a7cApAf6TcGiDPPTGjGFrNNBHDuLpTG9iQA2cD5 \
  --amount 500000000
```

| Flag | Description | Default |
|---|---|---|
| `--keypair <path>` | Path to signer keypair JSON | `~/.config/solana/id.json` |
| `--treasury-id <id>` | Treasury ID (BigInt) to deposit into | ✅ Required |
| `--utxo <base58>` | Your existing private UTXO (Base58) to spend | ✅ Required |
| `--amount <lamports>` | Amount to transfer in lamports | ✅ Required |

---

### `create_transfer_proposal`
Create a **public** SOL transfer proposal for multisig approval.

**Usage**
```
npx tsx src/index.ts create_transfer_proposal --multisig <address> --target <address> --amount <lamports> [--keypair <path>]
```

**Example**
```bash
npx tsx src/index.ts create_transfer_proposal \
  --multisig 9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin \
  --target 4vJ9JU1bJJE96FWSJKvHsmmFADCg4GPZQSgcvoEkmmER \
  --amount 500000000
```

| Flag | Description | Default |
|---|---|---|
| `--keypair <path>` | Path to creator keypair JSON | `~/.config/solana/id.json` |
| `--multisig <address>` | Multisig account address (base58) | ✅ Required |
| `--target <address>` | Transfer recipient address (base58) | ✅ Required |
| `--amount <lamports>` | Amount in lamports | ✅ Required |

---

### `create_private_transfer_proposal`
Create a **private** Cloak transfer proposal. Supports single and batch payouts.

#### Single payout

**Usage**
```
npx tsx src/index.ts create_private_transfer_proposal \
  --multisig <address> --mint <address> \
  --commitment <bigint|hex> --target <pubkey> --amount <lamports> \
  [--deadline <seconds>] [--keypair <path>]
```

**Example**
```bash
npx tsx src/index.ts create_private_transfer_proposal \
  --multisig 9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin \
  --mint So11111111111111111111111111111111111111112 \
  --commitment 0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b \
  --target 4vJ9JU1bJJE96FWSJKvHsmmFADCg4GPZQSgcvoEkmmER \
  --amount 500000000
```

#### Batch payouts

**Usage**
```
npx tsx src/index.ts create_private_transfer_proposal \
  --multisig <address> --mint <address> \
  --commitments "<c1>,<c2>,..." --targets "<pk1>,<pk2>,..." --amounts "<a1>,<a2>,..." \
  [--deadline <seconds>] [--keypair <path>]
```

**Example**
```bash
npx tsx src/index.ts create_private_transfer_proposal \
  --multisig 9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin \
  --mint So11111111111111111111111111111111111111112 \
  --commitments "0x1a2b3c4d,0x5e6f7a8b,0x9c0d1e2f" \
  --targets "4vJ9JU1bJJE96FWSJKvHsmmFADCg4GPZQSgcvoEkmmER,9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin,3Fyd4a7cApAf6TcGiDPPTGjGFrNNBHDuLpTG9iQA2cD5" \
  --amounts "100000000,200000000,300000000"
```

| Flag | Description | Default |
|---|---|---|
| `--keypair <path>` | Path to creator keypair JSON | `~/.config/solana/id.json` |
| `--multisig <address>` | Multisig account address (base58) | ✅ Required |
| `--mint <address>` | Asset (mint) address (base58) | ✅ Required |
| `--commitments <values>` | UTXO commitments, comma-separated (decimal or 0x hex) | Batch mode |
| `--targets <pubkeys>` | Recipient public keys, comma-separated (base58) | Batch mode |
| `--amounts <values>` | Amounts in lamports, comma-separated | Batch mode |
| `--commitment <value>` | Single UTXO commitment *(legacy)* | Single mode |
| `--target <pubkey>` | Single recipient pubkey *(legacy)* | Single mode |
| `--amount <value>` | Single amount in lamports *(legacy)* | Single mode |
| `--deadline <seconds>` | Voting deadline in seconds | `86400` (1 day) |

> **Note:** All batch arrays (`--commitments`, `--targets`, `--amounts`) must be the same length. Max 255 entries per proposal.

---

### `create_private_swap_proposal`
Create a **private Cloak swap** proposal (token-to-token via a private UTXO).

**Usage**
```
npx tsx src/index.ts create_private_swap_proposal \
  --multisig <address> --mint <source-mint> \
  --commitment <bigint|hex> --amount <input-units> \
  --recipient-ata <pubkey> --target-mint <pubkey> \
  [--deadline <seconds>] [--keypair <path>]
```

**Example**
```bash
npx tsx src/index.ts create_private_swap_proposal \
  --multisig 9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin \
  --mint So11111111111111111111111111111111111111112 \
  --commitment 0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b \
  --amount 1000000000 \
  --recipient-ata 4vJ9JU1bJJE96FWSJKvHsmmFADCg4GPZQSgcvoEkmmER \
  --target-mint EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
```

| Flag | Description | Default |
|---|---|---|
| `--keypair <path>` | Path to creator keypair JSON | `~/.config/solana/id.json` |
| `--multisig <address>` | Multisig account address (base58) | ✅ Required |
| `--mint <pubkey>` | Source token mint (base58) | ✅ Required |
| `--commitment <value>` | UTXO commitment to spend (decimal or 0x hex) | ✅ Required |
| `--amount <value>` | Amount to swap in input token units | ✅ Required |
| `--recipient-ata <pubkey>` | Recipient ATA for the output token (base58) | ✅ Required |
| `--target-mint <pubkey>` | Mint of the token being swapped TO (base58) | ✅ Required |
| `--deadline <seconds>` | Voting deadline in seconds | `86400` (1 day) |

---

### `approve_proposal`
Approve a pending multisig proposal as a member.

**Usage**
```
npx tsx src/index.ts approve_proposal --multisig <address> --proposal <number> [--keypair <path>]
```

**Example**
```bash
npx tsx src/index.ts approve_proposal \
  --multisig 9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin \
  --proposal 0
```

| Flag | Description | Default |
|---|---|---|
| `--keypair <path>` | Path to member keypair JSON | `~/.config/solana/id.json` |
| `--multisig <address>` | Multisig account address (base58) | ✅ Required |
| `--proposal <number>` | Proposal number (transaction index) to approve | ✅ Required |

---

### `execute_proposal`
Execute an approved **public** multisig proposal.

**Usage**
```
npx tsx src/index.ts execute_proposal --multisig <address> --proposal <number> [--keypair <path>]
```

**Example**
```bash
npx tsx src/index.ts execute_proposal \
  --multisig 9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin \
  --proposal 0
```

| Flag | Description | Default |
|---|---|---|
| `--keypair <path>` | Path to member keypair JSON | `~/.config/solana/id.json` |
| `--multisig <address>` | Multisig account address (base58) | ✅ Required |
| `--proposal <number>` | Proposal number (transaction index) to execute | ✅ Required |

---

### `execute_private_proposal`
Execute an approved **private** Cloak proposal. Starts a local share-collector server and waits for members to call `submit_share`.

**Usage**
```
npx tsx src/index.ts execute_private_proposal \
  --multisig <address> --proposal-number <number> \
  [--utxo-file <path>] [--dao-db <path>] [--cloak-program <address>] [--keypair <path>]
```

**Example**
```bash
npx tsx src/index.ts execute_private_proposal \
  --multisig 9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin \
  --proposal-number 0 \
  --utxo-file ./my_utxo_logs.txt
```

| Flag | Description | Default |
|---|---|---|
| `--keypair <path>` | Path to executing member keypair JSON | `~/.config/solana/id.json` |
| `--multisig <address>` | Multisig account address (base58) | ✅ Required |
| `--proposal-number <value>` | Proposal number to execute (decimal or 0x hex) | ✅ Required |
| `--utxo-file <path>` | Path to file with Base58 UTXOs (one per line) | `./multisig_utxo_logs.txt` |
| `--dao-db <path>` | Path to local DAO UTXO database JSON | `./dao_utxo_db.json` |
| `--cloak-program <address>` | Cloak program ID override (base58) | — |

---

### `submit_share`
Fetch, decrypt, and submit your **Shamir share** to the collector server started by `execute_private_proposal`.

**Usage**
```
npx tsx src/index.ts submit_share --multisig <address> [--collector-url <url>] [--keypair <path>] [--insecure] [--timeout <ms>]
```

**Example**
```bash
npx tsx src/index.ts submit_share \
  --multisig 9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin \
  --keypair ~/.config/solana/member2.json
```

| Flag | Description | Default |
|---|---|---|
| `--keypair <path>` | Path to YOUR member keypair JSON (for decryption) | `~/.config/solana/id.json` |
| `--multisig <address>` | Multisig account address (base58) | ✅ Required |
| `--collector-url <url>` | Share collector endpoint URL | `http://localhost:3456/api/submit-share` |
| `--insecure` | Allow self-signed HTTPS certs (local testing) | `false` |
| `--timeout <ms>` | Request timeout in milliseconds | `30000` |

---

### `scan-compliance`
Scan Cloak transaction history for compliance/auditing using a viewing key.

**Usage**
```
npx tsx src/index.ts scan-compliance --viewing-key <base58> [--rpc <url>] [--limit <number>]
```

**Example**
```bash
npx tsx src/index.ts scan-compliance \
  --viewing-key 3Fyd4a7cApAf6TcGiDPPTGjGFrNNBHDuLpTG9iQA2cD5 \
  --limit 100
```

| Flag | Description | Default |
|---|---|---|
| `--viewing-key <key>` | Base58-encoded viewing key (`nk`, 32 bytes) | ✅ Required |
| `--rpc <url>` | Solana RPC URL | Helius Devnet |
| `--limit <number>` | Maximum number of transactions to scan | — |

---

## Typical Workflow

```
1. create_multisig                   → set up the multisig with members & threshold
2. public_deposit                    → fund the public treasury  OR
   cloak_deposit                     → mint a private UTXO via Cloak
   private_deposit                   → move UTXO funds into the multisig treasury
3. create_transfer_proposal          → propose a public transfer  OR
   create_private_transfer_proposal  → propose a private Cloak transfer  OR
   create_private_swap_proposal      → propose a private token swap
4. approve_proposal                  → each required member approves
5. execute_proposal                  → execute a public proposal  OR
   execute_private_proposal          → executor starts collector; members run submit_share
6. scan-compliance                   → audit private transactions with a viewing key
```

---

## License

MIT
