# FortisX 

In the landscape of Solana multisig wallets, the standard flow has long been: upload proposal data on-chain, vote on it, then execute the stored transaction by invoking the target program. This is the model Fortis originally followed. Then came the Drift Protocol hack ,a wake-up call that major financial decisions shouldn't always be public. Should competitors really see whom a firm is paying, who it's receiving funds from, its asset valuations, token minting activities, or swap strategies? What about decisions to create new liquidity pools on decentralized exchanges? That's when Fortis began exploring privacy-preserving solutions and discovered Cloak. From that insight, we built FortisX: a multisig that extends Fortis with support for Shielded treasury management: Hide asset balances and transaction histories on-chain
Private multi-type, multi-recipient transfers: Send SOL, USDC, or USDT to multiple parties without exposing amounts or addresses
Private asset swaps: Rebalance portfolios or execute trades without revealing intent
Compliance & scoped auditing: Generate full or time-bound, role-specific audit trails via viewing keys
FortisX isn't just a multisig — it's a privacy-first treasury operating system for organizations that need confidentiality without sacrificing accountability

## Usage
FortisX application is meant to be used ,theough cli ,currenlty the source code for judging is open source ,while the in production a binary is only distibuted.
All members the are part of multisig ,can use it ,any member can be proposer /executor ,and all members can approve the proposal,the one's not approving the proposal within the dealdine ,will simply be meant as rejection
## Prerequisites

- Node.js ≥ 18
- Yarn or npm
## Setup
set the rpc,and your keypair path
```bash
export SOLANA_RPC_URL=https://api.devnet.solana.com 
export KEYPAIR_PATH  ="PATH_TO_KEYPAIR.json"
```
## Clone

```bash
https://github.com/mubarizkyc/fortisX.git
cd FortisX && alias fortisX='npx tsx src/index.ts'
source ~/.zshrc
# view Options
fortisX --help 
```

## Installation

```bash
yarn install
```

## Running Commands

```
fortisX <command> [options]
```

---

## Commands

---

### `create_multisig`
Create a new on-chain multisig configuration.

**Usage**
```
fortisX create_multisig --members "<pubkey1> <pubkey2> ..." --threshold <number>
```

**Example**
```bash
fortisX create_multisig \
  --members "ap5oPFPVSnxtc8bbvcCeKwy9Xnu5NePhMGzX2hexDVh 44abtGibbueKQDXaw3PG9N1TrqhaF6RMao7jsW7QRC68" \
  --threshold 2
```

| Flag | Description |
|---|---|---|
| `--members <members>` | Space-separated list of member public keys (base58) |
| `--threshold <number>` | Number of required approvals |

**Descreption**
Creates a new multisig account and stores the member list, threshold, and UTXO public key on-chain. The UTXO private key is split via Shamir Secret Sharing; each share is encrypted with the respective member's public key and stored on-chain.

---

### `public_deposit`
Deposit asset into the multisig public treasury.

**Usage**
```
fortisX public_deposit --multisig <address> --amount <lamports> 
```

**Example**
```bash
fortisX public_deposit \
  --multisig  BLUHe8sSDcPBQ5TH6BPJPNZVStqprZpZgg3wK8i4LRho \
  --amount 10000000
```

| Flag | Description |
|---|---|---|
| `--multisig <address>` | Multisig account address (base58) |
| `--amount <lamports>` | Amount to deposit in lamports |

**Descreption**
Deposits into the public treasury (multisig PDA). This commands support SOL; SPL &
Token-2022 tokens can also be deposited by creating an ATA.

---

### `create_transfer_proposal`
Create a **public** SOL transfer proposal for multisig approval.

**Usage**
```
fortisX create_transfer_proposal --multisig <address> --target <address> --amount <lamports>
```

**Example**
```bash
fortisX create_transfer_proposal \
  --multisig  BLUHe8sSDcPBQ5TH6BPJPNZVStqprZpZgg3wK8i4LRho \
  --target ap5oPFPVSnxtc8bbvcCeKwy9Xnu5NePhMGzX2hexDVh \
  --amount 10000000
```

| Flag | Description 
|---|---|
| `--multisig <address>` | Multisig account address (base58) |
| `--target <address>` | Transfer recipient address (base58) |
| `--amount <lamports>` | Amount in lamports |

**Descreption**

This command creates a proposal for a native transfer. FortisX supports all tx types (token transfers, loans, swaps, upgrades, etc.). You just pass the transaction message as a Base58 string; FortisX stores it on-chain and executes it by invoking the target program.

