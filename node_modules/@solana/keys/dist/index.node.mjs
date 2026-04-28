import { getBase58Encoder, getBase58Decoder } from '@solana/codecs-strings';
import { SolanaError, SOLANA_ERROR__KEYS__INVALID_PRIVATE_KEY_BYTE_LENGTH, SOLANA_ERROR__SUBTLE_CRYPTO__CANNOT_EXPORT_NON_EXTRACTABLE_KEY, SOLANA_ERROR__KEYS__SIGNATURE_STRING_LENGTH_OUT_OF_RANGE, SOLANA_ERROR__KEYS__INVALID_SIGNATURE_BYTE_LENGTH, SOLANA_ERROR__KEYS__INVALID_KEY_PAIR_BYTE_LENGTH, SOLANA_ERROR__KEYS__PUBLIC_KEY_MUST_MATCH_PRIVATE_KEY, SOLANA_ERROR__KEYS__INVALID_BASE58_IN_GRIND_REGEX } from '@solana/errors';
import { getAbortablePromise } from '@solana/promises';
import { assertKeyExporterIsAvailable, assertSigningCapabilityIsAvailable, assertVerificationCapabilityIsAvailable, assertKeyGenerationIsAvailable, assertPRNGIsAvailable } from '@solana/assertions';
import { toArrayBuffer } from '@solana/codecs-core';
import { mkdir, writeFile } from 'fs/promises';
import { dirname } from 'path';

// src/grind-keypair.ts

// src/algorithm.ts
var ED25519_ALGORITHM_IDENTIFIER = (
  // Resist the temptation to convert this to a simple string; As of version 133.0.3, Firefox
  // requires the object form of `AlgorithmIdentifier` and will throw a `DOMException` otherwise.
  Object.freeze({ name: "Ed25519" })
);
function addPkcs8Header(bytes) {
  return new Uint8Array([
    /**
     * PKCS#8 header
     */
    48,
    // ASN.1 sequence tag
    46,
    // Length of sequence (46 more bytes)
    2,
    // ASN.1 integer tag
    1,
    // Length of integer
    0,
    // Version number
    48,
    // ASN.1 sequence tag
    5,
    // Length of sequence
    6,
    // ASN.1 object identifier tag
    3,
    // Length of object identifier
    // Edwards curve algorithms identifier https://oid-rep.orange-labs.fr/get/1.3.101.112
    43,
    // iso(1) / identified-organization(3) (The first node is multiplied by the decimal 40 and the result is added to the value of the second node)
    101,
    // thawte(101)
    // Ed25519 identifier
    112,
    // id-Ed25519(112)
    /**
     * Private key payload
     */
    4,
    // ASN.1 octet string tag
    34,
    // String length (34 more bytes)
    // Private key bytes as octet string
    4,
    // ASN.1 octet string tag
    32,
    // String length (32 bytes)
    ...bytes
  ]);
}
async function createPrivateKeyFromBytes(bytes, extractable = false) {
  const actualLength = bytes.byteLength;
  if (actualLength !== 32) {
    throw new SolanaError(SOLANA_ERROR__KEYS__INVALID_PRIVATE_KEY_BYTE_LENGTH, {
      actualLength
    });
  }
  const privateKeyBytesPkcs8 = addPkcs8Header(bytes);
  return await crypto.subtle.importKey("pkcs8", privateKeyBytesPkcs8, ED25519_ALGORITHM_IDENTIFIER, extractable, [
    "sign"
  ]);
}
async function getPublicKeyFromPrivateKey(privateKey, extractable = false) {
  assertKeyExporterIsAvailable();
  if (privateKey.extractable === false) {
    throw new SolanaError(SOLANA_ERROR__SUBTLE_CRYPTO__CANNOT_EXPORT_NON_EXTRACTABLE_KEY, { key: privateKey });
  }
  const jwk = await crypto.subtle.exportKey("jwk", privateKey);
  return await crypto.subtle.importKey(
    "jwk",
    {
      crv: "Ed25519",
      ext: extractable,
      key_ops: ["verify"],
      kty: "OKP",
      x: jwk.x
    },
    "Ed25519",
    extractable,
    ["verify"]
  );
}
var base58Encoder;
function assertIsSignature(putativeSignature) {
  if (!base58Encoder) base58Encoder = getBase58Encoder();
  if (
    // Lowest value (64 bytes of zeroes)
    putativeSignature.length < 64 || // Highest value (64 bytes of 255)
    putativeSignature.length > 88
  ) {
    throw new SolanaError(SOLANA_ERROR__KEYS__SIGNATURE_STRING_LENGTH_OUT_OF_RANGE, {
      actualLength: putativeSignature.length
    });
  }
  const bytes = base58Encoder.encode(putativeSignature);
  assertIsSignatureBytes(bytes);
}
function assertIsSignatureBytes(putativeSignatureBytes) {
  const numBytes = putativeSignatureBytes.byteLength;
  if (numBytes !== 64) {
    throw new SolanaError(SOLANA_ERROR__KEYS__INVALID_SIGNATURE_BYTE_LENGTH, {
      actualLength: numBytes
    });
  }
}
function isSignature(putativeSignature) {
  if (!base58Encoder) base58Encoder = getBase58Encoder();
  if (
    // Lowest value (64 bytes of zeroes)
    putativeSignature.length < 64 || // Highest value (64 bytes of 255)
    putativeSignature.length > 88
  ) {
    return false;
  }
  const bytes = base58Encoder.encode(putativeSignature);
  return isSignatureBytes(bytes);
}
function isSignatureBytes(putativeSignatureBytes) {
  return putativeSignatureBytes.byteLength === 64;
}
async function signBytes(key, data) {
  assertSigningCapabilityIsAvailable();
  const signedData = await crypto.subtle.sign(ED25519_ALGORITHM_IDENTIFIER, key, toArrayBuffer(data));
  return new Uint8Array(signedData);
}
function signature(putativeSignature) {
  assertIsSignature(putativeSignature);
  return putativeSignature;
}
function signatureBytes(putativeSignatureBytes) {
  assertIsSignatureBytes(putativeSignatureBytes);
  return putativeSignatureBytes;
}
async function verifySignature(key, signature2, data) {
  assertVerificationCapabilityIsAvailable();
  return await crypto.subtle.verify(ED25519_ALGORITHM_IDENTIFIER, key, toArrayBuffer(signature2), toArrayBuffer(data));
}

