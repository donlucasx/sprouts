#!/usr/bin/env python3
"""One-slot mainnet snapshot of every account the leash tests read, plus independent reference values for spike S2."""
import base64, json, sys, time, urllib.request

RPC = sys.argv[1]
OUT = "accounts"
SKR_STAKING = "SKRskrmtL83pcL4YqLWt6iPefDqwXQWHSw9S9vz94BZ"
ACCOUNTS = [
    # K-Lend main market: reserves, the dust reserve AWnKJ9, market, LMA, vaults, collateral mints, Scope prices
    "D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59", "d4A2prbA2whesmvHaL88BH6Ewn5N4bTSU2Ze8P6Bc4Q", "AWnKJ9dsiHcoDCThxE5E93ikDTAXkApoNwrKM2tp9KFJ",
    "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF", "9DrvZvyWh1HuAoZxvYWMvkf2XCzryCpGgHqrMjyDWpmo",
    "Bgq7trRgVMeq33yt235zM2onQ4bRDBsY5EWiTetF4qw6", "GafNuUXj9rxGLn4y79dPu6MHSuPWeJR6UtTWuexpGh3U",
    "B8V6WVjPxW1UGwVDfxH2d2r8SyT4cqn7dQRK6XneVa7D", "2UywZrUdyqs5vDchy7fKQJKau2RVyuzBev2XKGPDSiX1", "8EFj1QBADsCs2D1DNWWTHjsoWmEPW8FGFgKdsAeqoQJi",
    "3t4JZcueEzTbVP6kLxXrL3VpWx45jDer4eqysweBchNH",
    # mints
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "So11111111111111111111111111111111111111112", "SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3",
    "storenSbvkfzircixnaosc5CbzNZVrHJ6S3EKrS1yqR", "oreoU2P8bN6jkk3jbaiVxYnG1dCXcYxwhwyK9jSybcp", "he1iusmfkpAdwvxLNGV8Y1iSbj4rUy6yMhEA3fotn9A",
    "cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij",
    # Jupiter Lend Earn (USDC, then WSOL), shared admin and liquidity
    "2vVYHYM8VYnvZqQWpTJSj8o8DBf1wM8pVs3bsTgYZiqJ", "BeAqbxfrcXmzEYT2Ra62oW2MqkuFDHaCtps47Mzg6Zj3", "5nmGjA4s7ATzpBQXC5RNceRpaJ7pYw2wKsNBWyuSAZV6",
    "94vK29npVbyRHXH63rRcTiSr26SFhrQTzbpNJuhQEDu", "4Y66HtUEqbbbpZdENGtFdVhUMS3tnagffn3M4do59Nfy",
    "Hf9gtkM4dpVBahVSzEXSVCAPpKzBsBcns3s8As3z77oF", "4SkEYxmiRgQ4VYyvh9VB4k39M49BpqazyzDUFDzJhXQm",
    "5pjzT5dFTsXcwixoab1QDLvZQvpYJxJeBphkyfHGn688", "Acvyi9HBGmqh3Exe1N4PjBVyY8fokq2AdC6fSLqV6KSo",
    "BmkUoKMFYBxNSzWXyUjyMJjMAaVz4d8ZnxwwmhDCUXFB", "5JP5zgYCb9W37QQLgAHRHuinFLrKt87akDY1CgZoTPzr",
    "7s1da8DduuBFqGra5bJBjpnvL5E9mGzCuMk1Qkh4or2Z",
    "5xSPBiD3TibamAnwHDhZABdB4z4F9dcj5PnbteroBTTd", "CkeQGDRsgMZcCaU8cZEdC2aFAohia4jLzL36RaLcUDsR",
    "9BEcn9aPEmhSPbPQeFGjidRiEKki46fVQDyPpSQXPA2D", "2uQsyo1fXXQkDtcpXnLofWy88PxcvnfH2L8FPSE62FVU",
    # SKR staking, stORE, hSOL
    "4HQy82s9CHTv1GsYKnANHMiHfhcqesYkK6sB3RDSYyqw", "DPJ58trLsF9yPrBa2pk6UaRkvqW8hWUYjawe788WBuqr", "8isViKbwhuhFhsv2t8vaFL74pKCqaFPQXo1KkeQwZbB8",
    "4apcWHDc5RF2mpu4MDj6aRQ91aH5rZqbmJviBc75jwi8", "3wK2g8ZdzAH8FJ7PKr2RcvGh7V9VYson5hrVsJM5Lmws",
    # Pyth sponsored price accounts: SOL, USDC, cbBTC, ORE
    "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE", "Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX",
    "7oqYpv5YbjJ2PEsNeVVB5ZEZ8ZE6ufkj8hAvAiaiftbe", "GYYQ8gbX4Tndc4WMJ9jSjZTePTvbmgRRxByt54ZQYqvZ",
]


