import { useState } from 'react';
import { NETWORKS, type GameClient, type Snapshot } from '@gol/core';
import { AddressCard, Icon, Modal, Stat } from './ui';
import { formatSats } from '../lib/format';

export function FundDialog({ client, snapshot, onClose, onRefresh, onSimulateDonation }: {
  client: GameClient;
  snapshot: Snapshot | null;
  onClose: () => void;
  onRefresh: () => void;
  /** Sandbox only: pretend someone sent coins. */
  onSimulateDonation?: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const network = NETWORKS[client.deployment.network];
  const funding = snapshot?.funding;
  const [funding0, ...others] = client.addresses();

  return (
    <Modal title="Fund the game" onClose={onClose} wide icon={<Icon name="coin" className="size-7 text-sun" />}>
      <div className="space-y-5">
        <p>
          The contracts pay for every move themselves - nobody needs a wallet to play. Keep the game alive by
          sending <b>any amount of BCH</b> from any wallet to the funding address. Each move costs about{' '}
          <b>{funding ? formatSats(funding.moveFee) : '2,100 sats'}</b>.
        </p>

        {funding && (
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Balance" value={formatSats(funding.balance, true)} />
            <Stat label="Per move" value={formatSats(funding.moveFee, true)} />
            <Stat label="Moves left" value={`~${funding.movesLeft}`} accent={funding.movesLeft < 10 ? 'text-bubble' : 'text-mint'} />
          </div>
        )}
        {funding && !funding.canMove && (
          <div className="flex items-start gap-3 rounded-2xl border-2 border-bubble bg-bubble/10 p-3">
            <Icon name="warning" className="mt-0.5 size-5 shrink-0 text-bubble" />
            <p className="text-sm">
              <b>The game is out of fuel.</b> At least <b>{formatSats(funding.shortfall)}</b> more is needed for the next
              move. Scan the QR code below with your BCH wallet to top it up.
            </p>
          </div>
        )}

        <AddressCard primary label={funding0.label} address={funding0.address} description={funding0.description} qrSize={200} />

        {network.faucet && (
          <a className="btn-sun btn-sm" href={network.faucet} target="_blank" rel="noreferrer">
            <Icon name="external" className="size-4" /> Get free {network.label} coins
          </a>
        )}

        <div className="flex flex-wrap gap-2">
          {onSimulateDonation && (
            <button type="button" className="btn-primary btn-sm" onClick={onSimulateDonation}>
              <Icon name="sparkle" className="size-4" /> Simulate a 25k sat donation
            </button>
          )}
          <button type="button" className="btn-ghost btn-sm" onClick={onRefresh}>
            <Icon name="refresh" className="size-4" /> I sent it - check again
          </button>
          <button type="button" className="btn-ghost btn-sm" onClick={() => setShowAll((value) => !value)}>
            {showAll ? 'Hide' : 'Show'} all contract addresses
          </button>
        </div>

        {showAll && (
          <div className="space-y-3">
            {others.map((entry) => (
              <AddressCard key={entry.address} label={entry.label} address={entry.address} description={entry.description} qrSize={150} />
            ))}
            <div className="rounded-2xl bg-ink/5 p-3 text-xs dark:bg-white/5">
              <div className="label">Game token category</div>
              <code className="break-all">{client.deployment.category}</code>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
