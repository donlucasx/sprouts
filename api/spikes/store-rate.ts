import { storeRedeemRate } from "../src/lib/store";
console.log(Number(await storeRedeemRate()) / 1e9);
