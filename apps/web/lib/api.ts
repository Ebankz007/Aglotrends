/**
 * API client. The session lives in an httpOnly cookie set by the API — the
 * browser attaches it to every same-origin `/api/*` call (proxied to the
 * backend by next.config.ts). JavaScript never sees the token, so an XSS has
 * nothing to exfiltrate. The bearer path exists on the server for non-browser
 * clients; the web app does not use it.
 */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "same-origin",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!res.ok) {
    let body: { error?: string; code?: string } | null = null;
    try {
      body = (await res.json()) as { error?: string; code?: string };
    } catch {
      // non-JSON error body
    }
    // The API sends { error: <human message>, code: <MACHINE_CODE> }. `code` is
    // what callers branch on (TWO_FACTOR_REQUIRED, AREA_FORBIDDEN, ...), so it
    // must carry the machine code, not the message.
    throw new ApiError(
      res.status,
      body?.code ?? "REQUEST_ERROR",
      body?.error ?? `Request failed (${res.status})`,
    );
  }
  return res.json() as Promise<T>;
}

/* ------------------------------------------------------------------ types */

export type UserRole = "MEMBER" | "ADMIN" | "SUPERADMIN";
export type AccountStatus = "PENDING" | "ACTIVE" | "SUSPENDED";

/** ADMIN and SUPERADMIN both reach the admin console. */
export function isAdminRole(role: UserRole | undefined | null): boolean {
  return role === "ADMIN" || role === "SUPERADMIN";
}

export type PermissionLevel = "NONE" | "VIEW" | "MANAGE";

/**
 * Admin areas. The server owns the authoritative list (labels and descriptions
 * come from `fetchPermissionCatalog`), but the console needs the identifiers at
 * compile time to map its tabs to areas.
 */
export type AdminArea =
  | "MEMBERS"
  | "BROKERS"
  | "SIGNALS"
  | "FINANCE"
  | "KYC"
  | "CONTENT"
  | "SETTINGS"
  | "STAFF"
  | "AUDIT";

export type PermissionMap = Partial<Record<AdminArea, PermissionLevel>>;

export interface PermissionAreaDto {
  id: AdminArea;
  label: string;
  description: string;
}

export interface PermissionCatalogDto {
  areas: PermissionAreaDto[];
  levels: PermissionLevel[];
}

export interface UserDto {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  status: AccountStatus;
  sponsorId: string | null;
  /** Public join handle (e.g. K7Q2M9XD). Null until minted (registration mints). */
  referralCode: string | null;
  /** Shareable join link (/register?ref=CODE). Null when no code yet. */
  referralLink: string | null;
  /** False until the §1 registration fee is settled — gates compensation. */
  isActiveMember: boolean;
  highestAssociateRank: number;
  highestLeadershipRank: number;
  /** Whether a TOTP second factor is enrolled. */
  twoFactorEnabled: boolean;
  /** Area grants. Empty for members. */
  permissions: PermissionMap;
  /** When true, every granted area is capped at VIEW. */
  viewOnly: boolean;
}

/** Roles that can reach the admin console at all. */
export function isStaffRole(role: UserRole | undefined | null): boolean {
  return role === "ADMIN" || role === "SUPERADMIN";
}

/**
 * Whether `user` can see `area`. SUPERADMIN bypasses grants structurally — the
 * API does the same, so this is UX, not security.
 */
export function canViewArea(user: UserDto | null, area: AdminArea): boolean {
  if (!user) return false;
  if (user.role === "SUPERADMIN") return true;
  return (user.permissions[area] ?? "NONE") !== "NONE";
}

/**
 * Whether `user` can change things in `area`. A view-only staffer never can,
 * regardless of the grant — the cap is applied server-side too.
 */
export function canManageArea(user: UserDto | null, area: AdminArea): boolean {
  if (!user) return false;
  if (user.role === "SUPERADMIN") return true;
  if (user.viewOnly) return false;
  return user.permissions[area] === "MANAGE";
}

export interface LedgerEntryDto {
  id: string;
  userId: string;
  type: string;
  amountCents: number;
  balanceAfterCents: number;
  sourceUserId: string | null;
  refType: string | null;
  refId: string | null;
  description: string | null;
  createdAt: string;
}

