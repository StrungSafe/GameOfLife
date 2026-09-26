import { useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_PARAMS,
  MIN_DEPLOY_FUNDING,
  NETWORKS,
  createDeployerKey,
  deployGame,
  deployerAddress,
  deployerKeyFromWif,
  type Deployment,
  type Connection,
} from '@gol/core';
import { AddressCard, Icon, Modal } from './ui';
import { formatSats, friendlyErrorText } from '../lib/format';

const keyStorage = (network: string) => `gol.deployer.${network}`;

/**
 * Deploy a new game without a wallet: a throwaway key is created in this browser, the user funds
 * it from any wallet (QR code), and every coin it receives is handed to the new game contract.
 */
export function DeployDialog({ connection, onDeployed, onClose }: {
  connection: Connection;
  onDeployed: (deployment: Deployment, txid: string) => void;
  onClose: () => void;
}) {
  const { network, provider } = connection;
  const info = NETWORKS[network];
  const key = useMemo(() => {
    try {
      const saved = localStorage.getItem(keyStorage(network));
      if (saved) return deployerKeyFromWif(saved);
    } catch {
      // Fall through and create a new key.
    }
    const created = createDeployerKey(network);
    try { localStorage.setItem(keyStorage(network), created.wif); } catch { /* not persisted */ }
    return created;
  }, [network]);
  const address = deployerAddress(key, network);

  const [balance, setBalance] = useState<bigint | null>(null);
  const [status, setStatus] = useState<'waiting' | 'deploying' | 'error'>('waiting');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const utxos = await provider.getUtxos(address);
        if (!cancelled) setBalance(utxos.filter((utxo) => !utxo.token).reduce((sum, utxo) => sum + utxo.satoshis, 0n));
      } catch (e) {
        if (!cancelled) setError(friendlyErrorText(e));
      }
    };
    void check();
    const timer = setInterval(check, 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [provider, address]);

  const deploy = async () => {
    setStatus('deploying');
    setError('');
    try {
      const result = await deployGame({ provider, network, key, params: DEFAULT_PARAMS });
      try { localStorage.removeItem(keyStorage(network)); } catch { /* ignore */ }
      onDeployed(result.deployment, result.txid);
    } catch (e) {
      setStatus('error');
      setError(friendlyErrorText(e));
    }
  };

  const funded = balance !== null && balance > 0n;

  return (
    <Modal title={`Deploy a game on ${info.label}`} onClose={onClose} wide icon={<Icon name="rocket" className="size-7 text-bubble" />}>
      <div className="space-y-5">
        <ol className="space-y-2 text-sm">
          <li><b>1.</b> Send BCH to the address below from any wallet (at least {formatSats(MIN_DEPLOY_FUNDING)} recommended).</li>
          <li><b>2.</b> Press deploy. A {DEFAULT_PARAMS.width} x {DEFAULT_PARAMS.height} Game of Life contract is created and <b>all the coins become its fuel</b>.</li>
          <li><b>3.</b> Share the game! Anyone can play, no wallet needed.</li>
        </ol>
        <AddressCard
          primary
          label="Deployer address"
          address={address}
          description="A throwaway key kept in this browser only until the game is deployed."
          qrSize={190}
        />
        {info.faucet && (
          <a className="btn-sun btn-sm" href={info.faucet} target="_blank" rel="noreferrer">
            <Icon name="external" className="size-4" /> Get free {info.label} coins
          </a>
        )}
        <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-ink/5 p-3 dark:bg-white/5">
          {!funded ? (
            <>
              <div className="size-5 animate-spin rounded-full border-4 border-sky border-t-transparent" />
              <span className="text-sm">Waiting for coins… {balance === null ? '' : '(nothing yet)'}</span>
            </>
          ) : (
            <>
              <Icon name="check" className="size-6 text-mint" />
              <span className="text-sm">Received <b>{formatSats(balance!)}</b></span>
              {balance! < MIN_DEPLOY_FUNDING && <span className="text-xs opacity-70">(a little low - it will only cover a few moves)</span>}
            </>
          )}
        </div>
        {error && <p className="rounded-2xl bg-bubble/15 p-3 text-sm">{error}</p>}
        {network === 'mainnet' && <p className="text-sm text-bubble">This deploys on mainnet with real BCH.</p>}
        <button type="button" className="btn-primary w-full text-lg" disabled={!funded || status === 'deploying'} onClick={deploy}>
          <Icon name="rocket" /> {status === 'deploying' ? 'Deploying…' : 'Deploy the game'}
        </button>
      </div>
    </Modal>
  );
}
