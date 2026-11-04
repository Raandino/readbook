import type { ExtractOptions, ExtractResult, SourceAdapter } from "@readbook/core";

import { classifySource } from "../detect";
import { extractWithReadability } from "../readability";

/**
 * Substack posts are clean, semantic HTML that Readability handles well, so this
 * adapter is just Readability with the right SourceKind stamped on it.
 */
export const substackAdapter: SourceAdapter = {
  kind: "substack",
  matches(url: URL): boolean {
    return classifySource(url) === "substack";
  },
  extract(url: string, options: ExtractOptions): Promise<ExtractResult> {
    return extractWithReadability(url, "substack", options);
  },
};
