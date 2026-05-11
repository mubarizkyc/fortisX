# FortisX

In the landscape of Solana multisig wallets, the standard flow has long been: upload proposal data on-chain, vote on it, then execute the stored transaction by invoking the target program. This is the model Fortis originally followed.

Then came the Drift Protocol hack — a wake-up call that major financial decisions should not always be public. Should competitors see whom a firm is paying, who it is receiving funds from, its asset valuations, token minting activities, or swap strategies? What about decisions to create new liquidity pools on decentralised exchanges?

That is when we began exploring privacy-preserving solutions and discovered Cloak. From that insight, we built FortisX: a multisig that extends Fortis with a private execution layer.

**What FortisX adds:**
- Shielded treasury management — hide asset balances and transaction histories on-chain
- Private multi-type, multi-recipient transfers — send SOL, USDC, or USDT to multiple parties without exposing amounts or addresses
- Private asset swaps — rebalance portfolios or execute trades without revealing intent
- Compliance and scoped auditing — generate full or time-bound, role-specific audit trails via viewing keys

FortisX is not just a multisig. It is a privacy-first treasury operating system for organisations that need confidentiality without sacrificing accountability.

---

## How it works

**Public proposals** follow the standard multisig pattern: proposal stored on-chain, members vote, executor fires the transaction.

**Private proposals** work differently. When a proposer creates a private transfer or swap, only a Blake3 hash of the payload is written on-chain. The actual payload — recipients, amounts, UTXO commitments — lives in an off-chain database accessible to members. Members fetch the payload, verify it matches the on-chain hash, and vote. At execution time, the executor starts a local share-collector server. Each member fetches their encrypted Shamir share from the chain, decrypts it with their Solana keypair, and submits it to the collector. Once the threshold is reached, the treasury private key is reconstructed, a Groth16 proof is generated via the Cloak SDK, and the transfer or swap executes — with no amounts or addresses visible on-chain.

**Key management** — at multisig creation, the treasury UTXO private key is split into N Shamir shares. Each share is encrypted with the corresponding member's Ed25519 public key (via X25519 ECDH + NaCl secretbox) and stored on-chain. No single member ever holds the full key. Reconstruction requires M-of-N members to cooperate at execution time, after which the key is discarded from memory.

---

## Prerequisites

- Node.js >= 18
- Yarn or npm

---

## Setup

```bash
export SOLANA_RPC_URL=https://api.devnet.solana.com
export KEYPAIR_PATH=/path/to/keypair.json
```

```bash
git clone https://github.com/mubarizkyc/fortisX.git
cd FortisX
yarn install
alias fortisX='npx tsx src/index.ts'
```

```bash
fortisX --help
```

---

## Commands

---

wipe previous record before each new multisig creation
```bash
> cloak_deposits.txt &&  > proposal_history.json &&  > my_utxo_logs.txt  &&  > swap_proposal_history.json &&  > treasury_utxos.json 
```
### create_multisig

Create a new on-chain multisig. Generates a treasury UTXO keypair, splits the private key via Shamir Secret Sharing, encrypts each share with the corresponding member's public key, and stores everything on-chain.

```
fortisX create_multisig --members "<pubkey1> <pubkey2> ..." --threshold <number>
```

```bash
fortisX create_multisig \
  --members "ap5oPFPVSnxtc8bbvcCeKwy9Xnu5NePhMGzX2hexDVh 44abtGibbueKQDXaw3PG9N1TrqhaF6RMao7jsW7QRC68" \
  --threshold 2
```

| Flag | Description |
|---|---|
| `--members <pubkeys>` | Space-separated list of member public keys (base58) |
| `--threshold <number>` | Number of required approvals |

---

### public_deposit

Deposit SOL into the multisig public treasury (the multisig PDA). SPL and Token-2022 tokens can also be deposited by creating an ATA.

```
fortisX public_deposit --multisig <address> --amount <lamports>
```

```bash
fortisX public_deposit \
  --multisig BLUHe8sSDcPBQ5TH6BPJPNZVStqprZpZgg3wK8i4LRho \
  --amount 10000000
```

