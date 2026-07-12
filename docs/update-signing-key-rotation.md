# Update Signing Key Rotation

This document describes how to manage the public/private key pair used for
signing POS desktop update binaries.

## One-time key generation

Keys are generated with the Tauri CLI signer tool. This is done **outside**
the codebase, in the CI/CD environment or by a trusted operator.

```bash
# Install the Tauri signer CLI
cargo install tauri-cli --version "^2"

# Generate a new key pair
tauri signer generate -w ~/.tauri/update-sign.key

# This creates two files:
#   ~/.tauri/update-sign.key      — PRIVATE KEY (never commit, never share)
#   ~/.tauri/update-sign.key.pub  — public key (commit to repo)
```

## Private key storage

The private key file (`update-sign.key`) is:

- **Never committed** to any Git repository.
- **Never logged** in CI/CD output or application logs.
- **Never sent** to clients (only signatures are distributed).
- **Stored** as an encrypted secret in the CI/CD system (GitHub Actions secrets,
  GitLab CI variables, etc.) under the name `TAURI_SIGNING_PRIVATE_KEY`.
- **Mounted** only during the build step that signs the update binary.
- **Backed up** offline on a hardware-encrypted USB drive stored in a safe.

## Public key distribution

The public key (`update-sign.key.pub`) is:

1. **Committed to the repository** at `apps/pos-desktop/src-tauri/tauri.conf.json`
   (in the `tauri.updater.pubkey` field).
2. **Bundled into the Tauri application** at build time.
3. **Included in every published update version** as the `signature` field
   so the client can verify the binary before installing.

### Updating the public key in the repository

When rotating keys, the new public key must be committed to the repo before
signing new updates:

1. Place the new `.pub` file in the build environment.
2. Update the `pubkey` field in `tauri.conf.json`.
3. Commit the change.
4. Tag the commit as `key-rotation-YYYY-MM-DD`.
5. All future updates are signed with the new private key.

## Key rotation procedure

### When to rotate

- At least once per year (recommended).
- Immediately if the private key is suspected to be compromised.
- When the underlying cryptographic algorithm is deprecated.

### Rotation steps

1. **Generate new key pair** (see "One-time key generation" above).
2. **Support both keys during transition** (see "Transition period" below).
3. **Update the public key in the repository** (see "Public key distribution" above).
4. **Update the CI/CD secret** with the new private key (`TAURI_SIGNING_PRIVATE_KEY`).
5. **Sign all future updates** with the new private key.
6. **Document the rotation** in this file (add a row to the history table below).
7. **Securely destroy the old private key** after the transition period ends.

### Transition period

During a 30-day transition window after key rotation:

1. The **new public key** is committed to the repository.
2. Both old and new signatures can be verified by the client.
3. The client is updated (via an update signed with the old key) to support
   verifying two public keys.
4. After the transition, only the new key is used to sign updates, and the
   old verification code is removed.

### Emergency rotation (compromise)

If the private key is compromised:

1. **Immediately generate a new key pair**.
2. **Update the public key in the repository**.
3. **Update the CI/CD secret**.
4. **Publish a HOTFIX update** (signed with the new key) that:
   - Revokes trust in the old public key.
   - Includes the new public key.
   - Forces immediate installation.
5. **Audit** all binaries signed with the compromised key (if any were
   distributed outside the update system, they are invalidated by the HOTFIX).

## Verification flow

When a client downloads an update:

1. The client fetches `GET /updates/check` and receives the `signature` field.
2. The Tauri updater or signature-verifier module verifies the binary against
   the bundled public key using the provided signature.
3. If verification fails, the download is discarded and marked as failed.
4. If verification succeeds, the binary is staged for installation.

## Key rotation history

| Date | Old Key Fingerprint | New Key Fingerprint | Reason | Signed by |
|------|-------------------|-------------------|--------|-----------|
| (initial) | — | (first key) | Initial setup | CI/CD |

(Update this table with each rotation.)

## Security notes

- The signing key is independent of any TLS/SSL certificates used for HTTPS.
- The update system does not use the key for encryption, only for signing.
- The Tauri updater verifies the binary signature before applying it.
- The server stores the signature alongside each UpdateVersion record
  (in the `signature` field), so the client can verify it matches.
