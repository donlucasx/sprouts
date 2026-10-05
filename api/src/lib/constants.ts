import { address } from "@solana/kit";

export const SKR_MINT = address("SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3");
export const SKR_STAKING_PROGRAM = address("SKRskrmtL83pcL4YqLWt6iPefDqwXQWHSw9S9vz94BZ");
export const STAKE_CONFIG = address("4HQy82s9CHTv1GsYKnANHMiHfhcqesYkK6sB3RDSYyqw");
export const STAKE_VAULT = address("8isViKbwhuhFhsv2t8vaFL74pKCqaFPQXo1KkeQwZbB8");
export const GUARDIAN_POOL = address("DPJ58trLsF9yPrBa2pk6UaRkvqW8hWUYjawe788WBuqr");
export const SUBSCRIPTIONS_PROGRAM = address("De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44");
export const USDC_MINT = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
export const WSOL_MINT = address("So11111111111111111111111111111111111111112");
export const STORE_MINT = address("storenSbvkfzircixnaosc5CbzNZVrHJ6S3EKrS1yqR");
export const GENESIS_GROUP = address("GT22s89nU4iWFkNXj1Bw6uYhJJWDRPpShHt4Bk8f99Te");

export const USDC_DECIMALS = 6;
export const SKR_DECIMALS = 6;
export const MIN_STAKE_RAW = 1_000_000n;

// Lending + leash (contracts 2.1, 3.1). The leash program id was fixed by Track L's Task 0 (DECIDED 10-04).
export const LEASH_PROGRAM = address("GyBmDLN72kg6xwAnZfj9c7fjeaJ3GvhkHNhFns83f8f7");
/** The only key that may init or set the leash config (R299; his laptop, never the server). */
export const LEASH_ADMIN = address("GrHSwzYpgiFzuTpwR6539NpNXktXNEUfVU9UYvHdDKLY");
export const PYTH_HERMES = "https://hermes.pyth.network";
export const KLEND_PROGRAM = address("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD");
export const JLEND_PROGRAM = address("jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9");
export const JLEND_LIQUIDITY_PROGRAM = address("jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC");
export const PYTH_RECEIVER = address("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");
export const PYTH_PUSH_ORACLE = address("pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT");
export const STAKE_POOL_PROGRAM = address("SP12tWFxD9oJsVWNavTTBZvMbA6gkAmxtVgxdqvyvhY");
export const ORE_STAKE_PROGRAM = address("stakecNP3FpiExZPCgZfqRgumVzi6dNqnfrjwXyTgeH");
export const ORE_STAKE_ACCOUNT = address("4apcWHDc5RF2mpu4MDj6aRQ91aH5rZqbmJviBc75jwi8");
export const SYSVAR_INSTRUCTIONS = address("Sysvar1nstructions1111111111111111111111111");
export const SYSTEM_PROGRAM = address("11111111111111111111111111111111");
