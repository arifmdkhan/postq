# PostQ operations and recovery

## Deployment baseline

Use Node 22.16 or newer supported Node 22/24, pnpm 12.5.1, and Linux/WSL for the OpenNext build. Keep staging Worker, D1, and R2 resources separate from production. Never point a preview at production bindings. Before upgrading an existing instance, back up D1, R2, and its stable encryption/session secrets.

New instances require a random `POSTQ_BOOTSTRAP_TOKEN` of at least 32 characters. `pnpm setup:local` generates it for fresh local environments. Enter it when creating the first owner. `POSTQ_OWNER_EMAIL` reserves an address; it does not replace bootstrap proof. Existing owners do not need a bootstrap token to sign in. Remove the bootstrap secret after creating the owner.

The new migrations add draft revisions, media validation/cleanup, delivery recovery, and latest-metric summaries. Apply them before serving new application code. They preserve existing drafts, publications, and media. Existing media without validated metadata must be repaired or re-uploaded before publishing. Download access remains available. `node --experimental-transform-types scripts/repair-media.mjs --local` validates batches without changing original objects. GIF/WebP remain library formats; publishing uses the supported JPEG/PNG/H.264 MP4 subset.

Apply migrations through `0021_multi_media.sql` for ordered attachments. This additive migration backfills each existing cover into a one-element `media_ids` array and retains `media_id` for compatibility. New code requires the array column. Back up D1 before migration; retain the pre-upgrade export when rolling back because older code sees only the first cover. Do not resume publishing on older code with multi-attachment deliveries queued. Review/cancel those deliveries or restore the coordinated code/data version with publishing paused. Media counts, provider preparation and staging qualification limits are documented in [the media matrix](MEDIA_PUBLISHING_2026-11-06.md).

Run `pnpm check`, build the Worker, and smoke-test it before promotion. Promote code and schema as a coordinated release. Smoke tests must check both HTML and its referenced assets. For separate local build output, set `POSTQ_BUILD_DIR=.next-local-production` for both `pnpm build` and `pnpm start`; use `.next` for the Cloudflare adapter. Do not overwrite a running server's build directory. `POSTQ_LOCAL_STATE` isolates `next dev` and the repair/recovery scripts. It does not configure the adapter fallback used by `next start`; use an isolated Worker preview with Wrangler's `--persist-to` option for production-runtime verification.

## Credential repair and rotation

`POSTQ_ENCRYPTION_KEY` protects newly saved integration/provider credentials independently of the session secret. Keep it stable and backed up in a private secrets store. Legacy values remain decryptable with the original `BETTER_AUTH_SECRET`. Damaged integration values disable only the affected credential; Settings identifies the field and password login remains available.

Before rotating `BETTER_AUTH_SECRET` on an older installation:

1. Back up D1 and the current secret. Preserve the old secret as `POSTQ_ENCRYPTION_KEY` and, while legacy values remain, `POSTQ_PREVIOUS_ENCRYPTION_KEY`.
2. Set the new session secret. Expect existing sessions and any auth-provider tokens encrypted by Better Auth to require re-authentication/relinking. Keep a tested owner password and operator recovery path.
3. Sign in, re-save all integration and AI provider credentials, and verify each connection. They are now versioned and encrypted with `POSTQ_ENCRYPTION_KEY`.
4. After checking that no legacy ciphertext remains, remove the previous key. Retain the archived key with the matching backup retention policy.

To rotate the credential key, retain its old value as `POSTQ_PREVIOUS_ENCRYPTION_KEY`, install a new `POSTQ_ENCRYPTION_KEY`, re-save every credential, and test before removing the old key. A failed decryption must never trigger publishing with an unrelated environment fallback.

## Lost owner password

Try an already-linked Google account first. The application intentionally does not expose a public unauthenticated reset endpoint without a configured email-verification delivery service. An operator with server/database access can recover the existing owner; this access already controls the deployment.

For local recovery, stop the app, create a private password file outside the repository, and run:

```powershell
node --experimental-transform-types scripts/recover-owner.mjs --local --email owner@example.com --password-file C:\private\postq-new-password.txt --confirm-recovery
```

The command requires the exact existing owner's email, enforces password rules, replaces only the credential account, and revokes all sessions atomically. It cannot create or change ownership. Remove the password file securely, restart, and verify sign-in. Do not put passwords in command arguments, shell history, Git, or tickets.

For a hosted instance, use the same audited recovery function in a private, temporary operator execution environment against the selected D1 binding. Verify the Worker/account/database identity first, keep publishing paused, and remove the recovery entry point after use. Do not publish an internet-accessible recovery route. Hosted execution and account selection require operator qualification; the local script never silently targets remote D1.