export interface NotificationDto {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationSettingsDto {
  emailEnabled: boolean;
  whatsappEnabled: boolean;
  telegramEnabled: boolean;
  whatsappNumber: string | null;
  telegramChatId: string | null;
}

export interface NetworkSummaryDto {
  personalReferrals: number;
  rawTeamVolume: number;
  eligibleTeamVolume: number;
  directReferrals: string[];
  downlineCount: number;
  highestAssociateRank: number;
  highestLeadershipRank: number;
}

export interface RankProgressDto {
  personalReferrals: number;
  eligibleTeamVolume: number;
  highestAssociateRank: number;
  highestLeadershipRank: number;
  nextAssociate: {
    rankId: number;
    minPersonalReferrals: number;
    minTeamVolume: number;
    rewardCents: number;
    referralsMet: boolean;
    volumeMet: boolean;
  } | null;
  nextLeadership: {
    rankId: number;
    name: string;
    requiredAssociateRank: number;
    minLegs: number;
    minTeamMembers: number;
    rewardSku: string;
  } | null;
}

export interface PayoutDto {
  id: string;
  userId: string;
  type: string;
  amountCents: number;
  status: "REQUESTED" | "APPROVED" | "REJECTED" | "PAID";
  method: string | null;
  details: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface SignalDto {
  id: string;
  authorId: string | null;
  title: string;
  instrument: string;
  direction: "BUY" | "SELL" | "NEUTRAL";
  entryPrice: string | null;
  stopLoss: string | null;
  takeProfit: string | null;
  timeframe: string | null;
  notes: string | null;
  status: "DRAFT" | "PUBLISHED" | "CLOSED";
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BrokerLinkDto {
  id: string;
  name: string;
  url: string;
  description: string | null;
  logoUrl: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface StrategyDto {
  id: string;
  name: string;
  traderName: string;
  description: string | null;
  avatarUrl: string | null;
  riskLevel: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface BrokerAccountDto {
  id: string;
  userId: string;
  brokerLinkId: string;
  accountRef: string;
  status: "PENDING" | "VERIFIED" | "REJECTED";
  fundedAmountCents: number;
  verifiedBy: string | null;
  verifiedAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminMemberDto {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  status: AccountStatus;
  sponsorId: string | null;
  sponsorEmail: string | null;
  sponsorCode: string | null;
  referralCode: string | null;
  isActiveMember: boolean;
  highestAssociateRank: number;
  highestLeadershipRank: number;
  createdAt: string;
}

export interface SettlementDto {
  id: string;
  userId: string;
  periodStart: string;
  periodEnd: string;
  realizedProfitCents: number;
  clientCents: number;
  sponsorCents: number;
  companyCents: number;
  status: "RECORDED" | "DISTRIBUTED";
  recordedBy: string | null;
  createdAt: string;
}

export interface RankAwardDto {
  id: string;
  userId: string;
  kind: "ASSOCIATE" | "LEADERSHIP";
  rankId: number;
  rewardCents: number | null;
  rewardSku: string | null;
  status: "PAID" | "FLAGGED" | "APPROVED" | "REJECTED";
  approvedBy: string | null;
  approvedAt: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface PoolLedgerEntryDto {
  id: string;
  pool: "RANK" | "LEADERSHIP";
  entryType: "ACCRUAL" | "PAYOUT";
  amountCents: number;
  balanceAfterCents: number;
  refType: string | null;
  refId: string | null;
  createdAt: string;
}

export interface AuditEntryDto {
  id: string;
  actorId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: unknown;
  ip: string | null;
  createdAt: string;
}

/* ------------------------------------------------------------------- auth */

export interface RegisterInput {
  email: string;
  password: string;
  fullName: string;
  phone?: string;
  country?: string;
  /** Sponsor's referral code (required). */
  referralCode: string;
}

export async function register(
  input: RegisterInput,
): Promise<{ user: UserDto; paymentRequired: boolean }> {
  return request<{ user: UserDto; paymentRequired: boolean }>("/auth/register", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/**
 * Step one of login. When the account has a second factor enrolled the API does
 * NOT issue a session — it returns a short-lived challenge token that must be
 * exchanged through `verifyTwoFactor`. Callers must branch on the result.
 */
export type LoginResult =
  | { twoFactorRequired: true; challengeToken: string }
  | { twoFactorRequired?: false; user: UserDto };

export async function login(email: string, password: string): Promise<LoginResult> {
  return request<LoginResult>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

/**
 * Request a password-reset link. Always resolves — the API answers 200 whether
 * the address exists or not, so callers must show the same "check your inbox"
 * note unconditionally and never branch on the result.
 */
export async function forgotPassword(email: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>("/auth/forgot", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

/** Redeem a reset link with a new password. Does not log the member in. */
export async function resetPassword(token: string, password: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>("/auth/reset", {
    method: "POST",
    body: JSON.stringify({ token, password }),
  });
}

/* ------------------------------------------------------- two-factor auth */

export interface TwoFactorStatusDto {
  enabled: boolean;
  enrolledAt: string | null;
  recoveryCodesRemaining: number;
}

export interface TwoFactorSetupDto {
  /** Base32 seed, for manual entry when a QR cannot be scanned. */
  secret: string;
  otpauthUri: string;
  /** PNG data URI, rendered server-side so the seed never leaves the API. */
  qrDataUrl: string;
}

/** Step two of login: trade the challenge token plus a code for a session. */
export async function verifyTwoFactor(
  challengeToken: string,
  code: string,
): Promise<{ user: UserDto }> {
  return request<{ user: UserDto }>("/auth/2fa/verify", {
    method: "POST",
    body: JSON.stringify({ challengeToken, code }),
  });
}

export async function fetchTwoFactorStatus(): Promise<TwoFactorStatusDto> {
  return request<TwoFactorStatusDto>("/auth/2fa/status");
}

export async function setupTwoFactor(): Promise<TwoFactorSetupDto> {
  return request<TwoFactorSetupDto>("/auth/2fa/setup", { method: "POST" });
}

/** Confirms enrolment. Returns the recovery codes, which are shown only once. */
export async function enableTwoFactor(code: string): Promise<{ recoveryCodes: string[] }> {
  return request<{ recoveryCodes: string[] }>("/auth/2fa/enable", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

/** Turning 2FA off is itself a downgrade, so it takes both factors. */
export async function disableTwoFactor(password: string, code: string): Promise<void> {
  await request<{ enabled: boolean }>("/auth/2fa/disable", {
    method: "POST",
    body: JSON.stringify({ password, code }),
  });
}

export async function regenerateRecoveryCodes(code: string): Promise<{ recoveryCodes: string[] }> {
  return request<{ recoveryCodes: string[] }>("/auth/2fa/recovery-codes", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

export async function logout(): Promise<void> {
  try {
    await request<{ ok: true }>("/auth/logout", { method: "POST", body: JSON.stringify({}) });
  } catch {
    // Clearing the cookie is best-effort; the UI navigates away regardless.
  }
}

/** The logged-in user, or null when there is no valid session. */
export async function fetchMe(): Promise<UserDto | null> {
  try {
    const data = await request<{ user: UserDto }>("/auth/me");
    return data.user;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

/* ------------------------------------------------------- me / preferences */

export async function fetchMyWallet(): Promise<number> {
  const data = await request<{ balanceCents: number }>("/me/wallet");
  return data.balanceCents;
}

export async function fetchMyLedger(): Promise<LedgerEntryDto[]> {
  const data = await request<{ entries: LedgerEntryDto[] }>("/me/ledger");
  return data.entries;
}

export async function fetchMyNotifications(): Promise<NotificationDto[]> {
  const data = await request<{ notifications: NotificationDto[] }>("/me/notifications");
  return data.notifications;
}

export async function fetchNotificationSettings(): Promise<NotificationSettingsDto> {
  const data = await request<{ settings: NotificationSettingsDto }>("/me/notification-settings");
  return data.settings;
}

export async function saveNotificationSettings(
  input: Partial<NotificationSettingsDto>,
): Promise<NotificationSettingsDto> {
  const data = await request<{ settings: NotificationSettingsDto }>("/me/notification-settings", {
    method: "PUT",
    body: JSON.stringify(input),
  });
  return data.settings;
}

/* --------------------------------------------------------------- network */

export async function fetchNetwork(): Promise<NetworkSummaryDto> {
  return request<NetworkSummaryDto>("/network");
}

export async function fetchMatrix(): Promise<{ position: string; children: string[] }> {
  return request<{ position: string; children: string[] }>("/network/matrix");
}

export async function fetchRankProgress(): Promise<RankProgressDto> {
  return request<RankProgressDto>("/network/ranks");
}

/* ---------------------------------------------------------------- wallet */

export async function fetchWallet(): Promise<number> {
  const data = await request<{ balanceCents: number }>("/wallet");
  return data.balanceCents;
}

export async function fetchLedger(): Promise<LedgerEntryDto[]> {
  const data = await request<{ entries: LedgerEntryDto[] }>("/wallet/ledger");
  return data.entries;
}

export async function fetchMyPayouts(): Promise<PayoutDto[]> {
  const data = await request<{ payouts: PayoutDto[] }>("/wallet/payouts");
  return data.payouts;
}

export async function requestPayout(input: {
  amountCents: number;
  method?: string;
  details?: string;
}): Promise<PayoutDto> {
  const data = await request<{ payout: PayoutDto }>("/wallet/payouts", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return data.payout;
}

/* -------------------------------------------------------------- payments */

export type PaymentPurpose = "REGISTRATION" | "DEPOSIT";
export type PaymentStatus = "PENDING" | "PAID" | "EXPIRED" | "FAILED";

export interface PaymentDto {
  id: string;
  userId: string;
  purpose: PaymentPurpose;
  amountCents: number;
  currency: string;
  status: PaymentStatus;
  paymentRef: string;
  gatewayTxid: string | null;
  paymentUrl: string | null;
  txHash: string | null;
  paidAt: string | null;
  createdAt: string;
}

export async function fetchMyPayments(): Promise<PaymentDto[]> {
  const data = await request<{ payments: PaymentDto[] }>("/payments");
  return data.payments;
}

/** Create the §1 registration-fee invoice ($20, fixed by the server). */
export async function createRegistrationPayment(): Promise<PaymentDto> {
  const data = await request<{ payment: PaymentDto }>("/payments/registration", {
    method: "POST",
    body: JSON.stringify({}),
  });
  return data.payment;
}

/** Create a crypto-deposit invoice; the wallet is credited when it confirms. */
export async function createDeposit(amountCents: number): Promise<PaymentDto> {
  const data = await request<{ payment: PaymentDto }>("/payments/deposit", {
    method: "POST",
    body: JSON.stringify({ amountCents }),
  });
  return data.payment;
}

/** A fresh checkout URL for a pending invoice (the gateway link expires). */
export async function refreshCheckout(
  paymentId: string,
): Promise<{ paymentUrl: string; refreshed: boolean }> {
  return request<{ paymentUrl: string; refreshed: boolean }>(`/payments/${paymentId}/checkout`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

/* --------------------------------------------------------------- signals */

export async function fetchSignals(): Promise<SignalDto[]> {
  const data = await request<{ signals: SignalDto[] }>("/signals");
  return data.signals;
}

export async function fetchSignal(id: string): Promise<SignalDto> {
  const data = await request<{ signal: SignalDto }>(`/signals/${id}`);
  return data.signal;
}

/* --------------------------------------------------------------- brokers */

export async function fetchBrokers(): Promise<BrokerLinkDto[]> {
  const data = await request<{ brokers: BrokerLinkDto[] }>("/brokers");
  return data.brokers;
}

export async function fetchStrategies(): Promise<StrategyDto[]> {
  const data = await request<{ strategies: StrategyDto[] }>("/brokers/strategies");
  return data.strategies;
}

export async function fetchMyBrokerAccounts(): Promise<BrokerAccountDto[]> {
  const data = await request<{ accounts: BrokerAccountDto[] }>("/brokers/accounts");
  return data.accounts;
}

export async function addBrokerAccount(input: {
  brokerLinkId: string;
  accountRef: string;
  fundedAmountCents?: number;
  notes?: string;
}): Promise<BrokerAccountDto> {
  const data = await request<{ account: BrokerAccountDto }>("/brokers/accounts", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return data.account;
}

/* ----------------------------------------------------------------- admin */

export async function fetchAdminMembers(): Promise<AdminMemberDto[]> {
  const data = await request<{ members: AdminMemberDto[] }>("/admin/members");
  return data.members;
}

export async function updateAdminMember(
  memberId: string,
  patch: { role?: UserRole; status?: AccountStatus; isActiveMember?: boolean },
): Promise<AdminMemberDto> {
  const data = await request<{ member: AdminMemberDto }>(`/admin/members/${memberId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  return data.member;
}

/**
 * Move a member under a new sponsor. Returns the updated member plus the
 * server's note on money semantics (past payouts stand; future attribution
 * follows the new sponsor; matrix seat unchanged).
 */
export async function moveMemberSponsor(
  memberId: string,
  sponsorCode: string,
): Promise<{ member: AdminMemberDto; note: string }> {
  const data = await request<{ member: AdminMemberDto; note: string }>(
    `/admin/members/${memberId}/sponsor`,
    {
      method: "PATCH",
      body: JSON.stringify({ sponsorCode }),
    },
  );
  return data;
}

export async function fetchAdminBrokerLinks(): Promise<BrokerLinkDto[]> {
  const data = await request<{ brokers: BrokerLinkDto[] }>("/admin/broker-links");
  return data.brokers;
}

export async function createBrokerLink(input: {
  name: string;
  url: string;
  description?: string;
  sortOrder?: number;
}): Promise<BrokerLinkDto> {
  const data = await request<{ broker: BrokerLinkDto }>("/admin/broker-links", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return data.broker;
}

export async function updateBrokerLink(
  id: string,
  patch: Partial<Pick<BrokerLinkDto, "name" | "url" | "description" | "isActive" | "sortOrder">>,
): Promise<BrokerLinkDto> {
  const data = await request<{ broker: BrokerLinkDto }>(`/admin/broker-links/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  return data.broker;
}

export async function deactivateBrokerLink(id: string): Promise<BrokerLinkDto> {
  const data = await request<{ broker: BrokerLinkDto }>(`/admin/broker-links/${id}`, {
    method: "DELETE",
  });
  return data.broker;
}

export async function fetchAdminBrokerAccounts(): Promise<BrokerAccountDto[]> {
  const data = await request<{ accounts: BrokerAccountDto[] }>("/admin/broker-accounts");
  return data.accounts;
}

export async function verifyBrokerAccount(
  id: string,
  status: "VERIFIED" | "REJECTED",
  notes?: string,
): Promise<BrokerAccountDto> {
  const data = await request<{ account: BrokerAccountDto }>(`/admin/broker-accounts/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ status, notes }),
  });
  return data.account;
}

export async function fetchAdminSignals(): Promise<SignalDto[]> {
  const data = await request<{ signals: SignalDto[] }>("/admin/signals");
  return data.signals;
}

export async function createSignal(input: {
  title: string;
  instrument: string;
  direction: "BUY" | "SELL" | "NEUTRAL";
  entryPrice?: string;
  stopLoss?: string;
  takeProfit?: string;
  timeframe?: string;
  notes?: string;
  publish?: boolean;
}): Promise<SignalDto> {
  const data = await request<{ signal: SignalDto }>("/admin/signals", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return data.signal;
}

export async function publishSignal(id: string): Promise<SignalDto> {
  const data = await request<{ signal: SignalDto }>(`/admin/signals/${id}/publish`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  return data.signal;
}

export async function fetchAdminSettlements(): Promise<SettlementDto[]> {
  const data = await request<{ settlements: SettlementDto[] }>("/admin/settlements");
  return data.settlements;
}

export async function recordSettlement(input: {
  userId: string;
  periodStart: string;
  periodEnd: string;
  realizedProfitCents: number;
}): Promise<SettlementDto> {
  const data = await request<{ settlement: SettlementDto }>("/admin/settlements", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return data.settlement;
}

export async function runRankEvaluation(): Promise<unknown> {
  const data = await request<{ result: unknown }>("/admin/ranks/evaluate", {
    method: "POST",
    body: JSON.stringify({}),
  });
  return data.result;
}

export async function fetchRankAwards(): Promise<RankAwardDto[]> {
  const data = await request<{ awards: RankAwardDto[] }>("/admin/rank-awards");
  return data.awards;
}

export async function fetchPools(): Promise<{
  balances: Record<string, number>;
  entries: PoolLedgerEntryDto[];
}> {
  return request<{ balances: Record<string, number>; entries: PoolLedgerEntryDto[] }>("/admin/pools");
}

export async function fetchAdminPayouts(): Promise<PayoutDto[]> {
  const data = await request<{ payouts: PayoutDto[] }>("/admin/payouts");
  return data.payouts;
}

export async function approvePayout(id: string): Promise<PayoutDto> {
  const data = await request<{ payout: PayoutDto }>(`/admin/payouts/${id}/approve`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  return data.payout;
}

export async function rejectPayout(id: string): Promise<PayoutDto> {
  const data = await request<{ payout: PayoutDto }>(`/admin/payouts/${id}/reject`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  return data.payout;
}

export async function payPayout(id: string): Promise<PayoutDto> {
  const data = await request<{ payout: PayoutDto }>(`/admin/payouts/${id}/pay`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  return data.payout;
}

export interface AdminPaymentDto {
  id: string;
  userId: string;
  userEmail: string;
  userFullName: string;
  purpose: PaymentPurpose;
  amountCents: number;
  currency: string;
  status: PaymentStatus;
  paymentRef: string;
  gatewayTxid: string | null;
  txHash: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface AdminPaymentSummaryDto {
  registrationCollectedCents: number;
  registrationPaidCount: number;
  registrationPendingCount: number;
  depositCollectedCents: number;
  depositPaidCount: number;
  depositPendingCount: number;
}

export interface UnpaidMemberDto {
  id: string;
  email: string;
  fullName: string;
  createdAt: string;
}

export interface AdminPaymentsDto {
  payments: AdminPaymentDto[];
  summary: AdminPaymentSummaryDto;
  unpaidMembers: UnpaidMemberDto[];
}

export async function fetchAdminPayments(): Promise<AdminPaymentsDto> {
  return request<AdminPaymentsDto>("/admin/payments");
}

/** Settle an invoice off-rail. Idempotent — routes through the webhook path. */
export async function confirmPayment(
  id: string,
  txHash?: string,
): Promise<{ applied: boolean; purpose: string; userId: string; compensationRun: boolean }> {
  const data = await request<{
    result: { applied: boolean; purpose: string; userId: string; compensationRun: boolean };
  }>(`/admin/payments/${id}/confirm`, {
    method: "POST",
    body: JSON.stringify(txHash ? { txHash } : {}),
  });
  return data.result;
}

/** Expire a stale PENDING invoice (no ledger effect). */
export async function cancelPayment(id: string): Promise<PaymentDto> {
  const data = await request<{ payment: PaymentDto }>(`/admin/payments/${id}/cancel`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  return data.payment;
}

export async function fetchAuditLog(): Promise<AuditEntryDto[]> {
  const data = await request<{ entries: AuditEntryDto[] }>("/admin/audit");
  return data.entries;
}

/* ----------------------------------------------------------- admin: staff */

export interface StaffMemberDto {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  status: AccountStatus;
  permissions: PermissionMap;
  viewOnly: boolean;
  twoFactorEnabled: boolean;
  twoFactorEnrolledAt: string | null;
  createdAt: string;
  lastLoginAt: string | null;
}

export async function fetchAdminStaff(): Promise<StaffMemberDto[]> {
  const data = await request<{ staff: StaffMemberDto[] }>("/admin/staff");
  return data.staff;
}

/** The area catalog, so the matrix is rendered from the server's definition. */
export async function fetchPermissionCatalog(): Promise<PermissionCatalogDto> {
  return request<PermissionCatalogDto>("/admin/permissions/catalog");
}

/**
 * Set a staff member's role, area grants and view-only cap. SUPERADMIN only.
 * Omitted fields are left untouched.
 */
export async function updateStaff(
  id: string,
  input: { role?: "ADMIN" | "SUPERADMIN"; viewOnly?: boolean; permissions?: PermissionMap },
): Promise<StaffMemberDto> {
  const data = await request<{ staff: StaffMemberDto }>(`/admin/staff/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  return data.staff;
}

/** Provision a staff account. SUPERADMIN only — the API enforces it. */
export async function createStaff(input: {
  email: string;
  fullName: string;
  password: string;
  role: "ADMIN" | "SUPERADMIN";
}): Promise<StaffMemberDto> {
  const data = await request<{ staff: StaffMemberDto }>("/admin/staff", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return data.staff;
}

/* -------------------------------------------------------- admin: settings */

export interface GatewaySettingsDto {
  provider: string;
  apiUrl: string;
  walletAddress: string;
  network: string;
  asset: string;
  forceMock: boolean;
  hasToken: boolean;
  hasWebhookSecret: boolean;
  tokenSource: "database" | "environment" | "unset";
  webhookSecretSource: "database" | "environment" | "unset";
  mockActive: boolean;
  /** False when the API has no SECRET_ENCRYPTION_KEY — secrets are plaintext. */
  secretsEncrypted: boolean;
}

export interface PlatformSettingsDto {
  name: string;
  registrationOpen: boolean;
}

export interface PlatformFeeSettingsDto {
  walletAddress: string;
  network: string;
  asset: string;
  amountCents: number;
  enabled: boolean;
  /** The amount actually applied to new payments (0 when disabled). */
  effectiveAmountCents: number;
  walletConfigured: boolean;
}

export interface AdminSettingsDto {
  gateway: GatewaySettingsDto;
  platform: PlatformSettingsDto;
  fees: PlatformFeeSettingsDto;
  /** Stored overrides, or null when the landing page is on its defaults. */
  content: Record<string, unknown> | null;
}

export async function fetchAdminSettings(): Promise<AdminSettingsDto> {
  return request<AdminSettingsDto>("/admin/settings");
}

/**
 * Save the payment-gateway configuration. `token` / `webhookSecret` are
 * write-only: pass a string to set, `null` to clear (env fallback resumes), or
 * omit to leave untouched. Reads never return the values.
 */
export async function saveGatewaySettings(input: {
  provider?: string;
  apiUrl?: string;
  walletAddress?: string;
  network?: string;
  asset?: string;
  forceMock?: boolean;
  token?: string | null;
  webhookSecret?: string | null;
}): Promise<GatewaySettingsDto> {
  const data = await request<{ gateway: GatewaySettingsDto }>("/admin/settings/gateway", {
    method: "PUT",
    body: JSON.stringify(input),
  });
  return data.gateway;
}

export async function savePlatformSettings(input: {
  name?: string;
  registrationOpen?: boolean;
}): Promise<PlatformSettingsDto> {
  const data = await request<{ platform: PlatformSettingsDto }>("/admin/settings/platform", {
    method: "PUT",
    body: JSON.stringify(input),
  });
  return data.platform;
}

/**
 * The operator's transaction-fee wallet. SUPERADMIN only — this address
 * receives platform revenue and is distinct from the gateway receiving wallet.
 */
export async function savePlatformFeeSettings(input: {
  walletAddress?: string;
  network?: string;
  asset?: string;
  amountCents?: number;
  enabled?: boolean;
}): Promise<PlatformFeeSettingsDto> {
  const data = await request<{ fees: PlatformFeeSettingsDto }>("/admin/settings/fees", {
    method: "PUT",
    body: JSON.stringify(input),
  });
  return data.fees;
}

export async function saveSiteContent(content: unknown): Promise<Record<string, unknown>> {
  const data = await request<{ content: Record<string, unknown> }>("/admin/settings/content", {
    method: "PUT",
    body: JSON.stringify({ content }),
  });
  return data.content;
}

/* ------------------------------------------------------ admin: integrations */

export type SecretSource = "database" | "environment" | "unset";

/**
 * The outbound API credentials, as the console sees them. Secrets are
 * write-only: the API reports `hasToken` and where the value came from, never
 * the value itself.
 */
export interface IntegrationsDto {
  email: {
    enabled: boolean;
    from: string;
    replyTo: string;
    hasSmtpUrl: boolean;
    smtpUrlSource: SecretSource;
    configured: boolean;
  };
  whatsapp: {
    enabled: boolean;
    phoneId: string;
    hasToken: boolean;
    tokenSource: SecretSource;
    configured: boolean;
  };
  telegram: {
    enabled: boolean;
    hasBotToken: boolean;
    botTokenSource: SecretSource;
    configured: boolean;
  };
  /** False when the API has no SECRET_ENCRYPTION_KEY — secrets are plaintext. */
  secretsEncrypted: boolean;
}

export interface AdminIntegrationsDto {
  integrations: IntegrationsDto;
  /** The payment gateway is an integration too — surfaced in the same tab. */
  gateway: GatewaySettingsDto;
}

export async function fetchIntegrations(): Promise<AdminIntegrationsDto> {
  return request<AdminIntegrationsDto>("/admin/integrations");
}

/**
 * Save channel credentials. Secrets are write-only: pass a string to set, `null`
 * to clear (env fallback resumes), or omit to leave untouched.
 */
export async function saveIntegrations(input: {
  email?: { enabled?: boolean; from?: string; replyTo?: string; smtpUrl?: string | null };
  whatsapp?: { enabled?: boolean; phoneId?: string; token?: string | null };
  telegram?: { enabled?: boolean; botToken?: string | null };
}): Promise<IntegrationsDto> {
  const data = await request<{ integrations: IntegrationsDto }>("/admin/integrations", {
    method: "PUT",
    body: JSON.stringify(input),
  });
  return data.integrations;
}

/* ------------------------------------------------------ admin: social links */

export interface SocialLinkDto {
  id: string;
  /** Stable key used to pick the icon — e.g. `x`, `instagram`, `telegram`. */
  platform: string;
  label: string;
  url: string;
  handle: string;
  enabled: boolean;
  sortOrder: number;
}

export interface SocialDto {
  links: SocialLinkDto[];
}

export async function fetchSocialSettings(): Promise<SocialDto> {
  return request<SocialDto>("/admin/social");
}

export async function saveSocialSettings(input: SocialDto): Promise<SocialDto> {
  const data = await request<{ social: SocialDto }>("/admin/social", {
    method: "PUT",
    body: JSON.stringify(input),
  });
  return data.social;
}

/* ----------------------------------------------------- admin: broadcasts */

export type BroadcastAudience = "ALL" | "ACTIVE" | "INACTIVE" | "STAFF";

export interface BroadcastResultDto {
  recipients: number;
  emailsSent: number;
}

export async function sendBroadcast(input: {
  title: string;
  body: string;
  link?: string | null;
  audience: BroadcastAudience;
  sendEmail?: boolean;
}): Promise<BroadcastResultDto> {
  const data = await request<{ result: BroadcastResultDto }>("/admin/notifications/broadcast", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return data.result;
}

export async function fetchBroadcasts(): Promise<AuditEntryDto[]> {
  const data = await request<{ broadcasts: AuditEntryDto[] }>("/admin/notifications");
  return data.broadcasts;
}

/* --------------------------------------------------- admin: platform fees */

export interface PlatformFeeDto {
  id: string;
  userId: string;
  userEmail: string | null;
  paymentId: string | null;
  purpose: PaymentPurpose;
  amountCents: number;
  currency: string;
  walletAddress: string;
  network: string;
  asset: string;
  status: "PENDING" | "SETTLED";
  settledAt: string | null;
  settledBy: string | null;
  note: string | null;
  createdAt: string;
}

export interface PlatformFeeSummaryDto {
  totalCents: number;
  pendingCents: number;
  settledCents: number;
  totalCount: number;
  pendingCount: number;
  settledCount: number;
}

export interface AdminPlatformFeesDto {
  fees: PlatformFeeDto[];
  summary: PlatformFeeSummaryDto;
}

export async function fetchAdminPlatformFees(
  status?: "PENDING" | "SETTLED",
): Promise<AdminPlatformFeesDto> {
  const qs = status ? `?status=${status}` : "";
  return request<AdminPlatformFeesDto>(`/admin/platform-fees${qs}`);
}

/** Mark specific fees settled after the operator has moved the funds by hand. */
export async function settlePlatformFees(
  ids: string[],
  note?: string,
): Promise<{ settled: number }> {
  const data = await request<{ result: { settled: number } }>("/admin/platform-fees/settle", {
    method: "POST",
    body: JSON.stringify({ ids, note }),
  });
  return data.result;
}

/** Settle every PENDING fee — the "sweep the wallet" action. */
export async function settleAllPendingFees(note?: string): Promise<{ settled: number }> {
  const data = await request<{ result: { settled: number } }>("/admin/platform-fees/settle-all", {
    method: "POST",
    body: JSON.stringify({ note }),
  });
  return data.result;
}

/* ------------------------------------------------------------------ KYC/AML */

export type KycStatus = "NOT_STARTED" | "PENDING" | "VERIFIED" | "REJECTED";

export interface KycDto {
  status: KycStatus;
  legalName: string | null;
  dateOfBirth: string | null;
  country: string | null;
  address: string | null;
  idType: string | null;
  /** MASKED — the full document number never leaves the server. */
  idNumberMasked: string | null;
  documents: unknown;
  submittedAt: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
}

export async function fetchMyKyc(): Promise<KycDto> {
  const data = await request<{ kyc: KycDto }>("/kyc");
  return data.kyc;
}

export async function submitKyc(input: {
  legalName: string;
  dateOfBirth: string;
  country: string;
  address: string;
  idType: string;
  idNumber: string;
  documents?: unknown;
}): Promise<KycDto> {
  const data = await request<{ kyc: KycDto }>("/kyc", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return data.kyc;
}

export interface AdminKycDto extends KycDto {
  id: string;
  userId: string;
  userEmail: string | null;
  userFullName: string | null;
  reviewedBy: string | null;
}

export async function fetchAdminKyc(status?: KycStatus): Promise<AdminKycDto[]> {
  const qs = status ? `?status=${status}` : "";
  const data = await request<{ submissions: AdminKycDto[] }>(`/admin/kyc${qs}`);
  return data.submissions;
}

export async function reviewKyc(
  userId: string,
  decision: "VERIFIED" | "REJECTED",
  reason?: string,
): Promise<KycDto> {
  const data = await request<{ kyc: KycDto }>(`/admin/kyc/${userId}/review`, {
    method: "POST",
    body: JSON.stringify({ decision, reason }),
  });
  return data.kyc;
}

/* ------------------------------------------------------------- education */

export type EducationResourceType = "ARTICLE" | "VIDEO" | "LINK";

export interface EducationResourceDto {
  id: string;
  title: string;
  summary: string | null;
  body: string | null;
  category: string;
  level: string | null;
  resourceType: EducationResourceType;
  url: string | null;
  coverImageUrl: string | null;
  isPublished: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface EducationResourceInputDto {
  title: string;
  summary?: string | null;
  body?: string | null;
  category?: string;
  level?: string | null;
  resourceType?: EducationResourceType;
  url?: string | null;
  coverImageUrl?: string | null;
  isPublished?: boolean;
  sortOrder?: number;
}

export async function fetchEducationResources(): Promise<EducationResourceDto[]> {
  const data = await request<{ resources: EducationResourceDto[] }>("/education");
  return data.resources;
}

export async function fetchEducationResource(id: string): Promise<EducationResourceDto> {
  const data = await request<{ resource: EducationResourceDto }>(`/education/${id}`);
  return data.resource;
}

export async function fetchAdminEducation(): Promise<EducationResourceDto[]> {
  const data = await request<{ resources: EducationResourceDto[] }>("/admin/education");
  return data.resources;
}

export async function createEducationResource(
  input: EducationResourceInputDto,
): Promise<EducationResourceDto> {
  const data = await request<{ resource: EducationResourceDto }>("/admin/education", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return data.resource;
}

export async function updateEducationResource(
  id: string,
  patch: Partial<EducationResourceInputDto>,
): Promise<EducationResourceDto> {
  const data = await request<{ resource: EducationResourceDto }>(`/admin/education/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  return data.resource;
}

export async function deleteEducationResource(id: string): Promise<void> {
  await request<{ resource: EducationResourceDto }>(`/admin/education/${id}`, { method: "DELETE" });
}

/* ---------------------------------------------------------------- events */

export type RsvpStatus = "GOING" | "CANCELLED";

export interface EventDto {
  id: string;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string | null;
  location: string | null;
  url: string | null;
  coverImageUrl: string | null;
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
  /** Live count of GOING members. */
  rsvpCount: number;
  /** The caller's own RSVP, or null when they have not responded. */
  myRsvp: RsvpStatus | null;
}

/** Admin event rows carry no per-caller RSVP decoration. */
export type AdminEventDto = Omit<EventDto, "rsvpCount" | "myRsvp">;

export interface EventInputDto {
  title: string;
  description?: string | null;
  startsAt: string;
  endsAt?: string | null;
  location?: string | null;
  url?: string | null;
  coverImageUrl?: string | null;
  isPublished?: boolean;
}

export interface EventRegistrationDto {
  id: string;
  userId: string;
  status: RsvpStatus;
  createdAt: string;
  userEmail: string | null;
  userFullName: string | null;
}

export async function fetchEvents(): Promise<{ upcoming: EventDto[]; past: EventDto[] }> {
  return request<{ upcoming: EventDto[]; past: EventDto[] }>("/events");
}

export async function fetchEvent(id: string): Promise<EventDto> {
  const data = await request<{ event: EventDto }>(`/events/${id}`);
  return data.event;
}

export async function rsvpEvent(id: string): Promise<void> {
  await request<{ ok: true }>(`/events/${id}/rsvp`, { method: "POST", body: JSON.stringify({}) });
}

export async function cancelEventRsvp(id: string): Promise<void> {
  await request<{ ok: true }>(`/events/${id}/rsvp`, { method: "DELETE" });
}

export async function fetchAdminEvents(): Promise<AdminEventDto[]> {
  const data = await request<{ events: AdminEventDto[] }>("/admin/events");
  return data.events;
}

export async function createEvent(input: EventInputDto): Promise<AdminEventDto> {
  const data = await request<{ event: AdminEventDto }>("/admin/events", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return data.event;
}

export async function updateEvent(
  id: string,
  patch: Partial<EventInputDto>,
): Promise<AdminEventDto> {
  const data = await request<{ event: AdminEventDto }>(`/admin/events/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  return data.event;
}

export async function deleteEvent(id: string): Promise<void> {
  await request<{ event: AdminEventDto }>(`/admin/events/${id}`, { method: "DELETE" });
}

export async function fetchEventRegistrations(id: string): Promise<EventRegistrationDto[]> {
  const data = await request<{ registrations: EventRegistrationDto[] }>(
    `/admin/events/${id}/registrations`,
  );
  return data.registrations;
}

/* --------------------------------------------------------------- support */

export type TicketStatus = "OPEN" | "PENDING" | "RESOLVED" | "CLOSED";
export type TicketPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

export interface SupportTicketDto {
  id: string;
  userId: string;
  subject: string;
  category: string;
  priority: TicketPriority;
  status: TicketStatus;
  lastMessageAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface SupportMessageDto {
  id: string;
  ticketId: string;
  authorId: string | null;
  authorRole: "MEMBER" | "STAFF";
  body: string;
  createdAt: string;
}

export interface SupportThreadDto {
  ticket: SupportTicketDto;
  messages: SupportMessageDto[];
}

export interface AdminTicketDto extends SupportTicketDto {
  userEmail: string | null;
  userFullName: string | null;
}

export async function fetchMyTickets(): Promise<SupportTicketDto[]> {
  const data = await request<{ tickets: SupportTicketDto[] }>("/support");
  return data.tickets;
}

export async function createTicket(input: {
  subject: string;
  category?: string;
  priority?: TicketPriority;
  message: string;
}): Promise<SupportTicketDto> {
  const data = await request<{ ticket: SupportTicketDto }>("/support", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return data.ticket;
}

export async function fetchMyTicket(id: string): Promise<SupportThreadDto> {
  return request<SupportThreadDto>(`/support/${id}`);
}

export async function replyToTicket(id: string, body: string): Promise<SupportThreadDto> {
  return request<SupportThreadDto>(`/support/${id}/messages`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

export async function fetchAdminTickets(status?: TicketStatus): Promise<AdminTicketDto[]> {
  const qs = status ? `?status=${status}` : "";
  const data = await request<{ tickets: AdminTicketDto[] }>(`/admin/support${qs}`);
  return data.tickets;
}

export async function fetchAdminTicket(id: string): Promise<SupportThreadDto> {
  return request<SupportThreadDto>(`/admin/support/${id}`);
}

export async function replyToTicketAsStaff(id: string, body: string): Promise<SupportThreadDto> {
  return request<SupportThreadDto>(`/admin/support/${id}/messages`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

export async function setTicketStatus(id: string, status: TicketStatus): Promise<SupportTicketDto> {
  const data = await request<{ ticket: SupportTicketDto }>(`/admin/support/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
  return data.ticket;
}
