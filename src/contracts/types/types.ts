// ~~ Write types for your contract ~~
export interface GNSRState {
  ticker: string;
  name: string;
  owner: string;
  evolve: string;
  records: {
    [name: string]: string;
  }
  balances: {
    [address: string]: number;
  };
}

export interface PstAction {
  input: PstInput;
  caller: string;
}

export interface PstInput {
  function: PstFunction;
  target: string;
  value: string;
  name: string;
  contractTransactionId: string;
  qty: number;
}

export interface PstResult {
  target: string;
  ticker: string;
  balance: number;
}

export interface GNSRNameResult {
  name: string;
  contractTransactionId: string;
}


export type PstFunction = "transfer" | "mint" | "evolve" | "buyRecord" | "removeRecord" | "balance";

export type ContractResult = { state: GNSRState } | { result: PstResult } | {result: GNSRNameResult};