| Flag | Description |
|---|---|
| `--multisig <address>` | Multisig account address (base58) |
| `--amount <lamports>` | Amount to deposit in lamports |

---

### cloak_deposit

Deposit an asset into the Cloak Protocol to mint a private UTXO. UTXO details are saved to `cloak_deposits.txt`. Use the commitment from this file in subsequent private proposals.

```
fortisX cloak_deposit --mint <address> --amount <lamports>
```

```bash
fortisX cloak_deposit \
  --mint So11111111111111111111111111111111111111112 \
  --amount 10000000
```

| Flag | Description |
|---|---|
| `--mint <address>` | Asset mint address (base58) |
| `--amount <lamports>` | Amount to deposit in lamports |

---

### private_deposit

Transfer from a private Cloak UTXO into the multisig treasury. Creates a new UTXO owned by the multisig treasury keypair.

```
fortisX private_deposit --treasury-id <bigint> --utxo <base58> --amount <lamports>
```

```bash
fortisX private_deposit \
  --treasury-id 1273225015818612797192906101562736704378543174907210035582014424758348943475 \
  --amount 10000000 \
  --utxo "EACA7nSL1Dmd8HxG3s6tCPHeFEnoThy61Lv2xTDH28C831Aywzh5NAVjUT7dBtDNuKcvsuStYhwhnCWfFwtDMxnfgzT9HdX2BnHR7YHHXPL8qBBXw5xQisfKtxNScgMdZiaDmmmANHhhCnE9tvPQD3vpus6CBxZrUFc4WS1hccH5K1y"
```

| Flag | Description |
|---|---|
| `--treasury-id <id>` | Treasury UTXO public key as BigInt |
| `--utxo <base58>` | Existing private UTXO (base58) to spend |
| `--amount <lamports>` | Amount to transfer in lamports |

---

### create_transfer_proposal

Create a public SOL transfer proposal for multisig approval. FortisX supports all transaction types — token transfers, swaps, program upgrades, and so on. Pass the transaction message as a base58 string; FortisX stores it on-chain and executes it by invoking the target program.

```
fortisX create_transfer_proposal --multisig <address> --target <address> --amount <lamports>
```

```bash
fortisX create_transfer_proposal \
  --multisig BLUHe8sSDcPBQ5TH6BPJPNZVStqprZpZgg3wK8i4LRho \
  --target ap5oPFPVSnxtc8bbvcCeKwy9Xnu5NePhMGzX2hexDVh \
  --amount 10000000
```

| Flag | Description |
|---|---|
| `--multisig <address>` | Multisig account address (base58) |
| `--target <address>` | Transfer recipient address (base58) |
| `--amount <lamports>` | Amount in lamports |

---

### create_private_transfer_proposal

Create a private Cloak transfer proposal. Supports single and batch payouts. Only a Blake3 hash of the payload is written on-chain; recipient addresses and amounts remain off-chain.

**Single payout**

```
fortisX create_private_transfer_proposal \
  --multisig <address> --mint <address> \
  --commitment <bigint> --target <pubkey> --amount <lamports> \
  [--deadline <seconds>]
```

```bash
fortisX create_private_transfer_proposal \
  --multisig BLUHe8sSDcPBQ5TH6BPJPNZVStqprZpZgg3wK8i4LRho \
  --mint So11111111111111111111111111111111111111112 \
  --commitment 20386548276263145825368662695279343337887981784214581032640798115725144677639 \
  --target ap5oPFPVSnxtc8bbvcCeKwy9Xnu5NePhMGzX2hexDVh \
  --amount 10000000
```

**Batch payouts**

```
fortisX create_private_transfer_proposal \
  --multisig <address> --mint <address> \
  --commitments "<c1>,<c2>,..." --targets "<pk1>,<pk2>,..." --amounts "<a1>,<a2>,..." \
  [--deadline <seconds>]
```

