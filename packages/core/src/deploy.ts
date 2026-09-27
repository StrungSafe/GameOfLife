import { SignatureTemplate, TransactionBuilder, type NetworkProvider, type Utxo } from 'cashscript';
import {
  binToHex,
  decodePrivateKeyWif,
  encodePrivateKeyWif,
  generatePrivateKey,
  privateKeyToP2pkhCashAddress,
} from '@bitauth/libauth';
import { createContracts, DEFAULT_PARAMS, validateParams, type Deployment, type GameParams } from './deployment.js';
import { NETWORKS, type NetworkName } from './network.js';
import { encodeState, genesisState } from './state.js';
import { paramsOpReturnChunks, REGISTRY_LOCKING_BYTECODE, REGISTRY_MARKER_VALUE } from './registry.js';

/**
 * Deploying a game needs one funded coin to create the state token from. Instead of a wallet the
 * interfaces use a throwaway "deployer" key: fund its address with any wallet, then `deployGame`
 * mints the state NFT into the game contract, announces it in the on-chain registry and hands
 * all the coins to the contract.
 */
export interface DeployerKey {
  privateKey: Uint8Array;
  wif: string;
}

/** Recommended minimum to fund the deployer with (covers deployment plus a few dozen moves). */
export const MIN_DEPLOY_FUNDING = 50_000n;

export const createDeployerKey = (network: NetworkName): DeployerKey => {
  const privateKey = generatePrivateKey();
  return { privateKey, wif: encodePrivateKeyWif(privateKey, NETWORKS[network].isTestnet ? 'testnet' : 'mainnet') };
};

export const deployerKeyFromWif = (wif: string): DeployerKey => {
  const decoded = decodePrivateKeyWif(wif);
  if (typeof decoded === 'string') throw new Error(decoded);
  return { privateKey: decoded.privateKey, wif };
};

export const deployerAddress = (key: DeployerKey, network: NetworkName): string => {
  const result = privateKeyToP2pkhCashAddress({ privateKey: key.privateKey, prefix: NETWORKS[network].prefix });
  return result.address;
};

const sum = (utxos: Utxo[]): bigint => utxos.reduce((total, utxo) => total + utxo.satoshis, 0n);

/**
 * Deploy a new game: mint the state NFT (in its "no game yet" state) to the game contract,
 * together with every coin of the deployer key. Returns the new deployment.
 */
export const deployGame = async (options: {
  provider: NetworkProvider;
  network: NetworkName;
  key: DeployerKey;
  params?: GameParams;
}): Promise<{ deployment: Deployment; txid: string }> => {
  const { provider, network, key } = options;
  const params = options.params ?? DEFAULT_PARAMS;
  validateParams(params);
  const address = deployerAddress(key, network);
  const signer = new SignatureTemplate(key.privateKey);

  let utxos = (await provider.getUtxos(address)).filter((utxo) => !utxo.token);
  if (utxos.length === 0) throw new Error(`The deployer address ${address} has no coins yet.`);

  // A token category is created by spending an output with index 0 as the first input.
  if (!utxos.some((utxo) => utxo.vout === 0)) {
    const prep = () => new TransactionBuilder({ provider }).addInputs(utxos, signer.unlockP2PKH());
    const size = prep().addOutput({ to: address, amount: sum(utxos) - 1000n }).getTransactionSize();
    const amount = sum(utxos) - size - 2n;
    const details = await prep().addOutput({ to: address, amount }).send();
    utxos = [{ txid: details.txid, vout: 0, satoshis: amount }];
  }
  const genesisUtxo = utxos.find((utxo) => utxo.vout === 0)!;
  const ordered = [genesisUtxo, ...utxos.filter((utxo) => utxo !== genesisUtxo)];

  const deployment: Deployment = { network, category: genesisUtxo.txid, ...params };
  const { game } = createContracts(deployment, provider);
  const build = (amount: bigint) => new TransactionBuilder({ provider })
    .addInputs(ordered, signer.unlockP2PKH())
    .addOutput({
      to: game.tokenAddress,
      amount,
      token: {
        category: deployment.category,
        amount: 0n,
        nft: { capability: 'mutable', commitment: binToHex(encodeState(genesisState())) },
      },
    })
    // Announce the game in the on-chain registry so clients can discover it.
    .addOutput({ to: REGISTRY_LOCKING_BYTECODE, amount: REGISTRY_MARKER_VALUE })
    .addOpReturnOutput(paramsOpReturnChunks(params));
  const total = sum(ordered) - REGISTRY_MARKER_VALUE;
  const fee = build(total - 1000n).getTransactionSize() + 2n;
  if (total - fee < 2000n) throw new Error(`Not enough coins to deploy (have ${total} sats, need at least ${MIN_DEPLOY_FUNDING}).`);
  const details = await build(total - fee).send();
  return { deployment, txid: details.txid };
};