## Backup and restore

Keep encrypted backups outside the public repository and application assets. Backups contain private drafts, user data, credential hashes, and encrypted service credentials. Store encryption keys separately in a private secrets manager. Recommended starting targets: daily backups, an RPO of 24 hours, and an RTO of four hours; these are operating targets until measured in your deployment.

1. Set `POSTQ_PUBLISHING_PAUSED=yes` on the deployment before a coordinated backup/restore. The cron still records health and retries cleanup, but does not submit or reconcile social mutations while paused.
2. Export D1 using `wrangler d1 export DB --remote --output <private-backup.sql>` (use `--local` only for local fixtures). Record the exact database/Worker identity and schema migration version. Use a database snapshot/time-travel point where available.
3. Copy the entire private R2 namespace to a versioned private backup destination with an S3-compatible tool. Preserve object keys, original media, `/thumbnail` objects, metadata, sizes, and SHA-256 hashes. Do not use the upload UI as a backup mechanism.
4. Record stable application/encryption keys and required deployment variables in the separate secrets backup. Record the source revision/artifact and provider connection identities. Check that restored references match object keys.
5. Restore to fresh staging D1/R2 resources, with publishing paused. Apply the SQL export and required migrations. Verify object counts/hashes and sample private downloads, owner recovery/sign-in, draft revisions, media references, metrics, and encrypted settings.
6. Before enabling a restored scheduler, move restored `scheduled`/`sending` publications to `review` and set `last_error='restored_requires_owner_review'`. Preserve remote IDs, submission receipts, and attempt history. They may already have been sent after the backup point. Reconcile existing receipts and require the owner to make new explicit scheduling decisions.
7. Record measured recovery duration and recovered data age. Only then switch traffic to the restored deployment. Re-enable publishing after reconciliation and owner review. A local/mock restore does not qualify remote backup consistency.

Run a staged restore drill monthly and before significant schema changes. The regression suite covers schema rebuild, preserved ciphertext, object cleanup, and the no-replay state transition; the actual Cloudflare/S3 backup tools and credentials must also be exercised by the deployment operator.

## Publishing and queue monitoring

Settings stores `scheduler-status` with the last start, finish, and outcome. Publishing shows explicit failure codes and retains attempts. Monitor scheduler freshness (more than five minutes without a completed run), oldest due delivery (more than two minutes late), the count of `review` rows, cleanup attempts, and credential errors. Alert on actionable changes rather than every successful tick. Tune thresholds against actual provider latencies and the intended queue volume.

The runner atomically claims up to ten deliveries within a bounded submission phase. A scheduler lock prevents overlapping full runs. Stale sending claims require review, not automatic replay. YouTube settings repair uses its existing video ID; TikTok status polling retains the publish receipt beyond 24 hours. Closing locally does not cancel external processing. Read-only status checks can discover late success. Comments require explicit outcome review before a confirmed non-delivery can be retried.

The workspace detects the browser's IANA timezone automatically. Settings lets the owner turn automatic detection off and select a fixed timezone; that choice survives visits from other devices. Legacy implicit UTC defaults move to automatic detection, while an explicitly saved manual UTC choice remains valid. Calendar, composition, rescheduling, human-readable timestamps and report date filters use the workspace zone. Repeated/nonexistent DST wall minutes are rejected; choose an unambiguous time. UTC remains the storage/export format.

## Data retention and custom AI endpoints

Raw historical metrics, expired MCP requests, and assistant history are retained by default. Set `POSTQ_RETENTION_DAYS` to an integer from 30 to 3650 only after selecting a retention policy and taking a backup. Cleanup removes bounded batches; it preserves publication/draft history, active requests, and latest metric summaries. This setting can delete old proposals/chats and should be communicated to the owner.

Compatible AI endpoints must use an exact hostname approved in `POSTQ_AI_ALLOWED_HOSTS`, or a built-in common provider hostname. No wildcard or IP/port escape is accepted; redirects are rejected. The server operator must verify DNS ownership and egress policy before approving an additional hostname. Do not approve arbitrary tenant-controlled or rebinding hostnames. Changing this variable affects existing custom connections, which must be tested afterward.

## Rollback

Keep the previous Worker artifact and a tested matching database backup. Prefer a forward fix for additive migrations. Never automatically apply a destructive down migration to a live database. If a schema rollback is required, restore the matching D1/R2/secret snapshot into separate resources, keep publishing paused, reconcile post-backup remote mutations, verify the application, and then switch traffic. Worker code rollback alone cannot undo social posts or external comments.
