/**
 * Candlestick chart backdrop.
 *
 * A deterministic, full-bleed SVG of bullish (gold) and bearish (blue) candles
 * with a vertical fade mask, rendered as a fixed background layer. Values come
 * from a seeded LCG so the markup is stable across server and client renders
 * (no hydration mismatch) — no `Math.random()` at render time.
 */
const W = 1440;
const H = 720;
const COUNT = 30;

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

type Candle = { o: number; c: number; h: number; l: number };

function buildCandles(): Candle[] {
  const rnd = seeded(0x5eed);
  const out: Candle[] = [];
  let price = 40;
  for (let i = 0; i < COUNT; i++) {
    const open = price;
    const move = (rnd() - 0.44) * 12 + 0.7; // slight upward drift
    const close = Math.min(90, Math.max(12, open + move));
    const high = Math.min(98, Math.max(open, close) + rnd() * 7);
    const low = Math.max(2, Math.min(open, close) - rnd() * 7);
    out.push({ o: open, c: close, h: high, l: low });
    price = close;
  }
  return out;
}

const CANDLES = buildCandles();

export function CandleBackground({ className = "" }: { className?: string }) {
  const gap = W / COUNT;
  const bodyW = gap * 0.5;
  const y = (p: number) => (1 - p / 100) * H;

  return (
    <div className={`pointer-events-none fixed inset-0 overflow-hidden ${className}`} aria-hidden="true">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid slice"
        className="h-full w-full opacity-[0.18]"
      >
        <defs>
          <linearGradient id="candle-fade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fff" stopOpacity="0" />
            <stop offset="18%" stopColor="#fff" stopOpacity="1" />
            <stop offset="78%" stopColor="#fff" stopOpacity="1" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <mask id="candle-mask">
            <rect width={W} height={H} fill="url(#candle-fade)" />
          </mask>
        </defs>

        <g mask="url(#candle-mask)">
          {/* faint price grid */}
          {[0.2, 0.4, 0.6, 0.8].map((f) => (
            <line
              key={f}
              x1={0}
              y1={H * f}
              x2={W}
              y2={H * f}
              stroke="#5ea0ff"
              strokeOpacity={0.06}
              strokeWidth={1}
            />
          ))}

          {CANDLES.map((c, i) => {
            const up = c.c >= c.o;
            const x = i * gap + (gap - bodyW) / 2;
            const top = y(Math.max(c.o, c.c));
            const bottom = y(Math.min(c.o, c.c));
            const color = up ? "#e8b84b" : "#3a5a86";
            const mid = x + bodyW / 2;
            return (
              <g key={i} stroke={color} fill={color}>
                <line x1={mid} y1={y(c.h)} x2={mid} y2={y(c.l)} strokeWidth={2} />
                <rect x={x} y={top} width={bodyW} height={Math.max(2, bottom - top)} rx={2} />
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
