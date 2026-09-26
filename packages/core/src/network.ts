export type NetworkName = 'mainnet' | 'chipnet' | 'testnet4';

export interface NetworkInfo {
  name: NetworkName;
  label: string;
  /** CashAddress prefix. */
  prefix: 'bitcoincash' | 'bchtest';
  /** Default Fulcrum (Electrum Cash) servers, the first one is used unless overridden. */
  servers: string[];
  /** Block explorer transaction URL prefix. */
  explorerTx: string;
  /** Block explorer address URL prefix. */
  explorerAddress: string;
  /** Where to get coins for this network. */
  faucet?: string;
  isTestnet: boolean;
}

export const NETWORKS: Record<NetworkName, NetworkInfo> = {
  mainnet: {
    name: 'mainnet',
    label: 'Mainnet',
    prefix: 'bitcoincash',
    servers: ['bch.imaginary.cash', 'electrum.imaginary.cash', 'bch.loping.net'],
    explorerTx: 'https://blockchair.com/bitcoin-cash/transaction/',
    explorerAddress: 'https://blockchair.com/bitcoin-cash/address/',
    isTestnet: false,
  },
  chipnet: {
    name: 'chipnet',
    label: 'Chipnet',
    prefix: 'bchtest',
    servers: ['chipnet.bch.ninja', 'chipnet.imaginary.cash'],
    explorerTx: 'https://chipnet.chaingraph.cash/tx/',
    explorerAddress: 'https://chipnet.chaingraph.cash/address/',
    faucet: 'https://tbch.googol.cash/',
    isTestnet: true,
  },
  testnet4: {
    name: 'testnet4',
    label: 'Testnet4',
    prefix: 'bchtest',
    servers: ['testnet4.imaginary.cash'],
    explorerTx: 'https://tbch4.loping.net/tx/',
    explorerAddress: 'https://tbch4.loping.net/address/',
    faucet: 'https://tbch.googol.cash/',
    isTestnet: true,
  },
};

export const NETWORK_NAMES = Object.keys(NETWORKS) as NetworkName[];

export const isNetworkName = (value: unknown): value is NetworkName =>
  typeof value === 'string' && value in NETWORKS;
