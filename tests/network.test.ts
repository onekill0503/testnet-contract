import { Contract, JWKInterface, PstState } from 'warp-contracts';

import { IOState } from '../src/types';
import { arweave, warp } from './setup.jest';
import {
  CONTRACT_SETTINGS,
  NETWORK_HIDDEN_STATUS,
  NETWORK_JOIN_STATUS,
  NETWORK_LEAVING_STATUS,
  WALLET_FUND_AMOUNT,
} from './utils/constants';
import {
  getCurrentBlock,
  getLocalArNSContractId,
  getLocalWallet,
  mineBlocks,
} from './utils/helper';

describe('Network', () => {
  let contract: Contract<PstState>;
  let owner: JWKInterface;
  let ownerAddress: string;
  let srcContractId: string;

  beforeAll(async () => {
    srcContractId = getLocalArNSContractId();
  });

  describe('valid gateway operator', () => {
    let newGatewayOperator: JWKInterface;
    let newGatewayOperatorAddress: string;

    beforeAll(async () => {
      owner = getLocalWallet(0);
      newGatewayOperator = getLocalWallet(5);
      newGatewayOperatorAddress = await arweave.wallets.getAddress(
        newGatewayOperator,
      );
      contract = warp.pst(srcContractId).connect(newGatewayOperator);
    });

    describe('join network', () => {
      it('should join the network with correct parameters', async () => {
        const { cachedValue: prevCachedValue } = await contract.readState();
        const prevState = prevCachedValue.state as IOState;
        const prevBalance =
          prevCachedValue.state.balances[newGatewayOperatorAddress];
        const qty = prevState.settings.registry.minNetworkJoinStakeAmount; // must meet the minimum
        const label = 'Test Gateway'; // friendly label
        const fqdn = 'jest.io';
        const port = 3000;
        const protocol = 'http';
        const openDelegation = true;
        const note =
          'Our gateway is the best test gateway. Contact bob@ar.io for more.';
        const joinGatewayPayload = {
          qty: CONTRACT_SETTINGS.minNetworkJoinStakeAmount, // must meet the minimum
          label: 'Test Gateway', // friendly label
          fqdn: 'jest.io',
          port: 3000,
          protocol: 'http',
          openDelegation: true,
          note: 'Our gateway is the best test gateway. Contact bob@ar.io for more.',
        };
        const writeInteraction = await contract.writeInteraction({
          function: 'joinNetwork',
          ...joinGatewayPayload,
        });
        expect(writeInteraction?.originalTxId).not.toBe(undefined);
        const { cachedValue: newCachedValue } = await contract.readState();
        const newState = newCachedValue.state as IOState;
        expect(Object.keys(newCachedValue.errorMessages)).not.toContain(
          writeInteraction!.originalTxId,
        );
        expect(newState.balances[newGatewayOperatorAddress]).toEqual(
          prevBalance - qty,
        );
        expect(newState.gateways[newGatewayOperatorAddress]).toEqual({
          operatorStake: qty,
          delegatedStake: 0,
          status: NETWORK_JOIN_STATUS,
          start: 2,
          end: 0,
          vaults: [
            {
              balance: qty, // Positive integer, the amount locked
              start: 2, // At what block the lock starts.
              end: 0, // At what block the lock ends.  0 means no end date.}]
            },
          ],
          delegates: {},
          settings: {
            label: label,
            fqdn: fqdn,
            port: port,
            protocol: protocol,
            openDelegation: openDelegation,
            delegateAllowList: [],
            note: note,
          },
        });
      });

      // TODO: add failed join network tests
    });

    describe('operator stake', () => {
      it('should increase operator stake with correct parameters', async () => {
        const { cachedValue: prevCachedValue } = await contract.readState();
        const prevState = prevCachedValue.state as IOState;
        const prevBalance = prevState.balances[newGatewayOperatorAddress];
        const prevGatewayOperatorBalance =
          prevState.gateways[newGatewayOperatorAddress].operatorStake;
        const qty = prevState.settings.registry.minDelegatedStakeAmount; // must meet the minimum
        const writeInteraction = await contract.writeInteraction({
          function: 'increaseOperatorStake',
          qty,
        });
        expect(writeInteraction?.originalTxId).not.toBe(undefined);
        const { cachedValue: newCachedValue } = await contract.readState();
        const newState = newCachedValue.state as IOState;
        expect(Object.keys(newCachedValue.errorMessages)).not.toContain(
          writeInteraction!.originalTxId,
        );
        expect(newState.balances[newGatewayOperatorAddress]).toEqual(
          prevBalance - qty,
        );
        expect(
          newState.gateways[newGatewayOperatorAddress].operatorStake,
        ).toEqual(prevGatewayOperatorBalance + qty);
        expect(newState.gateways[newGatewayOperatorAddress].vaults[1]).toEqual({
          balance: qty, // Positive integer, the amount locked
          start: 3, // At what block the lock starts.
          end: 0, // At what block the lock ends.  0 means no end date.}]
        });
      });

      it('should not initiate operator stake decrease if the vault has not been locked long enough', async () => {
        const { cachedValue: prevCachedValue } = await contract.readState();
        const prevState = prevCachedValue.state as IOState;
        const id = 1; // the vault that is being unlocked
        const writeInteraction = await contract.writeInteraction({
          function: 'initiateOperatorStakeDecrease',
          id,
        });
        expect(writeInteraction?.originalTxId).not.toBe(undefined);
        const { cachedValue: newCachedValue } = await contract.readState();
        const newState = newCachedValue.state as IOState;
        expect(Object.keys(newCachedValue.errorMessages)).toContain(
          writeInteraction!.originalTxId,
        );
        expect(newState.gateways[newGatewayOperatorAddress].vaults[id]).toEqual(
          prevState.gateways[newGatewayOperatorAddress].vaults[id],
        );
      });

      it('should initiate operator stake decrease when enough blocks have passed', async () => {
        // mine the appropriate number of blocks
        await mineBlocks(arweave, CONTRACT_SETTINGS.minLockLength);
        const id = 1; // the vault that is being unlocked
        const writeInteraction = await contract.writeInteraction({
          function: 'initiateOperatorStakeDecrease',
          id,
        });
        expect(writeInteraction?.originalTxId).not.toBe(undefined);
        const { cachedValue: newCachedValue } = await contract.readState();
        const newState = newCachedValue.state as IOState;
        expect(Object.keys(newCachedValue.errorMessages)).not.toContain(
          writeInteraction!.originalTxId,
        );
        expect(
          newState.gateways[newGatewayOperatorAddress].vaults[id].end,
        ).toEqual(
          (await getCurrentBlock(arweave)) +
            CONTRACT_SETTINGS.operatorStakeWithdrawLength,
        ); // TO DO, make this more dynamic.  Need to fetch current block height
      });

      it('should not initiate operator stake decrease if it brings the gateway below the minimum', async () => {
        const id = 0; // the vault that is being unlocked
        const writeInteraction = await contract.writeInteraction({
          function: 'initiateOperatorStakeDecrease',
          id,
        });
        expect(writeInteraction?.originalTxId).not.toBe(undefined);
        const { cachedValue: newCachedValue } = await contract.readState();
        const newState = newCachedValue.state as IOState;
        expect(Object.keys(newCachedValue.errorMessages)).toContain(
          writeInteraction!.originalTxId,
        );
        expect(
          newState.gateways[newGatewayOperatorAddress].vaults[0].end,
        ).toEqual(0);
      });

      it('should not finalize operator stake decrease if its end block height has not passed', async () => {
        const { cachedValue: prevCachedValue } = await contract.readState();
        const prevState = prevCachedValue.state as IOState;
        const writeInteraction = await contract.writeInteraction({
          function: 'finalizeOperatorStakeDecrease',
        });
        expect(writeInteraction?.originalTxId).not.toBe(undefined);
        const { cachedValue: newCachedValue } = await contract.readState();
        const newState = newCachedValue.state as IOState;
        // doesn't throw errors, just doesn't remove vaults not yet expired
        expect(Object.keys(newCachedValue.errorMessages)).not.toContain(
          writeInteraction!.originalTxId,
        );
        expect(newState.gateways[newGatewayOperatorAddress].vaults[1]).toEqual(
          prevState.gateways[newGatewayOperatorAddress].vaults[1],
        );
      });

      it('should finalize operator stake decrease if its end block height has passed', async () => {
        const { cachedValue: prevCachedValue } = await contract.readState();
        const prevState = prevCachedValue.state as IOState;
        const prevVault =
          prevState.gateways[newGatewayOperatorAddress].vaults[1];
        const prevBalance = prevState.balances[newGatewayOperatorAddress];
        // mine the remaining blocks
        await mineBlocks(
          arweave,
          prevVault.end - (await getCurrentBlock(arweave)),
        );
        const writeInteraction = await contract.writeInteraction({
          function: 'finalizeOperatorStakeDecrease',
        });
        expect(writeInteraction?.originalTxId).not.toBe(undefined);
        const { cachedValue: newCachedValue } = await contract.readState();
        const newState = newCachedValue.state as IOState;
        const newVault = newState.gateways[newGatewayOperatorAddress].vaults[1];
        const newBalance = newState.balances[newGatewayOperatorAddress];
        expect(Object.keys(newCachedValue.errorMessages)).not.toContain(
          writeInteraction!.originalTxId,
        );
        expect(newVault).toEqual(undefined);
        expect(newBalance).toEqual(prevBalance + prevVault.balance);
      });
    });

    describe('gateway settings', () => {
      it('should modify gateway settings with correct parameters', async () => {
        const { cachedValue: prevCachedValue } = await contract.readState();
        const prevState = prevCachedValue.state as IOState;
        const prevGatewaySettings =
          prevState.gateways[newGatewayOperatorAddress].settings;
        const delegateAllowList = [
          await arweave.wallets.getAddress(await getLocalWallet(6)),
          await arweave.wallets.getAddress(await getLocalWallet(7)),
        ];
        const writeInteraction = await contract.writeInteraction({
          function: 'updateGatewaySettings',
          delegateAllowList,
          status: NETWORK_HIDDEN_STATUS,
        });
        expect(writeInteraction?.originalTxId).not.toBe(undefined);
        const { cachedValue: newCachedValue } = await contract.readState();
        const newState = newCachedValue.state as IOState;
        const newGateway = newState.gateways[newGatewayOperatorAddress];
        expect(Object.keys(newCachedValue.errorMessages)).not.toContain(
          writeInteraction!.originalTxId,
        );
        expect(newGateway.settings).toEqual({
          ...prevGatewaySettings,
          delegateAllowList,
        });
        expect(newGateway.status).toEqual(NETWORK_HIDDEN_STATUS);
      });

      it('should not modify gateway settings with invalid parameters', async () => {
        const { cachedValue: prevCachedValue } = await contract.readState();
        const prevState = prevCachedValue.state as IOState;
        const label = 'SUUUUUUUUUUUUUUUUUUUUUUUUUUPER LONG LABEL!!!!!!!!!'; // friendly label
        const port = 'string';
        const protocol = 'ipfs';
        const fqdn = 'fake_url.com';
        const note = 12345;
        const status = 'leavingNetwork';
        const openDelegation = 'whatever';
        const delegateAllowList = ['this aint a wallet'];
        const writeInteraction = await contract.writeInteraction({
          function: 'updateGatewaySettings',
          label,
          port,
          protocol,
          fqdn,
          openDelegation,
          delegateAllowList,
          note,
          status,
        });
        expect(writeInteraction?.originalTxId).not.toBe(undefined);
        const { cachedValue: newCachedValue } = await contract.readState();
        const newState = newCachedValue.state as IOState;
        expect(Object.keys(newCachedValue.errorMessages)).toContain(
          writeInteraction!.originalTxId,
        );
        expect(newState.gateways[newGatewayOperatorAddress].settings).toEqual(
          prevState.gateways[newGatewayOperatorAddress].settings,
        );
        expect(newState.gateways[newGatewayOperatorAddress].status).toEqual(
          prevState.gateways[newGatewayOperatorAddress].status,
        );
      });
    });

    describe('initiate leave', () => {
      it('should initiate leaving the network when the target is a gateway in the network and has joined long enough', async () => {
        // mine the required number of blocks
        await mineBlocks(arweave, CONTRACT_SETTINGS.minGatewayJoinLength);
        const writeInteraction = await contract.writeInteraction({
          function: 'initiateLeave',
        });

        expect(writeInteraction?.originalTxId).not.toBe(undefined);
        const { cachedValue: newCachedValue } = await contract.readState();
        const newState = newCachedValue.state as IOState;
        const expectedEndBlock =
          (await getCurrentBlock(arweave)) +
          CONTRACT_SETTINGS.gatewayLeaveLength;
        expect(Object.keys(newCachedValue.errorMessages)).not.toContain(
          writeInteraction!.originalTxId,
        );
        expect(newState.gateways[newGatewayOperatorAddress].status).toEqual(
          NETWORK_LEAVING_STATUS,
        );
        expect(newState.gateways[newGatewayOperatorAddress].end).toEqual(
          expectedEndBlock,
        );
        // check vaults
        for (const vault of newState.gateways[newGatewayOperatorAddress]
          .vaults) {
          expect(vault.end).toEqual(expectedEndBlock);
        }
      });
    });

    describe('finalize leave', () => {
      it('should not finalize if the target is not a in the network', async () => {
        const { cachedValue: prevCachedValue } = await contract.readState();
        const prevState = prevCachedValue.state as IOState;
        const writeInteraction = await contract.writeInteraction({
          function: 'finalizeLeave',
          target: 'not-existent-gateway',
        });
        expect(writeInteraction?.originalTxId).not.toBe(undefined);
        const { cachedValue: newCachedValue } = await contract.readState();
        const newState = newCachedValue.state as IOState;
        expect(Object.keys(newCachedValue.errorMessages)).toContain(
          writeInteraction!.originalTxId,
        );
        expect(newState.gateways).toEqual(prevState.gateways);
      });

      it('should finalize when the caller is a gateway in the network and target is not provided', async () => {
        const { cachedValue: prevCachedValue } = await contract.readState();
        const prevState = prevCachedValue.state as IOState;
        const prevGateway = prevState.gateways[newGatewayOperatorAddress];
        const prevDelegates = prevGateway.delegates;
        const delegatedBalances: { [x: string]: number } = Object.keys(
          prevDelegates,
        ).reduce(
          (totalDelegations: any, d) => ({
            ...totalDelegations,
            [totalDelegations[d]]: Object.values(prevDelegates[d]).reduce(
              (totalDelegated, x) => totalDelegated + x.balance,
              0,
            ),
          }),
          {},
        );
        const vaultedBalance = prevGateway.vaults.reduce(
          (totalVaulted, v) => totalVaulted + v.balance,
          0,
        );
        // mine the correct number of blocks necessary to leave
        await mineBlocks(
          arweave,
          Math.max(0, prevGateway.end - (await getCurrentBlock(arweave))),
        );
        const writeInteraction = await contract.writeInteraction({
          function: 'finalizeLeave',
        });
        expect(writeInteraction?.originalTxId).not.toBe(undefined);
        const { cachedValue: newCachedValue } = await contract.readState();
        const newState = newCachedValue.state as IOState;
        expect(Object.keys(newCachedValue.errorMessages)).not.toContain(
          writeInteraction!.originalTxId,
        );
        expect(newState.gateways[newGatewayOperatorAddress]).toEqual(undefined);
        expect(newState.balances[newGatewayOperatorAddress]).toEqual(
          prevState.balances[newGatewayOperatorAddress] + vaultedBalance,
        );
        // validate balances were returned
        for (const [delegate, qty] of Object.entries(delegatedBalances)) {
          expect(newState.balances[delegate]).toEqual(
            prevState.balances[delegate] + qty,
          );
        }
      });
    });
  });

  describe('non-valid gateway operator', () => {
    let nonGatewayOperator: JWKInterface;
    let nonGatewayOperatorAddress: string;

    beforeAll(async () => {
      owner = getLocalWallet(0);
      ownerAddress = await arweave.wallets.getAddress(owner);
      nonGatewayOperator = getLocalWallet(6);
      contract = warp.pst(srcContractId).connect(nonGatewayOperator);
      nonGatewayOperatorAddress = await arweave.wallets.getAddress(
        nonGatewayOperator,
      );
    });

    describe('read interactions', () => {
      it('should be able to fetch gateway details via view state', async () => {
        const { result: gateway } = await contract.viewState({
          function: 'gateway',
          target: ownerAddress,
        });
        const expectedGatewayObj = expect.objectContaining({
          operatorStake: expect.any(Number),
          delegatedStake: expect.any(Number),
          status: expect.any(String),
          vaults: expect.any(Array),
          delegates: expect.any(Object),
          settings: expect.any(Object),
        });
        expect(gateway).not.toBe(undefined);
        expect(gateway).toEqual(expectedGatewayObj);
      });

      it('should be return an error when fetching a non-existent gateway via viewState', async () => {
        const response = await contract.viewState({
          function: 'gateway',
          target: 'non-existent-gateway',
        });
        expect(response).not.toBe(undefined);
        expect(response?.errorMessage).toEqual(
          'This target does not have a registered gateway.',
        );
      });

      it('should be able to fetch gateways total stake', async () => {
        const { cachedValue } = await contract.readState();
        const fullState = cachedValue.state as IOState;
        const { result: gatewayTotalStake } = await contract.viewState({
          function: 'gatewayTotalStake',
          target: ownerAddress,
        });
        expect(gatewayTotalStake).toEqual(
          fullState.gateways[ownerAddress].operatorStake +
            fullState.gateways[ownerAddress].delegatedStake,
        );
      });

      it('should be able to fetch gateway address registry via view state', async () => {
        const { cachedValue } = await contract.readState();
        const fullState = cachedValue.state as IOState;
        const { result: gateways } = await contract.viewState({
          function: 'gatewayRegistry',
        });
        expect(gateways).not.toBe(undefined);
        expect(gateways).toEqual(fullState.gateways);
      });

      it('should be able to fetch stake ranked, active gateway address registry via view state', async () => {
        const { result: rankedGateways } = await contract.viewState({
          function: 'rankedGatewayRegistry',
        });
        expect(rankedGateways).not.toBe(undefined); // TODO, make this more specific
      });
    });

    describe('write interactions', () => {
      it('should not join the network without correct parameters', async () => {
        const { cachedValue: prevCachedValue } = await contract.readState();
        const prevBalance =
          prevCachedValue.state.balances[nonGatewayOperatorAddress];
        const qty = WALLET_FUND_AMOUNT * 2; // This user should not have this much
        const label = 'Invalid Gateway'; // friendly label
        const fqdn = 'invalid.io';
        const port = 3000;
        const protocol = 'http';
        const openDelegation = true;
        const note = 'Invalid gateway';
        const writeInteraction = await contract.writeInteraction({
          function: 'joinNetwork',
          qty,
          label,
          fqdn,
          port,
          protocol,
          openDelegation,
          note,
        });
        expect(writeInteraction?.originalTxId).not.toBe(undefined);
        const { cachedValue: newCachedValue } = await contract.readState();
        const newState = newCachedValue.state as IOState;
        expect(Object.keys(newCachedValue.errorMessages)).toContain(
          writeInteraction!.originalTxId,
        );
        expect(newState.balances[nonGatewayOperatorAddress]).toEqual(
          prevBalance,
        );
        expect(newState.gateways[nonGatewayOperatorAddress]).toEqual(undefined);
      });
    });
  });
});