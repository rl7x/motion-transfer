import { linkHref } from '../links';
import { PixelSprite } from './pixel-sprite';
import type { SpriteName } from './pixel-sprite';

export interface Destination {
  id: string;
  name: string;
  genre: string;
  status: 'live' | 'saved' | 'historical';
  sprite: SpriteName;
  href: string | null;
  note: string;
}

const STATUS_LABEL: Record<Destination['status'], string> = {
  live: 'LIVE REMIX',
  saved: 'SAVED TRANSFER',
  historical: 'HISTORICAL',
};

/** Cartridges for every game the recovered dash has been carried into. */
export function DestinationPicker({
  destinations,
  onPlayLive,
}: {
  destinations: Destination[];
  onPlayLive(): void;
}) {
  return (
    <aside className="dest-picker" aria-labelledby="destinations-title">
      <p className="eyebrow">STEP 2 · DESTINATION</p>
      <h2 id="destinations-title">Choose a game</h2>
      <ul className="dest-picker__list">
        {destinations.map((destination) => {
          const body = (
            <>
              <span className={'cartridge__art cartridge__art--' + destination.id}>
                <PixelSprite name={destination.sprite} size={44} still />
              </span>
              <span className="cartridge__text">
                <span className="cartridge__name">{destination.name}</span>
                <span className="cartridge__genre">{destination.genre}</span>
                <span className={'cartridge__status cartridge__status--' + destination.status}>
                  {STATUS_LABEL[destination.status]}
                </span>
              </span>
            </>
          );
          return (
            <li key={destination.id}>
              {destination.status === 'live' ? (
                <button
                  type="button"
                  className="cartridge cartridge--live is-selected"
                  aria-describedby={`destination-${destination.id}-note`}
                  onClick={onPlayLive}
                >
                  {body}
                </button>
              ) : destination.href ? (
                <a
                  className="cartridge"
                  href={linkHref(destination.href)}
                  target="_blank"
                  rel="noreferrer"
                  aria-describedby={`destination-${destination.id}-note`}
                >
                  {body}
                  <span className="cartridge__open" aria-hidden="true">
                    ↗
                  </span>
                </a>
              ) : null}
              <p className="cartridge__note" id={`destination-${destination.id}-note`}>
                {destination.note}
              </p>
            </li>
          );
        })}
      </ul>
      <p className="dest-picker__foot">
        Live Meta remixes run on PARALLAXIA. The other cartridges open saved, verified transfers of
        the same recovered component.
      </p>
    </aside>
  );
}