// src/key-pair.ts
async function generateKeyPair(extractable = false) {
  await assertKeyGenerationIsAvailable();
  const keyPair = await crypto.subtle.generateKey(
    /* algorithm */
    ED25519_ALGORITHM_IDENTIFIER,
    // Native implementation status: https://github.com/WICG/webcrypto-secure-curves/issues/20
    extractable,
    /* allowed uses */
    ["sign", "verify"]
  );
  return keyPair;
}
async function createKeyPairFromBytes(bytes, extractable = false) {
  assertPRNGIsAvailable();
  if (bytes.byteLength !== 64) {
    throw new SolanaError(SOLANA_ERROR__KEYS__INVALID_KEY_PAIR_BYTE_LENGTH, { byteLength: bytes.byteLength });
  }
  const [publicKey, privateKey] = await Promise.all([
    crypto.subtle.importKey(
      "raw",
      bytes.slice(32),
      ED25519_ALGORITHM_IDENTIFIER,
      /* extractable */
      true,
      [
        "verify"
      ]
    ),
    createPrivateKeyFromBytes(bytes.slice(0, 32), extractable)
  ]);
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);
  const signedData = await signBytes(privateKey, randomBytes);
  const isValid = await verifySignature(publicKey, signedData, randomBytes);
  if (!isValid) {
    throw new SolanaError(SOLANA_ERROR__KEYS__PUBLIC_KEY_MUST_MATCH_PRIVATE_KEY);
  }
  return { privateKey, publicKey };
}
async function createKeyPairFromPrivateKeyBytes(bytes, extractable = false) {
  const privateKeyPromise = createPrivateKeyFromBytes(bytes, extractable);
  const [publicKey, privateKey] = await Promise.all([
    // This nested promise makes things efficient by
    // creating the public key in parallel with the
    // second private key creation, if it is needed.
    (extractable ? privateKeyPromise : createPrivateKeyFromBytes(
      bytes,
      true
      /* extractable */
    )).then(
      async (privateKey2) => await getPublicKeyFromPrivateKey(
        privateKey2,
        true
        /* extractable */
      )
    ),
    privateKeyPromise
  ]);
  return { privateKey, publicKey };
}

