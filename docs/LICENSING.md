# Desktop licensing: current implementation

This describes the current desktop code, not the earlier offline Ed25519 proposal. There is no
Stripe fulfilment flow, Fixora licensing API, or server-side entitlement service implemented here.

## Plans and enforcement

- **Free:** 10 repairs per rolling three-hour window.
- **GO:** 50 repairs per rolling three-hour window.
- **PRO:** unlimited repairs (plus any earned referral allowance).

The authoritative plan and repair counter are enforced in Electron main by
`electron/main/lib/repair-limit.ts` and persisted through the local SQLite `repair_limit` repository.
Renderer plan state is for display/early UX only; it is not the enforcement boundary. A successful
main-side validation changes the plan. The rolling window starts with the first repair, not at
midnight.

## Activation and revalidation

`electron/main/ipc/handlers/license.handlers.ts` validates GO/PRO keys against Gumroad's public
license verification endpoint, using a fixed product-to-plan mapping. A founder/internal key path is
recognized by comparing its SHA-256 digest in main; the key or digest is intentionally not documented
here. The Gumroad key and last-successful-validation time are stored with the main-owned repair limit
record in local SQLite. This license key is not handled by the AI provider credential safeStorage
path.

At application startup, `electron/main/lib/gumroad-revalidate.ts` rechecks a stored paid key when its
last successful check is at least 24 hours old. A definitive invalid result revokes the paid plan;
network errors, timeouts, and ambiguous responses leave the existing plan unchanged. The periodic
three-hour repair-window reset is a separate timer and should not be confused with license
revalidation.

`license-store.ts` and Settings provide the renderer display/activation/upgrade experience. The main
process remains authoritative for repair limits. The renderer also persists the plan and raw license
key in localStorage so it can restore its UI and answer a main-process revalidation request. That copy
is not authoritative, but it is plaintext renderer storage and is a security follow-up. Gumroad
checkout links are opened by the upgrade flow; purchase fulfillment and customer support operations
remain external/manual processes.

## Security and operational limits

- Gumroad keys are sensitive. Do not log, paste into documentation, or include in support artifacts.
- The founder/internal comparison is a local code path, not proof of a server-verified founder
  identity. Anyone able to patch a local binary can bypass local client-side checks; the main-side
  limit is an application boundary, not a remote anti-tamper system.
- The database stores the license key locally in the repair-limit record. Do not describe this as
  OS-keychain-encrypted; `safeStorage` is used for AI provider credentials, not this license record.
- The renderer's persisted license key is also not protected by `safeStorage`; it is not an enforcement
  authority, but renderer compromise/local profile access can expose it.
- This implementation is online-at-activation/revalidation, not an offline signed-token design.

Relevant implementation: `packages/shared-types/src/license.ts`,
`apps/desktop/electron/main/ipc/handlers/license.handlers.ts`,
`apps/desktop/electron/main/lib/repair-limit.ts`,
`apps/desktop/electron/main/lib/gumroad-revalidate.ts`, and
`apps/desktop/src/features/settings` / `apps/desktop/src/stores/license-store.ts`.
