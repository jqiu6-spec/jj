import { AbsoluteFill, Img, Easing, Sequence, continueRender, delayRender, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
// Font files are bundled from npm, so rendering works offline.
import '@fontsource/noto-sans-jp/400.css';
import '@fontsource/noto-sans-jp/800.css';

export type ReelItem = { id: string; title: string; creator: string | null; date: string | null; image: string | null };
export type ReelData = { total: number; items: ReelItem[] };

// Same palette and type as the website (index.html).
const INK = '#222';
const MUTED = '#767676';
const PANEL = '#f2f2f2';
const FONT = '"Noto Sans JP", "Helvetica Neue", Arial, sans-serif';

// Hold the first frame until both weights are ready.
const fontHandle = delayRender('Loading Noto Sans JP');
Promise.all(['400', '800'].map((w) => document.fonts.load(`${w} 40px "Noto Sans JP"`)))
  .then(() => continueRender(fontHandle))
  .catch(() => continueRender(fontHandle));

const INTRO = 75;
const PER_WORK = 90;
const OUTRO = 75;
export const reelDuration = (n: number) => INTRO + n * PER_WORK + OUTRO;

const ease = Easing.bezier(0.22, 1, 0.36, 1);

const Wordmark: React.FC<{ sub: string }> = ({ sub }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const rise = spring({ frame, fps, config: { damping: 200 } });
  const line = interpolate(frame, [12, 40], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
  const subIn = interpolate(frame, [28, 46], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ background: '#fff', alignItems: 'center', justifyContent: 'center', fontFamily: FONT, color: INK }}>
      <div style={{ fontSize: 180, fontWeight: 800, letterSpacing: '-0.045em', opacity: rise, transform: `translateY(${(1 - rise) * 40}px)` }}>
        art inspo
      </div>
      <div style={{ width: 760, height: 2, background: INK, transform: `scaleX(${line})`, margin: '28px 0 26px' }} />
      <div style={{ fontSize: 30, letterSpacing: '0.14em', textTransform: 'uppercase', color: MUTED, opacity: subIn }}>{sub}</div>
    </AbsoluteFill>
  );
};

const Work: React.FC<{ item: ReelItem; index: number; count: number }> = ({ item, index, count }) => {
  const frame = useCurrentFrame();
  const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
  const panel = interpolate(frame, [0, 22], [100, 0], { ...clamp, easing: ease });
  const imgIn = interpolate(frame, [6, 30], [0, 1], { ...clamp, easing: ease });
  const textIn = (start: number) => interpolate(frame, [start, start + 18], [0, 1], { ...clamp, easing: ease });
  const out = interpolate(frame, [PER_WORK - 12, PER_WORK], [1, 0], clamp);
  const meta = [item.creator, item.date].filter(Boolean).join(' · ') || 'Artist unknown';
  const num = (n: number) => String(n).padStart(2, '0');

  return (
    <AbsoluteFill style={{ background: '#fff', fontFamily: FONT, color: INK, opacity: out, flexDirection: 'row' }}>
      <div style={{ width: '50%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 96 }}>
        {item.image ? (
          <Img
            src={staticFile(item.image)}
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', opacity: imgIn, transform: `scale(${1.06 - 0.06 * imgIn})` }}
          />
        ) : (
          <div style={{ width: 560, height: 700, background: PANEL, opacity: imgIn }} />
        )}
      </div>
      <div style={{ width: '50%', height: '100%', background: PANEL, transform: `translateX(${panel}%)`, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 120px' }}>
        <div style={{ fontSize: 24, letterSpacing: '0.14em', textTransform: 'uppercase', color: MUTED, opacity: textIn(16) }}>
          {num(index + 1)} / {num(count)}
        </div>
        <div style={{ overflow: 'hidden', marginTop: 28 }}>
          <div style={{ fontSize: 68, lineHeight: 1.12, letterSpacing: '-0.02em', transform: `translateY(${(1 - textIn(22)) * 100}%)` }}>
            {item.title}
          </div>
        </div>
        <div style={{ fontSize: 34, color: MUTED, marginTop: 22, opacity: textIn(32) }}>{meta}</div>
      </div>
    </AbsoluteFill>
  );
};

export const CollectionReel: React.FC<ReelData> = ({ total, items }) => (
  <AbsoluteFill style={{ background: '#fff' }}>
    <Sequence durationInFrames={INTRO}>
      <Wordmark sub="Latest additions" />
    </Sequence>
    {items.map((item, i) => (
      <Sequence key={item.id} from={INTRO + i * PER_WORK} durationInFrames={PER_WORK}>
        <Work item={item} index={i} count={items.length} />
      </Sequence>
    ))}
    <Sequence from={INTRO + items.length * PER_WORK} durationInFrames={OUTRO}>
      <Wordmark sub={`${total} works in the collection`} />
    </Sequence>
  </AbsoluteFill>
);