// src/grind-keypair.ts
var STRIP_UNVALIDATED_REGEX_PARTS = /\\.|\[[^\]]*\]|\{[^}]*\}|\([^)]*\)/g;
var STRIP_GRIND_METACHARACTERS = /[$()*+./?[\]^{|}]/g;
var BASE58_ALPHABET_REGEX = /^[1-9A-HJ-NP-Za-km-z]*$/;
function assertGrindRegexIsValid(regex) {
  const stripped = regex.source.replace(STRIP_UNVALIDATED_REGEX_PARTS, "").replace(STRIP_GRIND_METACHARACTERS, "");
  const isBase58Character = (character) => {
    if (regex.ignoreCase) {
      return BASE58_ALPHABET_REGEX.test(character.toLowerCase()) || BASE58_ALPHABET_REGEX.test(character.toUpperCase());
    }
    return BASE58_ALPHABET_REGEX.test(character);
  };
  for (const character of stripped) {
    if (!isBase58Character(character)) {
      throw new SolanaError(SOLANA_ERROR__KEYS__INVALID_BASE58_IN_GRIND_REGEX, {
        character,
        source: regex.source
      });
    }
  }
}
async function grindKeyPairs(config) {
  const { abortSignal, amount = 1, concurrency = 32, extractable = false, matches } = config;
  let matcher;
  if (typeof matches === "function") {
    matcher = matches;
  } else {
    assertGrindRegexIsValid(matches);
    matcher = (address) => matches.test(address);
  }
  if (amount <= 0) {
    return [];
  }
  const base58Decoder = getBase58Decoder();
  const found = [];
  while (found.length < amount) {
    abortSignal?.throwIfAborted();
    const batch = await getAbortablePromise(
      Promise.all(
        Array.from({ length: concurrency }, async () => {
          const keyPair = await generateKeyPair(extractable);
          const publicKeyBytes = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));
          const address = base58Decoder.decode(publicKeyBytes);
          return { address, keyPair };
        })
      ),
      abortSignal
    );
    for (const { address, keyPair } of batch) {
      if (found.length >= amount) break;
      if (matcher(address)) {
        found.push(keyPair);
      }
    }
  }
  return found;
}
async function grindKeyPair(config) {
  const [keyPair] = await grindKeyPairs({ ...config, amount: 1 });
  return keyPair;
}

// src/write-keypair.ts
async function writeKeyPair(keyPair, path, config = {}) {
  if (!keyPair.privateKey.extractable) {
    throw new SolanaError(SOLANA_ERROR__SUBTLE_CRYPTO__CANNOT_EXPORT_NON_EXTRACTABLE_KEY, {
      key: keyPair.privateKey
    });
  }
  if (!keyPair.publicKey.extractable) {
    throw new SolanaError(SOLANA_ERROR__SUBTLE_CRYPTO__CANNOT_EXPORT_NON_EXTRACTABLE_KEY, {
      key: keyPair.publicKey
    });
  }
  const [privateKeyPkcs8, publicKeyRaw] = await Promise.all([
    crypto.subtle.exportKey("pkcs8", keyPair.privateKey),
    crypto.subtle.exportKey("raw", keyPair.publicKey)
  ]);
  const privateKeyBytes = new Uint8Array(privateKeyPkcs8).slice(16);
  if (privateKeyBytes.byteLength !== 32) {
    throw new SolanaError(SOLANA_ERROR__KEYS__INVALID_PRIVATE_KEY_BYTE_LENGTH, {
      actualLength: privateKeyBytes.byteLength
    });
  }
  const publicKeyBytes = new Uint8Array(publicKeyRaw);
  const bytes = new Uint8Array(64);
  bytes.set(privateKeyBytes, 0);
  bytes.set(publicKeyBytes, 32);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(Array.from(bytes)), {
    flag: config.unsafelyOverwriteExistingKeyPair ? "w" : "wx",
    mode: 384
  });
}

export { assertIsSignature, assertIsSignatureBytes, createKeyPairFromBytes, createKeyPairFromPrivateKeyBytes, createPrivateKeyFromBytes, generateKeyPair, getPublicKeyFromPrivateKey, grindKeyPair, grindKeyPairs, isSignature, isSignatureBytes, signBytes, signature, signatureBytes, verifySignature, writeKeyPair };
//# sourceMappingURL=index.node.mjs.map
//# sourceMappingURL=index.node.mjs.map