---

### `approve_proposal`
Approve a pending multisig proposal as a member.

**Usage**
```
fortisX approve_proposal --multisig <address> --proposal <number>
```

**Example**
```bash
foritsX approve_proposal \
  --multisig BLUHe8sSDcPBQ5TH6BPJPNZVStqprZpZgg3wK8i4LRho \
  --proposal 1
```

| Flag | Description | Default |
|---|---|---|
| `--keypair <path>` | Path to member keypair JSON | `~/.config/solana/id.json` |
| `--multisig <address>` | Multisig account address (base58) | ✅ Required |
| `--proposal <number>` | Proposal number (transaction index) to approve | ✅ Required |

---

---

### `execute_proposal`
Execute an approved **public** multisig proposal.

**Usage**
```
fortisX execute_proposal --multisig <address> --proposal <number>
```

**Example**
```bash
fortisX execute_proposal \
  --multisig  BLUHe8sSDcPBQ5TH6BPJPNZVStqprZpZgg3wK8i4LRho \
  --proposal 1
```

| Flag | Description |
|---|---|
| `--multisig <address>` | Multisig account address (base58) |
| `--proposal <number>` | Proposal number (transaction index) to execute |

---

### `cloak_deposit`
Deposit into the **Cloak Protocol** to mint a private UTXO.

**Usage**
```
fortisX cloak_deposit --mint <address> --amount <lamports>
```

**Example**
```bash
fortisX cloak_deposit \
  --mint So11111111111111111111111111111111111111112 \
  --amount 10000000
```

| Flag | Description |
|---|---|
| `--mint <address>` | Asset (mint) address (base58) |
| `--amount <lamports>` | Amount to deposit in lamports |


**Descreption**

When depositing any asset into the Cloak pool, you must save your UTXO keypair. The UTXO details will be saved to cloak_deposits.txt. Use the UTXO commitment from this file to access your assets in future transactions.
---

### `private_deposit`
Transfer from a private Cloak UTXO into the multisig treasury.

**Usage**
```
fortisX private_deposit --treasury-id <bigint> --utxo <base58> --amount <lamports>
```

**Example**
```bash
fortisX private_deposit --treasury-id 1273225015818612797192906101562736704378543174907210035582014424758348943475 --amount 10000000 --utxo "EACA7nSL1Dmd8HxG3s6tCPHeFEnoThy61Lv2xTDH28C831Aywzh5NAVjUT7dBtDNuKcvsuStYhwhnCWfFwtDMxnfgzT9HdX2BnHR7YHHXPL8qBBXw5xQisfKtxNScgMdZiaDmmmANHhhCnE9tvPQD3vpus6CBxZrUFc4WS1hccH5K1y"

```

| Flag | Description |
|---|---|
| `--treasury-id <id>` | Treasury ID (BigInt) to deposit into |
| `--utxo <base58>` | Your existing private UTXO (Base58) to spend |
| `--amount <lamports>` | Amount to transfer in lamports |

**Descreption**

private deposit movees ur funds from cloak to a new utxo owned by mutlsig
---

### `create_private_transfer_proposal`
Create a **private** Cloak transfer proposal. Supports single and batch payouts.

#### Single payout

**Usage**
```
fortisX create_private_transfer_proposal \
  --multisig <address> --mint <address> \
  --commitment <bigint> --target <pubkey> --amount <lamports> \
  [--deadline <seconds>]
```

**Example**
```bash
fortisX create_private_transfer_proposal \
  --multisig BLUHe8sSDcPBQ5TH6BPJPNZVStqprZpZgg3wK8i4LRho \
  --mint So11111111111111111111111111111111111111112  \
  --commitment 20386548276263145825368662695279343337887981784214581032640798115725144677639 \
  --target ap5oPFPVSnxtc8bbvcCeKwy9Xnu5NePhMGzX2hexDVh \
  --amount 10000000
```

#### Batch payouts

**Usage**
```
fortisX create_private_transfer_proposal \
  --multisig <address> --mint <address> \
  --commitments "<c1>,<c2>,..." --targets "<pk1>,<pk2>,..." --amounts "<a1>,<a2>,..." \
  [--deadline <seconds>] [--keypair <path>]
```

