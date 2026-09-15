# Member-only encrypted organizations

This is an explicit organization mode. It is **not a claim that every existing
Bondfire organization, module, database row, or provider backup is zero knowledge**.
Existing organizations retain their current storage behavior until an owner
completes the conversion from Settings → Security on a device with the correct key.
The dashboard also offers creation of a new encrypted organization; its name is
encrypted before the creation request.

## Content boundary

The private API stores AES-256-GCM ciphertext produced on member devices. Record
identity and organization identity are authenticated as additional data, so an
envelope cannot be copied to another organization or record and successfully
opened. Random 96-bit IVs are generated for each encryption. File names and MIME
types are inside encrypted metadata; file contents are encrypted separately before
upload to R2 or the small-file D1 fallback. Updates use revision checks.

The server has no unwrapped content key. ECDH P-256, HKDF-SHA-256 and AES-GCM wrap
the organization key for registered member devices. Device wraps are separate so
sharing with another device does not replace the first device's wrap. Recovery is
an independently passphrase-encrypted copy; new private organizations require a
separate recovery passphrase. Password reset does not recover encrypted content.

Access is checked against current accounts and organization roles on every API
request. Removing membership deletes that member's server-side key wraps and
recovery copy. Previously obtained keys, plaintext, and downloads cannot be
recalled. The shared organization content key does not provide cryptographic
compartmentalization between members; endpoint role checks govern retrieval.

## Available surfaces

Private storage supports organization names, Needs, Pledges, Inventory, People,
meeting details, Events, Witness record metadata, native chat rooms/messages,
Drive folders/notes/templates/files, and private form/sheet files in Drive.
The private dashboard and navigation expose these surfaces. Studio documents and
reusable blocks also sync through encrypted storage. A workspace revision protects
the complete snapshot against stale saves and deletions from another tab. Drive
images used in Studio are downloaded as ciphertext and opened locally.

Public pages/submissions, newsletter operations, external chat, Colophon,
RSVP collection, and integrations without a private adapter are not
enabled in this mode. The server rejects unsupported organization routes instead
of falling back to legacy storage. This mode does not convert anonymous REC
capture into an organization recording workflow.

## Existing data

Conversion runs on the owner's device. It decrypts any supported legacy encrypted
record, encrypts and verifies the complete record locally, then atomically stores
the encrypted replacement and scrubs readable fields in the active legacy row.
Compare-and-swap checks stop conversion if a source changed. File conversion
stores encrypted bytes before retiring the original; failed external deletion is
retryable and prevents the conversion from being reported complete.

Unknown plugin tables, unsupported records, existing public-site copies,
unhandled dependent rows, and orphaned file data block conversion. They are not
dropped, silently skipped, or treated as encrypted. A stopped conversion can be
resumed. API writes are frozen during conversion; database write guards also
reject late writes through the supported legacy content tables. Conversion does
not purge provider backups, history, copies already published, or user devices.

## What the server can still observe

Accounts and login identifiers, membership relationships, roles, public device
keys, enabled modules, record kinds and identifiers, parent relationships,
revisions, timestamps, request traffic, and ciphertext sizes remain visible.
Provider/network logs may reveal IP addresses. This is content confidentiality,
not anonymity or a claim that the operator knows nothing about group activity.

The threat model is a server that runs the reviewed client and protocol but can
inspect its storage. A malicious operator serving modified JavaScript or
substituting public keys, a compromised member device, or a member disclosing a
key can defeat confidentiality. This browser implementation has not received an
independent security audit and does not claim protection against those attacks.

## Verification

With Node 24 or another Node release providing `node:sqlite`:

```
node scripts/private-storage-regression.mjs
node scripts/private-studio-regression.mjs
node scripts/private-publication-regression.mjs
node scripts/emergency-protocol-regression.mjs
npm run smoke:thread1
npm run build
```

The private regression uses real SQLite transactions and Web Crypto. It covers
role checks, plaintext rejection, record identity binding, tamper rejection,
revision conflicts, late legacy writes, file ciphertext, source-change rejection,
transaction rollback, and retryable cleanup. Cloudflare Pages Functions bundling
must also pass before deployment. A successful build is not verification that a
live organization's data has been converted.

## Required work before making this the platform default

The requested product direction is encryption by default with functional parity,
not a permanent restricted edition. That transition is **not complete** in this
working branch. Default encrypted creation is implemented here for integration
testing; do not deploy this branch as the completed all-app rollout until the
remaining workflows have compatible implementations:

- Creation now encrypts organization identity and recovery material on the device.
  Signup creates only an account/session, then opens the builder with staged
  selections preserved. Recovery, membership, key wraps, selected modules, and
  organization records commit atomically. Both historical recovery table shapes
  are supported. Module configuration is editable again. Full module availability
  still depends on the work below.
- Colophon private content, media, review, search, and server-side processing need
  an encrypted host contract. The current dependency operates on readable data.
- Anonymous intake and RSVP submissions require public recipient encryption keys;
  member-only access and respondent/admin-only access require different key scopes.
- Membership changes need cryptographic key epochs, device provisioning, rotation,
  and migration, including role downgrades and removal. The shared org key cannot
  enforce those boundaries cryptographically.
- Existing public copies, plugin data, recordings, logs, exports, and account data
  need an explicit inventory and compatible conversion. Provider backups cannot
  be retroactively erased by changing the active database.

Deliberately publishing content or sending it to an external processing service
is a disclosure boundary. It must never silently disclose private source records
or their keys. An encrypted-at-rest server that decrypts using its own secret does
not satisfy the requested member-only content confidentiality.

## Publication contract under implementation

The private API now supports an explicit selected-field public copy for Needs,
Meetings, Inventory, Events, Witness metadata, and public-page configuration.
Private originals remain encrypted. `privacy/publish` requires an administrator
and the current source revision; it accepts only each kind's public field list,
including validation of nested link objects. It never reads or decrypts private
source fields. Deleting a source removes its published copy atomically.

The client keeps disabled public-page configuration encrypted and uploads a
readable configuration only when publication is enabled. An interrupted publish
or unpublish reports a failure and can be retried. Public readers receive the last
explicitly published copy, not subsequent unpublished edits to the encrypted source.
Old public slugs stop resolving once the published configuration changes its slug.

This contract does not complete the full rollout: public-page settings remain
behind the existing private-mode UI restriction until encrypted intake and
newsletter submission are implemented. Colophon uses a separate host contract and
has not yet been connected to these projections. The integration branch changes
registration and builder creation to encrypted setup and rejects legacy plaintext
organization creation. This must not be represented as functional parity or as a
completed production rollout. Private event/witness link searches now run on the
device; query terms never enter HTTP URLs.

Creation regression: `node scripts/private-signup-regression.mjs`. The storage
regression also injects recovery-write failures and verifies rollback of every
organization table, and checks both deployed recovery schema variants.
