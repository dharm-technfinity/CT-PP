# Manager Mode (POS Billing)

Manager Mode lets a manager step into an active POS shift — without closing it — to approve a
few actions a cashier can't do alone: applying a bill discount (for cashiers without the
`Discount` role), removing a scanned item from the current bill, and cancelling a bill that
already has items in it. When the manager is done, they log out of Manager Mode and the cashier's
own session resumes automatically, with whatever the manager changed still applied.

## What it does

1. Cashier clicks **Manager Mode** on the POS footer.
2. A login modal asks for the manager's own email + password (their real login, not a shared PIN).
3. On success, the terminal is now acting as the manager: discount, item removal, and
   bill-cancel controls unlock. The shift itself is untouched — it's still the cashier's shift
   (same shift name, same "Cashier" shown in the context bar) — only *who is currently allowed to
   act* has changed.
4. The manager does whatever they came to do (discount, remove a line, cancel the bill).
5. The manager clicks **Manager Mode Active · End**. The cashier's own login is restored
   automatically, restricted controls lock again, and the bill reflects whatever the manager
   changed.

A cashier can never reach these three actions directly — the buttons/inputs are disabled
(with a "Manager approval required" tooltip) until Manager Mode is active.

## How it works technically

The POS app authenticates every API call with an explicit `Authorization: token key:secret`
header (see `getAuthHeaders` in `src/lib/api.js`) rather than relying on a browser session
cookie. That means "logging in as the manager" doesn't require a page reload or losing the
in-progress bill — it's a **credential swap**, not a navigation:

- `verifyManagerCredentials(usr, pwd)` (`src/lib/api.js`) checks the manager's password against
  the real Frappe login endpoint (`POST /api/method/login`), then resolves an API key/secret for
  them — the same resolution steps `caratdesk-login.html` already uses for the normal login page
  (`caratdesk_get_user_token`, falling back to `generate_keys`, falling back to reading the
  `User` doctype directly).
- On success, `setActiveCredentials(...)` swaps the app's active `cd_api_key` / `cd_api_secret` /
  `cd_user` / `cd_user_email` to the manager's, after first stashing the cashier's own
  credentials in `localStorage` under `cd_manager_session_v1` (see `MANAGER_SESSION_KEY` in
  `src/lib/constants.js`) so they can be restored on logout — including surviving a page refresh
  while Manager Mode is active.
- Every write made during the window (discount, line removal, a submitted invoice) is made with
  the manager's own token — so ERPNext's own `owner` / `modified_by` fields on those records
  genuinely show the manager, not the cashier. No extra "approved by" field was needed for this.
- On **End**, the stashed cashier credentials are restored the same way, and the cart/customer/
  settlements state — which lives in React state the whole time, never tied to which credentials
  are active — is left exactly as the manager last edited it.

## Authorization

Whether a given login actually counts as a "manager" is checked with the same role-gating
mechanism the POS already uses for the `Discount` / `Gold Purchase` / `Sales Return` buttons:
`canShowPosButton()` against `PP Settings1.pos_role`, a child table mapping a `button_type` to
the Frappe role(s) allowed to use it (`src/lib/api.js`). Manager Mode checks the
`'Manager Mode'` button type.

**Deployment step required (server-side, not in this repo):** an admin needs to add a row to
`PP Settings1.pos_role` with `button_type = Manager Mode` and the Frappe role that should count
as a manager on this site (e.g. `Sales Manager`). Without that row, the login step will always
be rejected — the same "fails closed, not open" behavior every other `pos_role`-gated button in
this app already has. `Administrator` / `System Manager` always pass regardless of that table,
same as the existing buttons.

## What's gated, and what isn't

| Action | Requires Manager Mode? |
|---|---|
| Bill Discount box (cart footer) | Only if the cashier lacks the `Discount` role — Manager Mode is additive on top of it |
| Per-item discount fields (Pricing Breakup popup) | Same as above |
| Removing a scanned line ("×") from the cart | Always |
| Clearing/cancelling a bill that has items in it | Always |
| Clearing an empty screen (nothing scanned yet) | Never — nothing is at stake |
| Voiding an already-submitted (paid) invoice | Not built — out of scope for this feature; "cancel" here only means the current unpaid draft |

## Relevant files

- `src/pages/POS/ManagerModeModal.jsx` — the login modal
- `src/pages/POS/index.jsx` — `handleManagerLogin` / `handleManagerLogout`, the `managerSession`
  state, and the `canEditDiscount` / `canRemoveLine` flags passed down to the cart
- `src/pages/POS/CartGrid.jsx` — where the Bill Discount box, per-line remove button, and
  Pricing Breakup discount rows are actually disabled/enabled
- `src/lib/api.js` — `verifyManagerCredentials`, `setActiveCredentials`, `getActiveCredentials`,
  `resetPosPermissionsCache`
- `src/lib/constants.js` — `MANAGER_SESSION_KEY`
