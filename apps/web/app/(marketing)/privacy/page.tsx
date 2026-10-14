import { LegalDoc, LegalList } from "@/components/legal-doc";

export const metadata = {
  title: "Privacy Policy — Aglotrends",
};

const sections = [
  {
    heading: "Who we are and what this covers",
    body: [
      "Aglotrends ('we') operates the member portal, signals, referral program, and related services. This policy explains what personal data we collect, why, who sees it, how long we keep it, and the choices you have. It applies to the website, the portal, and the admin console. Questions go through the in-app Support center.",
    ],
  },
  {
    heading: "Data we collect",
    body: [
      <LegalList
        key="collect"
        items={[
          "Identity and contact: full name, email address, phone number, and country, as provided at registration and in settings.",
          "Credentials: your password (stored hashed, never in readable form) and, if you enrol it, your two-factor secret (stored encrypted) plus hashed recovery codes.",
          "Verification (KYC): identity documents and the details you submit, plus our review decisions — required before withdrawals.",
          "Money records: payment references, amounts, currencies, ledger entries, payout requests and destinations, and on-chain wallet addresses you provide. We never ask for your private keys or seed phrases — anyone who does is not us.",
          "Trading connectivity: broker identifiers and account references you link for copy trading. Your trading capital stays at your broker; we do not see or hold it.",
          "Support and community: tickets, messages, event registrations, and content you post.",
          "Technical: login history, device and session metadata, and audit entries created when staff act on accounts.",
        ]}
      />,
    ],
  },
  {
    heading: "Cookies",
    body: [
      "We use one strictly-necessary session cookie that keeps you signed in, plus the essential storage the app needs to function. We do not run advertising trackers or cross-site profiling cookies. Your browser controls apply to anything else.",
    ],
  },
  {
    heading: "Why we use your data",
    body: [
      <LegalList
        key="uses"
        items={[
          "Operating your account: registration, login, activation, matrix placement, and bonus computation.",
          "Money movement: processing payments and payouts, keeping the ledger, and settling the books.",
          "Compliance and safety: identity verification, fraud and abuse prevention, sanctions screening, audit trails, and enforcing the Terms.",
          "Support and communication: answering tickets, sending transactional mail (receipts, reset links, security notices), and publishing signals and education you asked for.",
        ]}
      />,
      "We process data because it is necessary to perform our contract with you (the Terms), to comply with legal obligations, and for our legitimate interests in running a secure, honest platform — balanced against your rights.",
    ],
  },
  {
    heading: "Who sees your data",
    body: [
      <LegalList
        key="share"
        items={[
          "Our payment provider, to settle USDT transfers; our mail relay, to deliver transactional email; infrastructure hosts that store the database. Each sees only what its job requires.",
          "Your upline and downline see referral-relationship facts the program needs (for example, that you joined under your sponsor and your activation state) — never your password, documents, or private contact details.",
          "Staff see account data only as their duties require, and every staff action on an account is audit-logged.",
          "Authorities, where disclosure is legally compelled (court order, sanctions, anti-money-laundering reporting).",
          "We do not sell personal data, and we do not share it for third-party marketing.",
        ]}
      />,
    ],
  },
  {
    heading: "How we protect it",
    body: [
      "Passwords are hashed; two-factor and gateway secrets are encrypted at rest; staff areas require enrolment in two-factor authentication; access follows least privilege with audit trails. No system is impregnable — protect your own credentials, enable two-factor authentication, and report suspected compromise immediately.",
    ],
  },
  {
    heading: "How long we keep it",
    body: [
      "Account and ledger data is kept while your account exists and as long afterwards as bookkeeping, tax, anti-fraud, and legal obligations require — money records generally outlive accounts. Support correspondence is kept for the life of the matter plus a reasonable archive period. You may ask for specifics about any category through the Support center.",
    ],
  },
  {
    heading: "Your rights",
    body: [
      "Depending on where you live, you may have the right to access, correct, export, restrict, or delete your personal data, and to object to certain uses. Send requests through the Support center; we answer within a reasonable time and verify identity before releasing anything. Deletion cannot erase records the law obliges us to keep (for example, settled financial and audit history), and closing your account does not retroactively void lawful past processing.",
    ],
  },
  {
    heading: "Children",
    body: [
      "The Platform is for adults (18+, per the Terms). We do not knowingly collect data from children; accounts found to belong to minors are closed and their data removed except where retention is legally required.",
    ],
  },
  {
    heading: "Changes to this policy",
    body: [
      "We update this policy as the Platform and the law evolve. Material changes are announced in the portal; continued use after publication means acceptance. The version date at the top always shows which edition governs.",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <LegalDoc
      title="Privacy Policy"
      updated="October 14, 2026"
      intro="Your data runs the program — bonuses can't compute without it — so here's exactly what we take, why, who sees it, and what you control."
      sections={sections}
    />
  );
}
