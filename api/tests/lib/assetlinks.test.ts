import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// The Mobile Wallet Adapter spec: wallets verify a dapp's identity by reading the Digital Asset Links file at the identity URI and
// matching the calling package and its signing certificate. The file is static; this pins its shape to the app's package and key.
describe("/.well-known/assetlinks.json", () => {
  const file = JSON.parse(readFileSync(path.join(__dirname, "../../public/.well-known/assetlinks.json"), "utf8")) as { relation: string[]; target: { namespace: string; package_name: string; sha256_cert_fingerprints: string[] } }[];
  it("names the app's package and its EAS signing certificate", () => {
    expect(file).toHaveLength(1);
    expect(file[0].target.namespace).toBe("android_app");
    expect(file[0].target.package_name).toBe("money.sprouts.app");
    expect(file[0].target.sha256_cert_fingerprints).toEqual(["B9:B0:58:6E:A7:08:26:68:73:BD:04:9A:C4:CB:7F:D0:24:92:6D:4E:FD:E1:60:61:04:42:0D:8C:B9:30:99:42"]);
    for (const f of file[0].target.sha256_cert_fingerprints) expect(f).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  });
});
