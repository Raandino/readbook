import type { ExtractOptions, ExtractResult, SourceAdapter } from "@readbook/core";

import { extractWithReadability } from "../readability";

/** The catch-all adapter: any URL we don't specifically recognize. */
export const genericAdapter: SourceAdapter = {
  kind: "generic",
  matches(): boolean {
    // Generic is the fallback owner; the pipeline only reaches it after the
    // specific adapters decline, so it always claims the URL.
    return true;
  },
  extract(url: string, options: ExtractOptions): Promise<ExtractResult> {
    return extractWithReadability(url, "generic", options);
  },
};