def rpc(method, params):
    req = urllib.request.Request(RPC, data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode(),
                                 headers={"content-type": "application/json"})
    r = json.load(urllib.request.urlopen(req, timeout=60))
    if "error" in r:
        raise SystemExit(f"{method}: {r['error']}")
    return r["result"]


def get(url):
    return json.load(urllib.request.urlopen(urllib.request.Request(url, headers={"user-agent": "leash-fixtures"}), timeout=60))


def save(address, v):
    with open(f"{OUT}/{address}.json", "w") as f:
        json.dump({"pubkey": address, "owner": v["owner"], "lamports": v["lamports"], "executable": v["executable"], "data_b64": v["data"][0]}, f)


res = rpc("getMultipleAccounts", [ACCOUNTS, {"encoding": "base64", "commitment": "confirmed"}])
slot, now = res["context"]["slot"], int(time.time())
missing = []
for k, v in zip(ACCOUNTS, res["value"]):
    if v is None:
        missing.append(k)
    else:
        save(k, v)
epoch = rpc("getEpochInfo", [{"commitment": "confirmed"}])["epoch"]

# A live UserStake: the first UserStake account touched by a recent StakeConfig transaction.
user_stake = None
for s in rpc("getSignaturesForAddress", ["4HQy82s9CHTv1GsYKnANHMiHfhcqesYkK6sB3RDSYyqw", {"limit": 25}]):
    tx = rpc("getTransaction", [s["signature"], {"encoding": "json", "maxSupportedTransactionVersion": 0}])
    if not tx:
        continue
    loaded = tx["meta"].get("loadedAddresses") or {}
    keys = tx["transaction"]["message"]["accountKeys"] + loaded.get("writable", []) + loaded.get("readonly", [])
    for k, v in zip(keys, rpc("getMultipleAccounts", [keys, {"encoding": "base64"}])["value"]):
        if v and v["owner"] == SKR_STAKING and base64.b64decode(v["data"][0])[:8].hex() == "6635a36b098a5799":
            save(k, v)
            user_stake = k
            break
    if user_stake:
        break

kamino = {x["reserve"]: x["totalSupply"] for x in get("https://api.kamino.finance/kamino-market/7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF/reserves/metrics")}
jl = {t["address"]: t["convertToAssets"] for t in get("https://lite-api.jup.ag/lend/v1/earn/tokens")}
ore = get("https://lite-api.jup.ag/price/v3?ids=oreoU2P8bN6jkk3jbaiVxYnG1dCXcYxwhwyK9jSybcp").get("oreoU2P8bN6jkk3jbaiVxYnG1dCXcYxwhwyK9jSybcp") or {}

ref = {
    "slot": slot, "unix_ts": now, "epoch": epoch, "missing": missing, "user_stake": user_stake,
    "kamino_total_supply": {k: kamino.get(k) for k in ("D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59", "d4A2prbA2whesmvHaL88BH6Ewn5N4bTSU2Ze8P6Bc4Q")},
    "jlend_convert_to_assets": {k: jl.get(k) for k in ("9BEcn9aPEmhSPbPQeFGjidRiEKki46fVQDyPpSQXPA2D", "2uQsyo1fXXQkDtcpXnLofWy88PxcvnfH2L8FPSE62FVU")},
    "jup_ore_usd": ore.get("usdPrice"),
}
with open(f"{OUT}/reference.json", "w") as f:
    json.dump(ref, f, indent=1)
print(json.dumps(ref, indent=1))