**Example**
```bash
fortisX create_private_transfer_proposal \
  --multisig BLUHe8sSDcPBQ5TH6BPJPNZVStqprZpZgg3wK8i4LRho \
  --mint 61ro7AExqfk4dZYoCyRzTahahCC2TdUUZ4M5epMPunJf \
  --commitments "14996677493515651068783397139729104799819374275888258521843076605771731093339,15194954822714547376119163268215551182114727436326470719522714104672629813338" \
  --targets "ap5oPFPVSnxtc8bbvcCeKwy9Xnu5NePhMGzX2hexDVh,9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin" \                                                                                                     
  --amounts "10000000,10000000"

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

**Descreption**

this commnads ,allows creating a multi asset type ,multisi recipeitn ,payout progposal
---

### `create_private_swap_proposal`
Create a **private Cloak swap** proposal (token-to-token via a private UTXO).

**Usage**
```
fortisX create_private_swap_proposal \
  --multisig <address> --mint <source-mint> \
  --commitment <bigint|hex> --amount <input-units> \
  --recipient-ata <pubkey> --target-mint <pubkey> \
  [--deadline <seconds>]
```

**Example**
```bash
fortisX create_private_swap_proposal \
  --multisig BLUHe8sSDcPBQ5TH6BPJPNZVStqprZpZgg3wK8i4LRho \
  --mint So11111111111111111111111111111111111111112   \
  --commitment 6342836635818038368715290775834697544185193584494730878152549536787210386746 \
  --amount 10000000 \
  --recipient-ata Bb4i1hout62G71odfmmwaBRcJCbQdn7LEpGFEX3z7vBA \
  --target-mint 61ro7AExqfk4dZYoCyRzTahahCC2TdUUZ4M5epMPunJf   
```

| Flag | Description |
|---|---|
| `--multisig <address>` | Multisig account address (base58) | ✅ Required |
| `--mint <pubkey>` | Source token mint (base58) | ✅ Required |
| `--commitment <value>` | UTXO commitment to spend (decimal or 0x hex) | ✅ Required |
| `--amount <value>` | Amount to swap in input token units | ✅ Required |
| `--recipient-ata <pubkey>` | Recipient ATA for the output token (base58) | ✅ Required |
| `--target-mint <pubkey>` | Mint of the token being swapped TO (base58) | ✅ Required |
| `--deadline <seconds>` | Voting deadline in seconds | `86400` (1 day) |

---


### `execute_private_proposal`
Execute an approved **private** Cloak proposal. Starts a local share-collector server and waits for members to call `submit_share`.

**Usage**
```
fortisX execute_private_proposal \
  --multisig <address> --proposal-number <number> \
  [--utxo-file <path>] [--dao-db <path>] [--cloak-program <address>]
```

**Example**
```bash
fortisX execute_private_proposal \
  --multisig BLUHe8sSDcPBQ5TH6BPJPNZVStqprZpZgg3wK8i4LRho \
  --proposal-number 2 \
```

| Flag | Description |
|---|---|---|
| `--multisig <address>` | Multisig account address (base58) |
| `--proposal-number <value>` | Proposal number to execute (decimal or 0x hex) |

**Descreption**

execute private proposal ,looks at mentiosed utxo ,in the utxos_db ,and executes the transfer or swap proposal,for this purpose we need the mutlisig onwed utxo private key ,the way we get that is ,we start an https server ,the mebers fetch theri encrytped share from chain ,decryptes t ,and send it to the server ,the server ,combines the shares ,and recosntructs the key
---

### `submit_share`
Fetch, decrypt, and submit your **Shamir share** to the collector server started by `execute_private_proposal`.

**Usage**
```
fortisX submit_share --multisig <address> [--insecure] [--timeout <ms>]
```

**Example**
```bash
fortisX submit_share   --multisig BLUHe8sSDcPBQ5TH6BPJPNZVStqprZpZgg3wK8i4LRho --insecure
```

| Flag | Description |
|---|---|---|
| `--multisig <address>` | Multisig account address (base58) |
| `--collector-url <url>` | Share collector endpoint URL | `http://localhost:3456/api/submit-share` |
| `--insecure` | Allow self-signed HTTPS certs (local testing) | `false` |
| `--timeout <ms>` | Request timeout in milliseconds | `30000` |

---

### `scan-compliance`
Scan Cloak transaction history for compliance/auditing using a viewing key.

**Usage**
```
fortisX scan-compliance --viewing-key <base58> [--limit <number>]
```

**Example**
```bash
fortisX scan-compliance \
  --viewing-key 9TesvoxeQCbF5Fu4Ym5fE1YEBZZDjyAuA9ozsayqg8SC \
  --limit 5
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