```bash
fortisX create_private_transfer_proposal \
  --multisig BLUHe8sSDcPBQ5TH6BPJPNZVStqprZpZgg3wK8i4LRho \
  --mint So11111111111111111111111111111111111111112 \
  --commitments "3908616254283626232516298147628320137964133889473679795009811424391216960327,7507838035974423991802735548776930883407129700470938034699747284769689014606" \
  --targets "ap5oPFPVSnxtc8bbvcCeKwy9Xnu5NePhMGzX2hexDVh,9PkS1eTC4G85Quw5LTcaWUTbvj8bgxMJrvw7LDhQ1i6q" \
  --amounts "10000000,10000000"
```

| Flag | Description | Default |
|---|---|---|
| `--multisig <address>` | Multisig account address (base58) | required |
| `--mint <address>` | Asset mint address (base58) | required |
| `--commitments <values>` | UTXO commitments, comma-separated (decimal or 0x hex) | batch mode |
| `--targets <pubkeys>` | Recipient public keys, comma-separated (base58) | batch mode |
| `--amounts <values>` | Amounts in lamports, comma-separated | batch mode |
| `--commitment <value>` | Single UTXO commitment | single mode |
| `--target <pubkey>` | Single recipient pubkey | single mode |
| `--amount <value>` | Single amount in lamports | single mode |
| `--deadline <seconds>` | Voting deadline in seconds | `86400` |

All batch arrays must be the same length. Maximum 255 entries per proposal.

---

### create_private_swap_proposal

Create a private Cloak swap proposal. The swap is executed via the Cloak relay using Jupiter routing. Only the payload hash is written on-chain.

```
fortisX create_private_swap_proposal \
  --multisig <address> --mint <source-mint> \
  --commitment <bigint> --amount <input-units> \
  --recipient-ata <pubkey> --target-mint <pubkey> \
  [--deadline <seconds>]
```

```bash
fortisX create_private_swap_proposal \
  --multisig BLUHe8sSDcPBQ5TH6BPJPNZVStqprZpZgg3wK8i4LRho \
  --mint So11111111111111111111111111111111111111112 \
  --commitment 21042323331920799627000785245834848968968706624024230582489341366524531731353 \
  --amount 10000000 \
  --recipient-ata Bb4i1hout62G71odfmmwaBRcJCbQdn7LEpGFEX3z7vBA \
  --target-mint 61ro7AExqfk4dZYoCyRzTahahCC2TdUUZ4M5epMPunJf
```

| Flag | Description |
|---|---|
| `--multisig <address>` | Multisig account address (base58) |
| `--mint <pubkey>` | Source token mint (base58) |
| `--commitment <value>` | UTXO commitment to spend (decimal or 0x hex) |
| `--amount <value>` | Amount to swap in input token units |
| `--recipient-ata <pubkey>` | Recipient ATA for the output token (base58) |
| `--target-mint <pubkey>` | Mint of the token being swapped to (base58) |
| `--deadline <seconds>` | Voting deadline in seconds (default: `86400`) |

---

### approve_proposal

Approve a pending multisig proposal as a member. Works for both public and private proposals.

```
fortisX approve_proposal --multisig <address> --proposal <number>
```

```bash
fortisX approve_proposal \
  --multisig BLUHe8sSDcPBQ5TH6BPJPNZVStqprZpZgg3wK8i4LRho \
  --proposal 1
```

| Flag | Description |
|---|---|
| `--multisig <address>` | Multisig account address (base58) |
| `--proposal <number>` | Proposal number (transaction index) to approve |

Members who do not approve within the voting deadline are treated as rejections.

---

### execute_proposal

Execute an approved public multisig proposal.

```
fortisX execute_proposal --multisig <address> --proposal <number>
```

```bash
fortisX execute_proposal \
  --multisig BLUHe8sSDcPBQ5TH6BPJPNZVStqprZpZgg3wK8i4LRho \
  --proposal 1
```

| Flag | Description |
|---|---|
| `--multisig <address>` | Multisig account address (base58) |
| `--proposal <number>` | Proposal number (transaction index) to execute |

---

### execute_private_proposal

