import type { L4d2Api } from "../main/app/ipc-contract.js";

declare global {
  interface Window {
    l4d2Api: L4d2Api;
  }
}

export {};