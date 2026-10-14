import { LegalDoc, LegalList } from "@/components/legal-doc";

export const metadata = {
  title: "Risk disclosure — Aglotrends",
};

const sections = [
  {
    heading: "What Aglotrends is — and is not",
    body: [
      "Aglotrends is a software, signal, and education platform. It is not a broker, not a bank, not an investment fund, and not a financial adviser. Your trading capital stays in your own personal brokerage account at all times — Aglotrends never holds, pools, or takes custody of it. Nothing on this platform is investment advice, and nothing here is an offer to buy or sell any financial instrument.",
    ],
  },
  {
    heading: "Trading and copy trading can lose money",
    body: [
      "Trading foreign exchange, contracts for difference, crypto-assets, and other leveraged products carries a high level of risk and may not be suitable for everyone. Leverage magnifies both gains and losses: you can lose some or all of the capital you commit, and you can lose money faster than in unleveraged markets. Only commit funds you can afford to place at risk.",
      <LegalList
        key="risks"
        items={[
          "Copy trading mirrors someone else's decisions. Their strategy, risk appetite, and timing are theirs — your account inherits their drawdowns as well as their wins.",
          "Slippage, requotes, widened spreads, and execution delays mean your fills will differ from the trader you follow, especially in fast markets.",
          "A followed trader can change strategy, increase risk, pause, or disappear. Past performance — theirs or anyone's — is not indicative of future results.",
          "Disconnects happen: platform outages, broker downtime, or internet failure can leave positions unmanaged. Maintain your own stop-loss and risk controls at your broker.",
        ]}
      />,
    ],
  },
  {
    heading: "Signals are ideas, not instructions",
    body: [
      "Trade ideas published on Aglotrends are educational content expressing a view at a point in time. They are not recommendations to trade, and acting on them is your decision alone. Verify every idea against your own analysis and risk limits before committing capital.",
    ],
  },
  {
    heading: "Crypto payments carry their own risk",
    body: [
      <LegalList
        key="crypto"
        items={[
          "Membership fees and deposits are settled in USDT on the TRC20 network through our payment provider. Blockchain transfers are irreversible — sending funds to the wrong address, or on the wrong network, loses them permanently.",
          "Network congestion can delay confirmations. Your account activates when the network confirms payment, which may take longer than the checkout suggests.",
          "USDT's peg, the TRC20 network, and our payment provider are third parties outside our control. Their failure, suspension, or policy change can delay or prevent settlement.",
        ]}
      />,
    ],
  },
  {
    heading: "Referral and rank income is not guaranteed",
    body: [
      "Bonuses, generation overrides, rank rewards, and leadership incentives depend on real activity: paid memberships, funded participation, and published qualification criteria. No rank, reward, or income level is promised or implied. Most members earn modest amounts or nothing at all. Any figures shown as examples are illustrations of the arithmetic, not predictions of what you will earn.",
    ],
  },
  {
    heading: "Fees are non-refundable once settled",
    body: [
      "The one-time registration charge ($20.00 into the compensation plan plus the $5.00 platform transaction fee) is non-refundable once the payment is confirmed and your account is activated, because activation immediately consumes platform resources: matrix placement, pool accruals, and bonus distribution. Pending, unconfirmed payments can be abandoned before confirmation at no cost.",
    ],
  },
  {
    heading: "Regulatory availability",
    body: [
      "Leveraged trading, copy trading, and crypto-asset payments are restricted or prohibited in some jurisdictions. It is your responsibility to confirm that using Aglotrends, your broker, and USDT payments is lawful where you live. We may restrict or close accounts where local law requires it.",
    ],
  },
  {
    heading: "Read the Terms too",
    body: [
      "This disclosure is a summary of the principal risks, not an exhaustive list. It forms part of the Terms of Service: by using Aglotrends you confirm you have read, understood, and accepted both documents, and that you participate voluntarily and at your own risk.",
    ],
  },
];

export default function RiskDisclosurePage() {
  return (
    <LegalDoc
      title="Risk disclosure"
      updated="October 14, 2026"
      intro="Please read this carefully before you register, fund a broker account, follow a trader, or invite anyone. If you do not understand or accept these risks, do not use the platform."
      sections={sections}
    />
  );
}
