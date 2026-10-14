import { LegalDoc, LegalList } from "@/components/legal-doc";

export const metadata = {
  title: "Terms of Service — Aglotrends",
};

const sections = [
  {
    heading: "The agreement",
    body: [
      "These Terms of Service ('Terms') are a binding agreement between you and Aglotrends for your use of the website, the member portal, the admin console, and every service, signal, and program on them (together, the 'Platform'). By registering an account, you confirm you have read the Risk Disclosure and these Terms and accept both. If you do not accept them, do not register.",
    ],
  },
  {
    heading: "What the Platform provides",
    body: [
      "Aglotrends provides (a) copy-trading connectivity and published trade signals for your own broker account, (b) a referral and rewards program that pays bonuses from registration fees and trading performance according to the published compensation arithmetic, (c) education, events, and community features, and (d) wallet, ledger, and payout tooling. Aglotrends is not a broker and never holds your trading capital: funds you trade with remain in your personal brokerage account under your control.",
    ],
  },
  {
    heading: "Eligibility and your account",
    body: [
      <LegalList
        key="elig"
        items={[
          "You must be at least 18 years old (or the age of majority where you live) and legally able to use trading, referral, and crypto-payment services in your jurisdiction.",
          "Registration requires a valid referrer: every account joins under an existing member. Accounts created without a referrer are not permitted.",
          "You must provide accurate registration information and keep it current. One natural person, one member account — duplicate or nominee accounts may be suspended.",
          "You are responsible for your password and for any second factor you enrol. Enable two-factor authentication and never share credentials. Tell us at once via the Support center if you suspect compromise.",
        ]}
      />,
    ],
  },
  {
    heading: "Membership, fees, and activation",
    body: [
      "Creating an account is free, but membership activates only when the one-time registration charge settles: $20.00 into the compensation plan plus a $5.00 platform transaction fee ($25.00 total), payable in USDT (TRC20) through our payment provider. Until activation, the member area is limited to the wallet (to settle the fee), support, settings, and notifications; signals, copy-trading tools, network, community, education, events, and withdrawals unlock on activation. Settled fees are non-refundable (see Risk Disclosure §6). A separate transaction fee applies to each subsequent gateway payment at the rate published in the wallet at checkout.",
    ],
  },
  {
    heading: "Referral program and rewards",
    body: [
      <LegalList
        key="ref"
        items={[
          "Bonuses (direct referral, generation overrides), rank rewards, and leadership incentives are paid strictly according to the published compensation arithmetic on settled fees and realized performance — currently a 45% operating reserve and 55% community pool on the $20 base (30% direct, 10% generation across levels 2–6, 8% rank pool, 7% leadership pool), plus the published share of realized copy-trading performance.",
          "No rank, reward, or income is guaranteed. Qualification criteria, rates, and reward catalogues may change with notice; changes apply prospectively and never rewrite settled history.",
          "Upline placement follows the forced matrix with spillover. At a member's request, administration may move an account under a new sponsor; past payouts stand, future attribution follows the new sponsor, and the matrix seat does not move.",
          "Self-referral schemes, fabricated volume, bonus farming, and any manipulation of the program will void the rewards involved and may lead to suspension.",
        ]}
      />,
    ],
  },
  {
    heading: "Payouts and withdrawals",
    body: [
      "Withdrawals require a verified identity (KYC) and are reviewed by an administrator before release; requested funds are held until a decision is made. Minimum amounts, processing times, and destination requirements are published in the wallet and may change with notice. We may delay, split, or refuse a payout where fraud, money-laundering, sanctions, or legal risk is suspected, and we report where the law requires it.",
    ],
  },
  {
    heading: "Your conduct",
    body: [
      <LegalList
        key="conduct"
        items={[
          "Use the Platform lawfully and only for its intended purposes. Do not scrape, reverse-engineer, probe, overload, or interfere with it; do not misrepresent Aglotrends, its traders, or your results when inviting others.",
          "Do not upload unlawful, infringing, or abusive content, and do not use community, events, or messaging to spam, harass, or run unrelated schemes.",
          "You are solely responsible for activity under your account, including tax obligations on bonuses, rewards, and trading gains in your jurisdiction.",
        ]}
      />,
    ],
  },
  {
    heading: "Intellectual property",
    body: [
      "The Platform, its software, signals content, education materials, branding, and layout are owned by Aglotrends or its licensors. You receive a personal, non-transferable right to use them through the interface — nothing more. Member-submitted content you post (community, support) remains yours, but you grant us a worldwide licence to host and display it for operating the Platform.",
    ],
  },
  {
    heading: "Suspension and termination",
    body: [
      "We may suspend or close accounts — with or without notice where risk requires it — for fraud, abuse, bonus manipulation, unpaid or reversed payments, legal or sanctions exposure, prolonged inactivity, or breach of these Terms. On termination you lose access to gated areas; settled rewards already credited remain subject to the payout rules, while unvested or fraudulent rewards are forfeited. You may close your account at any time via the Support center after withdrawing any eligible balance.",
    ],
  },
  {
    heading: "No warranties; limit of liability",
    body: [
      "The Platform is provided 'as is' without warranties of any kind: availability, accuracy of signals, uninterrupted operation, and fitness for any purpose are not promised. To the maximum extent permitted by law, Aglotrends and its operators are not liable for trading losses, lost profits or rewards, or any indirect or consequential loss arising from your use of (or inability to use) the Platform — including actions of brokers, payment providers, and networks beyond our control. Nothing here limits liability that cannot legally be limited.",
    ],
  },
  {
    heading: "Indemnity",
    body: [
      "You agree to indemnify and hold Aglotrends harmless against claims, losses, and costs arising from your breach of these Terms, your misuse of the Platform, or your violation of any law — including claims by people you invited.",
    ],
  },
  {
    heading: "Changes and contact",
    body: [
      "We may update these Terms as the Platform evolves; material changes are announced in the portal and take effect on publication, and continued use means acceptance. Questions about these Terms go through the in-app Support center, which is the official channel for legal and account notices in both directions.",
    ],
  },
];

export default function TermsPage() {
  return (
    <LegalDoc
      title="Terms of Service"
      updated="October 14, 2026"
      intro="The rules of the road: what you get, what you owe, and how the program works. Short version — trade responsibly, invite honestly, and remember nothing here is guaranteed."
      sections={sections}
    />
  );
}