Execute an approved private Cloak proposal. Starts a local share-collector server on port 3456 and waits for members to submit their Shamir shares via `submit_share`. Once the threshold is reached, the treasury key is reconstructed and the Cloak transaction is submitted.

```
fortisX execute_private_proposal \
  --multisig <address> --proposal-number <number> \
  [--utxo-file <path>] [--collector-port <port>] [--share-timeout-ms <ms>]
```

```bash
fortisX execute_private_proposal \
  --multisig BLUHe8sSDcPBQ5TH6BPJPNZVStqprZpZgg3wK8i4LRho \
  --proposal-number 2
```

| Flag | Description | Default |
|---|---|---|
| `--multisig <address>` | Multisig account address (base58) | required |
| `--proposal-number <value>` | Proposal number to execute | required |
| `--utxo-file <path>` | Path to UTXO database file | `./treasury_utxos.json` |
| `--collector-port <port>` | Port for share collector server | `3456` |
| `--share-timeout-ms <ms>` | Timeout for share collection in milliseconds | `300000` |

---

### submit_share

Fetch your encrypted Shamir share from the chain, decrypt it with your Solana keypair, and submit it to the collector server started by `execute_private_proposal`. Run this in a separate terminal while `execute_private_proposal` is waiting.

```
fortisX submit_share --multisig <address> [--collector-url <url>] [--insecure]
```

```bash
fortisX submit_share \
  --multisig BLUHe8sSDcPBQ5TH6BPJPNZVStqprZpZgg3wK8i4LRho \
  --insecure
```

| Flag | Description | Default |
|---|---|---|
| `--multisig <address>` | Multisig account address (base58) | required |
| `--collector-url <url>` | Share collector endpoint | `http://localhost:3456/api/submit-share` |
| `--insecure` | Allow self-signed HTTPS certificates | `false` |
| `--timeout <ms>` | Request timeout in milliseconds | `30000` |

---

### scan-compliance

Scan Cloak transaction history for a given viewing key. The viewing key is derived from the treasury UTXO private key and can be scoped to a time range for external auditors.

```
fortisX scan-compliance --viewing-key <base58> [--limit <number>]
```

```bash
fortisX scan-compliance \
  --viewing-key 9TesvoxeQCbF5Fu4Ym5fE1YEBZZDjyAuA9ozsayqg8SC \
  --limit 5
```

| Flag | Description | Default |
|---|---|---|
| `--viewing-key <key>` | Base58-encoded viewing key (nk, 32 bytes) | required |
| `--rpc <url>` | Solana RPC URL | Helius devnet |
| `--limit <number>` | Maximum number of transactions to scan | — |

---

## Global flags

Available on all commands.

| Flag | Description | Default |
|---|---|---|
| `--keypair <path>` | Path to signer keypair JSON | `KEYPAIR_PATH` env or `~/.config/solana/id.json` |
| `--rpc <url>` | Solana RPC URL | `SOLANA_RPC_URL` env or Helius devnet |
| `--commitment <level>` | RPC commitment level (`processed`, `confirmed`, `finalized`) | `confirmed` |

---

## Typical workflow

```
1. create_multisig
   Set up the multisig with members and threshold. Treasury key is split and encrypted on-chain.

2. Fund the treasury
   public_deposit          — fund the public treasury
   cloak_deposit           — mint a private UTXO via Cloak
   private_deposit         — move a UTXO into the multisig treasury

3. Create a proposal
   create_transfer_proposal          — public SOL transfer
   create_private_transfer_proposal  — private Cloak transfer (single or batch)
   create_private_swap_proposal      — private token swap via Cloak

4. approve_proposal
   Each required member approves before the deadline.

5. Execute
   execute_proposal          — execute a public proposal
   execute_private_proposal  — start the collector; each member runs submit_share

6. scan-compliance
   Audit private transactions using a viewing key.
```

---

## Program IDs

| Program | Address |
|---|---|
| FortisX (devnet) | `CD6Pnc1gpUQ1XT1bzXEPs2QnqFMcQUHsiRKAV9iYXh36` |

---

## License

MIT