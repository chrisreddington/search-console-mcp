import pkg from "../package.json" with { type: "json" };

/**
 * The one place that reads package.json's version, so the MCP server identity
 * and the 1Password client identity can never drift from it or each other.
 */
export const PACKAGE_VERSION: string = pkg.version;
