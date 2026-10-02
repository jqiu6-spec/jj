import { Composition, staticFile } from 'remotion';
import { CollectionReel, reelDuration, type ReelData } from './CollectionReel';

export const Root: React.FC = () => (
  <Composition
    id="CollectionReel"
    component={CollectionReel}
    width={1920}
    height={1080}
    fps={30}
    durationInFrames={300}
    defaultProps={{ total: 0, items: [] } as ReelData}
    calculateMetadata={async () => {
      const data: ReelData = await fetch(staticFile('reel.json')).then((r) => r.json());
      return { props: data, durationInFrames: reelDuration(data.items.length) };
    }}
  />
);
