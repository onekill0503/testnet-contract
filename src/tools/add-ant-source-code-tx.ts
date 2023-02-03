import {
  defaultCacheOptions,
  LoggerFactory,
  WarpFactory,
} from "warp-contracts";
import * as fs from "fs";
import { JWKInterface } from "arweave/node/lib/wallet";
import { deployedContracts } from "../deployed-contracts";
import { keyfile } from "../constants";

(async () => {
    //~~~~~~~~~~~~~~~~~~~~~~~~~~UPDATE THE BELOW~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  // This is the Smartweave Source Code Transaction that will be added to the approved white list of ANTs
  const antSourceCodeTxToAdd = "JIIB01pRbNK2-UyNxwQK-6eknrjENMTpTvQmB8ZDzQg";
  //~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

  // This is the production ArNS Registry Smartweave Contract TX ID
  const arnsRegistryContractTxId = deployedContracts.contractTxId;

  // Initialize `LoggerFactory`
  LoggerFactory.INST.logLevel("error");

  // ~~ Initialize SmartWeave ~~
  const warp = WarpFactory.forMainnet(
    {
      ...defaultCacheOptions,
      inMemory: true,
    },
    true
  );

  // Get the key file used for the distribution
  const wallet: JWKInterface = JSON.parse(
    await fs.readFileSync(keyfile).toString()
  );

  // Read the ANT Registry Contract
  const pst = warp.pst(arnsRegistryContractTxId);
  pst.connect(wallet);

  // Remove the record in ArNS Registry
  console.log(
    "Whitelisting the ANT Source Code: %s",
    antSourceCodeTxToAdd,
  );
  const txId = await pst.writeInteraction({
    function: "addANTSourceCodeTx",
    contractTransactionId: antSourceCodeTxToAdd,
  });
  console.log("Finished adding the ANT Source Code TX to the approved white list with txid: %s", txId);
})();
