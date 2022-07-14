import ArLocal from "arlocal";
import Arweave from "arweave";
import { addFunds, mineBlock } from "../utils/_helpers";
import * as fs from "fs";
import path from "path";
import {
  InteractionResult,
  LoggerFactory,
  PstContract,
  PstState,
  Warp,
  WarpNodeFactory,
} from "warp-contracts";
import { JWKInterface } from "arweave/node/lib/wallet";
import { ArNSState } from "../src/contracts/types/types";

const TOKENS_TO_CREATE = 0; // ten million tokens
const EXPECTED_BALANCE_AFTER_INVALID_TX = 838750000; // 0 + 1000000000 - 156250000 - 5000000

describe("Testing the ArNS Registry Contract", () => {
  let contractSrc: string;
  let wallet: JWKInterface;
  let wallet2: JWKInterface;
  let walletAddress: string;
  let walletAddress2: string;
  let initialState: ArNSState;
  let Warp: Warp;
  let arweave: Arweave;
  let pst: PstContract;
  const arlocal = new ArLocal(1820, false);
  beforeAll(async () => {
    // ~~ Set up ArLocal and instantiate Arweave ~~
    await arlocal.start();

    arweave = Arweave.init({
      host: "localhost",
      port: 1820,
      protocol: "http",
    });

    // ~~ Initialize 'LoggerFactory' ~~
    LoggerFactory.INST.logLevel("fatal");

    // ~~ Set up Warp ~~
    Warp = WarpNodeFactory.forTesting(arweave);

    // ~~ Generate wallet and add funds ~~
    wallet = await arweave.wallets.generate();
    walletAddress = await arweave.wallets.jwkToAddress(wallet);
    await addFunds(arweave, wallet);
    wallet2 = await arweave.wallets.generate();
    walletAddress2 = await arweave.wallets.jwkToAddress(wallet2);
    await addFunds(arweave, wallet2);

    // ~~ Read contract source and initial state files ~~
    contractSrc = fs.readFileSync(
      path.join(__dirname, "../dist/contract.js"),
      "utf8"
    );
    const stateFromFile: ArNSState = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, "../dist/contracts/initial-state.json"),
        "utf8"
      )
    );

    // ~~ Update initial state ~~
    initialState = {
      ...stateFromFile,
      ...{
        owner: walletAddress,
      },
      records: {
        ["permaweb"]: { // We set an expired name here so we can test overwriting it
          tier: 1,
          contractTxId: "io9_QNUf4yBG0ErNKCmjGzZ-X9BJhmWOiVVQVyainlY",
          maxSubdomains: 100,
          endTimestamp: 100_000_000
        },
        ["grace"]: { // We set an expired name here so we can test overwriting it
          tier: 3,
          contractTxId: "GRACENUf4yBG0ErNKCmjGzZ-X9BJhmWOiVVQVyainlY",
          maxSubdomains: 10000,
          endTimestamp: Math.round(Date.now() / 1000)
        }
      },
      balances: {
        [walletAddress]: 0, // create tokens during mint
        [walletAddress2]: 1_000_000_000
      },
    };

    // ~~ Deploy contract ~~
    const deploy = await Warp.createContract.deploy({
      wallet,
      initState: JSON.stringify(initialState),
      src: contractSrc,
    });

    // ~~ Connect to the pst contract ~~
    pst = Warp.pst(deploy.contractTxId);
    pst.connect(wallet);

    // ~~ Mine block ~~
    await mineBlock(arweave);
  });

  afterAll(async () => {
    console.log(await pst.currentState());
    // ~~ Stop ArLocal ~~
    await arlocal.stop();
  });

  it("should read pst state and balance data", async () => {
    console.log(await pst.currentState());
    expect(await pst.currentState()).toEqual(initialState);
    expect((await pst.currentState()).owner).toEqual(walletAddress);
  });

  it("should properly mint tokens", async () => {
    await pst.writeInteraction({
      function: "mint",
      qty: 1_000_000_000,
    });
    await mineBlock(arweave);
    expect((await pst.currentState()).balances[walletAddress]).toEqual(
      0 + 1000000000
    );
  });

  it("should properly buy records", async () => {
    pst.connect(wallet2)
    const tier2Name = "microsoft" // should cost 1000000 tokens
    await pst.writeInteraction({
      function: "buyRecord",
      name: tier2Name,
      contractTxId: "MSFTfeBVyaJ8s9n7GxIyJNNc62jEVCKD7lbL3fV8kzU",
      years: 6,
      tier: 2
    });
    await mineBlock(arweave);
    pst.connect(wallet)
    const nameToBuy = "permaWEB"; // this should be set to lower case, this name already exists but is expired
    const contractTxId = "lheofeBVyaJ8s9n7GxIyJNNc62jEVCKD7lbL3fV8kzU"
    const years = 3;
    const tier = 1;
    await pst.writeInteraction({
      function: "buyRecord",
      name: nameToBuy, // should cost 5000000 tokens
      contractTxId,
      years,
      tier
    });
    await mineBlock(arweave);
    const anotherNameToBuy = "vile";
    const anothercontractTxId = "BBBBfeBVyaJ8s9n7GxIyJNNc62jEVCKD7lbL3fV8kzU"
    await pst.writeInteraction({
      function: "buyRecord",
      name: anotherNameToBuy, // should cost 156250000 tokens
      contractTxId: anothercontractTxId,
      years,
      tier
    });
    await mineBlock(arweave);
    const currentState = await pst.currentState();
    const currentStateString = JSON.stringify(currentState); // Had to do this because I cannot use my custom token interface
    const currentStateJSON = JSON.parse(currentStateString);
    expect(currentStateJSON.records[tier2Name].maxSubdomains).toEqual(1000);
    expect(currentStateJSON.records[nameToBuy.toLowerCase()].contractTxId).toEqual("lheofeBVyaJ8s9n7GxIyJNNc62jEVCKD7lbL3fV8kzU");
    expect(currentStateJSON.records[anotherNameToBuy].contractTxId).toEqual("BBBBfeBVyaJ8s9n7GxIyJNNc62jEVCKD7lbL3fV8kzU");
    expect((await pst.currentState()).balances[walletAddress]).toEqual(EXPECTED_BALANCE_AFTER_INVALID_TX);
  });

  it("should not buy malformed, too long, existing, or too expensive records", async () => {
    const emptyNameToBuy = "";
    const contractTxId = "lheofeBVyaJ8s9n7GxIyJNNc62jEVCKD7lbL3fV8kzU"
    let years = 1;
    let tier = 1;
    await pst.writeInteraction({
      function: "buyRecord",
      name: emptyNameToBuy, // should cost 156250000 tokens
      contractTxId,
      years,
      tier
    });
    await mineBlock(arweave);
    expect((await pst.currentState()).balances[walletAddress]).toEqual(EXPECTED_BALANCE_AFTER_INVALID_TX);
    const malformedNameToBuy = "*&*##$%#";
    await pst.writeInteraction({
      function: "buyRecord",
      name: malformedNameToBuy, // should cost 156250000 tokens
      contractTxId,
      years,
      tier
    });
    await mineBlock(arweave);
    expect((await pst.currentState()).balances[walletAddress]).toEqual(EXPECTED_BALANCE_AFTER_INVALID_TX);
    const veryLongNameToBuy = "this-is-a-looong-name-a-verrrryyyyy-loooooong-name-that-is-too-long";
    await pst.writeInteraction({
      function: "buyRecord",
      name: veryLongNameToBuy, // should cost 156250000 tokens
      contractTxId,
      years,
      tier
    });
    await mineBlock(arweave);
    expect((await pst.currentState()).balances[walletAddress]).toEqual(EXPECTED_BALANCE_AFTER_INVALID_TX);
    const existingNameToBuy = "permaweb"; // this name should already exist and in its lease
    await pst.writeInteraction({
      function: "buyRecord",
      name: existingNameToBuy, // should cost 156250000 tokens
      contractTxId,
      years,
      tier
    });
    await mineBlock(arweave);
    expect((await pst.currentState()).balances[walletAddress]).toEqual(EXPECTED_BALANCE_AFTER_INVALID_TX);
    const gracePeriodNameToBuy = "grace"; // this name should already exist and in its grace period
    await pst.writeInteraction({
      function: "buyRecord",
      name: gracePeriodNameToBuy, // should cost 156250000 tokens
      contractTxId,
      years,
      tier
    });
    await mineBlock(arweave);
    expect((await pst.currentState()).balances[walletAddress]).toEqual(EXPECTED_BALANCE_AFTER_INVALID_TX);
    const expensiveNameToBuy = "v";
    await pst.writeInteraction({
      function: "buyRecord",
      name: expensiveNameToBuy, // should cost 5000000 tokens
      contractTxId,
      years,
      tier
    });
    await mineBlock(arweave);
    expect((await pst.currentState()).balances[walletAddress]).toEqual(EXPECTED_BALANCE_AFTER_INVALID_TX);
    const disallowedNameToBuy = "test.subdomain.name";
    await pst.writeInteraction({
      function: "buyRecord",
      name: disallowedNameToBuy, // should cost 125000 tokens
      contractTxId,
      years,
      tier
    });
    await mineBlock(arweave);
    expect((await pst.currentState()).balances[walletAddress]).toEqual(EXPECTED_BALANCE_AFTER_INVALID_TX);
    const disallowedNameToBuy2 = "test_subdomain";
    await pst.writeInteraction({
      function: "buyRecord",
      name: disallowedNameToBuy2,
      contractTxId,
      years,
      tier
    });
    await mineBlock(arweave);
    expect((await pst.currentState()).balances[walletAddress]).toEqual(EXPECTED_BALANCE_AFTER_INVALID_TX);
    const invalidYearsName = "years";
    await pst.writeInteraction({
      function: "buyRecord",
      name: invalidYearsName,
      contractTxId,
      years: 0, // too many years
      tier
    });
    await mineBlock(arweave);
    expect((await pst.currentState()).balances[walletAddress]).toEqual(EXPECTED_BALANCE_AFTER_INVALID_TX);
    const invalidTierName = "tier";
    await pst.writeInteraction({
      function: "buyRecord",
      name: invalidTierName,
      contractTxId,
      years,
      tier: "Yep"
    });
    await mineBlock(arweave);
    expect((await pst.currentState()).balances[walletAddress]).toEqual(EXPECTED_BALANCE_AFTER_INVALID_TX);

  });

  it("should extend record with enough balance", async () => {
    pst.connect(wallet2)
    await pst.writeInteraction({
      function: "extendRecord",
      name: "microsoft", // should cost 1000000 tokens
      years: 10 // should bring to a total of 16 years
    });
    await mineBlock(arweave);
    const currentState = await pst.currentState();
    const currentStateString = JSON.stringify(currentState); // Had to do this because I cannot use my custom token interface
    const currentStateJSON = JSON.parse(currentStateString);
    expect(currentStateJSON.records["microsoft"].endTimestamp).toBeGreaterThanOrEqual(2162247010);
    expect(currentStateJSON.balances[walletAddress2]).toEqual(998000000);
  });

  it("should not extend record with not enough balance or invalid parameters", async () => {
    pst.connect(wallet2)
    await pst.writeInteraction({
      function: "extendRecord",
      name: "doesnt-exist", // This name doesnt exist so it shouldnt be created
      years: 5 
    });
    await mineBlock(arweave);
    await pst.writeInteraction({
      function: "extendRecord",
      name: "microsoft", // should cost 1000000 tokens
      years: 1000 // too many years
    });
    await mineBlock(arweave);
    const newWallet = await arweave.wallets.generate();
    pst.connect(newWallet)
    await pst.writeInteraction({
      function: "extendRecord",
      name: "vile", // should cost too many tokens to extend this existing name with this empty wallet
      years: 50
    });
    await mineBlock(arweave);
    const currentState = await pst.currentState();
    const currentStateString = JSON.stringify(currentState); // Had to do this because I cannot use my custom token interface
    const currentStateJSON = JSON.parse(currentStateString);
    expect(currentStateJSON.balances[walletAddress2]).toEqual(998000000);
    expect(currentStateJSON.records["vile"].endTimestamp).toBeLessThan(1760000000);

  });

  it("should properly evolve contract's source code", async () => {
    pst.connect(wallet)
    expect((await pst.currentBalance(walletAddress)).balance).toEqual(0 + 1000000000 - 156250000 - 5000000);

    const newSource = fs.readFileSync(path.join(__dirname, '../src/tools/contract_evolve.js'), 'utf8');

    const newSrcTxId = await pst.save({src: newSource});
    if (newSrcTxId === null) {
      return 0;
    }
    await mineBlock(arweave);

    await pst.evolve(newSrcTxId);
    await mineBlock(arweave);

    // note: the evolved balance always returns -1
    expect((await pst.currentBalance(walletAddress)).balance).toEqual(-1);

    const updatedContractTxId = await pst.save({src: contractSrc});
    if (updatedContractTxId === null) {
      return 0;
    }
    await mineBlock(arweave);
    await pst.evolve(updatedContractTxId);
    await mineBlock(arweave);

    // note: the balance should return correctly now
    expect((await pst.currentBalance(walletAddress)).balance).toEqual(0 + 1000000000 - 156250000 - 5000000);
  });

  it("should properly transfer and perform dry write with overwritten caller", async () => {
    const newWallet = await arweave.wallets.generate();
    const overwrittenCaller = await arweave.wallets.jwkToAddress(newWallet);
    await pst.transfer({
      target: overwrittenCaller.toString(),
      qty: 500000,
    });

    await mineBlock(arweave);
    expect((await pst.currentState()).balances[walletAddress]).toEqual(
      1000000000 - 156250000 - 5000000 - 500000
    );
    expect((await pst.currentState()).balances[overwrittenCaller]).toEqual(
      0 + 500000
    );
    const result: InteractionResult<PstState, unknown> = await pst.dryWrite(
      {
        function: "transfer",
        target: "NdZ3YRwMB2AMwwFYjKn1g88Y9nRybTo0qhS1ORq_E7g",
        qty: 25000,
      },
      overwrittenCaller
    );

    expect(result.state.balances[overwrittenCaller]).toEqual(
      0 + 500000 - 25000
    );
    expect(
      result.state.balances["NdZ3YRwMB2AMwwFYjKn1g88Y9nRybTo0qhS1ORq_E7g"]
    ).toEqual(0 + 25000);
  });

  it("should not transfer tokens with incorrect ownership", async () => {
    const newWallet = await arweave.wallets.generate();
    const overwrittenCaller = await arweave.wallets.jwkToAddress(newWallet);
    pst.connect(newWallet)
    await pst.transfer({
      target: walletAddress.toString(),
      qty: 1000000000,
    });
    await mineBlock(arweave);
    expect((await pst.currentState()).balances[walletAddress]).toEqual(
      1000000000 - 156250000 - 5000000 - 500000
    );
    expect((await pst.currentState()).balances[overwrittenCaller]).toEqual(undefined);
  });

  it("should not evolve contract's source code without correct ownership", async () => {
    const newWallet = await arweave.wallets.generate();
    await addFunds(arweave, newWallet);
    pst.connect(newWallet);
    expect((await pst.currentBalance(walletAddress)).balance).toEqual(1000000000 - 156250000 - 5000000 - 500000);

    const newSource = fs.readFileSync(path.join(__dirname, '../src/tools/contract_evolve.js'), 'utf8');
    const newSrcTxId = await pst.save({src: newSource});
    if (newSrcTxId === null) {
      return 0;
    }
    await mineBlock(arweave);

    await pst.evolve(newSrcTxId);
    await mineBlock(arweave);

    // note: the evolved balance always returns 1 because the contract did not change
    expect((await pst.currentBalance(walletAddress)).balance).toEqual(1000000000 - 156250000 - 5000000 - 500000);
  });

  it("should not remove names with incorrect ownership", async () => {
    const nameToRemove = "vile";
    await pst.writeInteraction({
      function: "removeRecord",
      name: nameToRemove
    });
    await mineBlock(arweave);
    const currentState = await pst.currentState();
    const currentStateString = JSON.stringify(currentState);
    const currentStateJSON = JSON.parse(currentStateString);
    expect(currentStateJSON.records[nameToRemove]).toBeTruthy();
  });

  it("should remove names with correct ownership", async () => {
    pst.connect(wallet) // connect the original owning wallet
    const nameToRemove = "vile";
    await pst.writeInteraction({
      function: "removeRecord",
      name: nameToRemove
    });
    await mineBlock(arweave);
    const currentState = await pst.currentState();
    const currentStateString = JSON.stringify(currentState);
    const currentStateJSON = JSON.parse(currentStateString);
    expect(currentStateJSON.records[nameToRemove]).toEqual(undefined);
  });

  it("should change fees with correct ownership", async () => {
    pst.connect(wallet) // connect the original owning wallet
    const feesToChange = {
        "1": 5000000000,
        "2": 1406250000,
        "3": 468750000,
        "4": 156250000,
        "5": 62500000,
        "6": 25000000,
        "7": 10000000,
        "8": 5000000,
        "9": 1000000,
        "10": 500000,
        "11": 450000,
        "12": 400000,
        "13": 350000,
        "14": 300000,
        "15": 250000,
        "16": 200000,
        "17": 175000,
        "18": 150000,
        "19": 125000,
        "20": 5,
        "21": 5,
        "22": 5,
        "23": 5,
        "24": 5,
        "25": 5,
        "26": 5,
        "27": 5,
        "28": 5,
        "29": 5,
        "30": 5,
        "31": 5,
        "32": 5
    };
    await pst.writeInteraction({
      function: "setFees",
      fees: feesToChange
    });
    await mineBlock(arweave);
    const currentState = await pst.currentState();
    const currentStateString = JSON.stringify(currentState);
    const currentStateJSON = JSON.parse(currentStateString);
    expect(currentStateJSON.fees).toEqual(feesToChange);
  });

  it("should not change malformed fees with correct ownership", async () => {
    pst.connect(wallet) // connect the original owning wallet
    const originalFees = {
      "1": 5000000000,
      "2": 1406250000,
      "3": 468750000,
      "4": 156250000,
      "5": 62500000,
      "6": 25000000,
      "7": 10000000,
      "8": 5000000,
      "9": 1000000,
      "10": 500000,
      "11": 450000,
      "12": 400000,
      "13": 350000,
      "14": 300000,
      "15": 250000,
      "16": 200000,
      "17": 175000,
      "18": 150000,
      "19": 125000,
      "20": 5,
      "21": 5,
      "22": 5,
      "23": 5,
      "24": 5,
      "25": 5,
      "26": 5,
      "27": 5,
      "28": 5,
      "29": 5,
      "30": 5,
      "31": 5,
      "32": 5
    };

    let feesToChange = { // should not write if any fee is equal to 0
      "1": 0,
      "2": 0,
      "3": 0,
      "4": 0,
      "5": 0,
      "6": 0,
      "7": 0,
      "8": 0,
      "9": 1000000,
      "10": 500000,
      "11": 450000,
      "12": 400000,
      "13": 350000,
      "14": 300000,
      "15": 250000,
      "16": 200000,
      "17": 175000,
      "18": 150000,
      "19": 125000,
      "20": 5,
      "21": 5,
      "22": 5,
      "23": 5,
      "24": 5,
      "25": 5,
      "26": 5,
      "27": 5,
      "28": 5,
      "29": 5,
      "30": 5,
      "31": 5,
      "32": 5
  };
    await pst.writeInteraction({
      function: "setFees",
      fees: feesToChange
    });
    await mineBlock(arweave);
    let currentState = await pst.currentState();
    let currentStateString = JSON.stringify(currentState);
    let currentStateJSON = JSON.parse(currentStateString);
    expect(currentStateJSON.fees).toEqual(originalFees);

    let feesToChange2 = { // should not write if strings are the fees
      "1": "5000000000",
      "2": 1406250000,
      "3": 468750000,
      "4": 156250000,
      "5": 62500000,
      "6": 25000000,
      "7": 10000000,
      "8": 5000000,
      "9": 1000000,
      "10": 500000,
      "11": 450000,
      "12": 400000,
      "13": 350000,
      "14": 300000,
      "15": 250000,
      "16": 200000,
      "17": 175000,
      "18": 150000,
      "19": 125000,
      "20": 5
  };
    await pst.writeInteraction({
      function: "setFees",
      fees: feesToChange2
    });
    await mineBlock(arweave);
    currentState = await pst.currentState();
    currentStateString = JSON.stringify(currentState);
    currentStateJSON = JSON.parse(currentStateString);
    expect(currentStateJSON.fees).toEqual(originalFees);

    let feesToChange3 = { // should not write with a string as the index
      "whatever": 5000000000, 
      "2": 1406250000,
      "3": 468750000,
      "4": 156250000,
      "5": 62500000,
      "6": 25000000,
      "7": 10000000,
      "8": 5000000,
      "9": 1000000,
      "10": 500000,
      "11": 450000,
      "12": 400000,
      "13": 350000,
      "14": 300000,
      "15": 250000,
      "16": 200000,
      "17": 175000,
      "18": 150000,
      "19": 125000,
      "20": 5
  };
    await pst.writeInteraction({
      function: "setFees",
      fees: feesToChange3
    });
    await mineBlock(arweave);
    currentState = await pst.currentState();
    currentStateString = JSON.stringify(currentState);
    currentStateJSON = JSON.parse(currentStateString);
    expect(currentStateJSON.fees).toEqual(originalFees);

    let feesToChange4 = { // should not write if incomplete fees are added
      "1": 1, 
      "2": 2,
      "3": 3,
      "4": 4,
      "5": 5,
  };
    await pst.writeInteraction({
      function: "setFees",
      fees: feesToChange4
    });
    await mineBlock(arweave);
    currentState = await pst.currentState();
    currentStateString = JSON.stringify(currentState);
    currentStateJSON = JSON.parse(currentStateString);
    expect(currentStateJSON.fees).toEqual(originalFees);

    let feesToChange5 = { // should not write if additional fees are added
      "1": 5000000000, 
      "2": 1406250000,
      "3": 468750000,
      "4": 156250000,
      "5": 62500000,
      "6": 25000000,
      "7": 10000000,
      "8": 5000000,
      "9": 1000000,
      "10": 500000,
      "11": 450000,
      "12": 400000,
      "13": 350000,
      "14": 300000,
      "15": 250000,
      "16": 200000,
      "17": 175000,
      "18": 150000,
      "19": 125000,
      "20": 5,
      "21": 1000000000
  };
    await pst.writeInteraction({
      function: "setFees",
      fees: feesToChange5
    });
    await mineBlock(arweave);
    currentState = await pst.currentState();
    currentStateString = JSON.stringify(currentState);
    currentStateJSON = JSON.parse(currentStateString);
    expect(currentStateJSON.fees).toEqual(originalFees);

    let feesToChange6 = { // should not write if decimals are used
      "1": 5000000000.666, 
      "2": 1406250000,
      "3": 468750000,
      "4": 156250000,
      "5": 62500000,
      "6": 25000000,
      "7": 10000000,
      "8": 5000000,
      "9": 1000000,
      "10": 500000,
      "11": 450000,
      "12": 400000,
      "13": 350000,
      "14": 300000,
      "15": 250000,
      "16": 200000,
      "17": 175000,
      "18": 150000,
      "19": 125000,
      "20": 5.666,
  };
    await pst.writeInteraction({
      function: "setFees",
      fees: feesToChange6
    });
    await mineBlock(arweave);
    currentState = await pst.currentState();
    currentStateString = JSON.stringify(currentState);
    currentStateJSON = JSON.parse(currentStateString);
    expect(currentStateJSON.fees).toEqual(originalFees);


  });

  it("should not change fees with incorrect ownership", async () => {
    const originalFees = {
      "1": 5000000000,
      "2": 1406250000,
      "3": 468750000,
      "4": 156250000,
      "5": 62500000,
      "6": 25000000,
      "7": 10000000,
      "8": 5000000,
      "9": 1000000,
      "10": 500000,
      "11": 450000,
      "12": 400000,
      "13": 350000,
      "14": 300000,
      "15": 250000,
      "16": 200000,
      "17": 175000,
      "18": 150000,
      "19": 125000,
      "20": 5,
      "21": 5,
      "22": 5,
      "23": 5,
      "24": 5,
      "25": 5,
      "26": 5,
      "27": 5,
      "28": 5,
      "29": 5,
      "30": 5,
      "31": 5,
      "32": 5
  };
    const newWallet = await arweave.wallets.generate();
    await addFunds(arweave, newWallet);
    pst.connect(newWallet);
    const feesToChange = {
        "1": 1,
        "2": 1,
        "3": 1,
        "4": 1,
        "5": 1,
        "6": 1,
        "7": 1,
        "8": 1,
        "9": 1,
        "10": 1,
        "11": 1,
        "12": 1,
        "13": 1,
        "14": 1,
        "15": 1,
        "16": 1,
        "17": 1,
        "18": 1,
        "19": 1,
        "20": 5,
        "21": 5,
        "22": 5,
        "23": 5,
        "24": 5,
        "25": 5,
        "26": 5,
        "27": 5,
        "28": 5,
        "29": 5,
        "30": 5,
        "31": 5,
        "32": 5
    };
    await pst.writeInteraction({
      function: "setFees",
      fees: feesToChange
    });
    await mineBlock(arweave);
    const currentState = await pst.currentState();
    const currentStateString = JSON.stringify(currentState);
    const currentStateJSON = JSON.parse(currentStateString);
    expect(currentStateJSON.fees).toEqual(originalFees);
  });

  it("should add valid whitelisted ANT Smartweave Contract Source TX IDs with correct ownership", async () => {
    pst.connect(wallet) // connect the original owning wallet
    const sourceTxIdToAdd = "da51nhDwLZaLBA3lzpE7xl36Rms2NwUNZ7SKOTEWkbI"
    await pst.writeInteraction({
      function: "addANTSourceCodeTx",
      contractTxId: sourceTxIdToAdd
    });

    const anotherSourceTxIdToAdd = "test" // this should not get added because it is not a valid arweave transaction
    await pst.writeInteraction({
      function: "addANTSourceCodeTx",
      contractTxId: anotherSourceTxIdToAdd
    });
    await mineBlock(arweave);
    const currentState = await pst.currentState();
    const currentStateString = JSON.stringify(currentState);
    const currentStateJSON = JSON.parse(currentStateString);
    expect(currentStateJSON.approvedANTSourceCodeTxs).toContain(sourceTxIdToAdd);
    if (currentStateJSON.approvedANTSourceCodeTxs.indexOf(anotherSourceTxIdToAdd) > -1) {
      expect(false);
    } else {
      expect(true);
    }
  });

  it("should not add whitelisted ANT Smartweave Contract Source TX IDs with incorrect ownership", async () => {
    const newWallet = await arweave.wallets.generate();
    await addFunds(arweave, newWallet);
    pst.connect(newWallet);
    const sourceTxIdToAdd = "BLAHhDwLZaLBA3lzpE7xl36Rms2NwUNZ7SKOTEWkbI"
    await pst.writeInteraction({
      function: "addANTSourceCodeTx",
      contractTxId: sourceTxIdToAdd
    });
    await mineBlock(arweave);
    const currentState = await pst.currentState();
    const currentStateString = JSON.stringify(currentState);
    const currentStateJSON = JSON.parse(currentStateString);
    if (currentStateJSON.approvedANTSourceCodeTxs.indexOf(sourceTxIdToAdd) > -1) {
      expect(false);
    } else {
      expect(true);
    }
  });

  it("should not remove whitelisted ANT Smartweave Contract Source TX IDs with incorrect ownership", async () => {
    const newWallet = await arweave.wallets.generate();
    await addFunds(arweave, newWallet);
    pst.connect(newWallet);
    const currentState = await pst.currentState();
    const currentStateString = JSON.stringify(currentState);
    const currentStateJSON = JSON.parse(currentStateString);
    const sourceTxIdToRemove = currentStateJSON.approvedANTSourceCodeTxs[0];
    await pst.writeInteraction({
      function: "removeANTSourceCodeTx",
      contractTxId: sourceTxIdToRemove
    });
    await mineBlock(arweave);
    const newState = await pst.currentState();
    const newStateString = JSON.stringify(newState);
    const newStateJSON = JSON.parse(newStateString);
    expect(newStateJSON.approvedANTSourceCodeTxs).toEqual(currentStateJSON.approvedANTSourceCodeTxs);
  });

  it("should remove whitelisted ANT Smartweave Contract Source TX IDs with correct ownership", async () => {
    pst.connect(wallet);
    const sourceTxIdToRemove = "da51nhDwLZaLBA3lzpE7xl36Rms2NwUNZ7SKOTEWkbI";
    await pst.writeInteraction({
      function: "removeANTSourceCodeTx",
      contractTxId: sourceTxIdToRemove
    });
    await mineBlock(arweave);
    const newState = await pst.currentState();
    const newStateString = JSON.stringify(newState);
    const newStateJSON = JSON.parse(newStateString);
    if (newStateJSON.approvedANTSourceCodeTxs.indexOf(sourceTxIdToRemove) > -1) {
      expect(false);
    } else {
      expect(true);
    }
  });

});


