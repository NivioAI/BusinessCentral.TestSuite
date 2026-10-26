/// <reference types="vite/client" />

import type { BcFlowApi } from "../shared/models";

declare global {
  interface Window {
    bcFlow: BcFlowApi;
  }
}
