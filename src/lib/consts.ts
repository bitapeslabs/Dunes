import { z } from "zod";
import dotenv from "dotenv";
import { IDunestoneIndexed } from "./dunestone";
dotenv.config();

const envSchema = z.object({
  BTC_RPC_URL: z.string().url(),
  BTC_RPC_USERNAME: z.string(),
  BTC_RPC_PASSWORD: z.string(),

  DB_HOST: z.string(),
  DB_PORT: z.coerce.number().int().nonnegative(),
  DB_USER: z.string(),
  DB_PASSWORD: z.string(),
  DB_NAME: z.string(),

  PREFETCH_BLOCKS: z.coerce.number().int().nonnegative(),
  RPC_PORT: z.coerce.number().int().positive(),

  GENESIS_BLOCK: z.coerce.number().int().nonnegative().optional(),
});

const env = envSchema.parse(process.env);

export const BTC_RPC_URL = env.BTC_RPC_URL;
export const BTC_RPC_USERNAME = env.BTC_RPC_USERNAME;
export const BTC_RPC_PASSWORD = env.BTC_RPC_PASSWORD;

export const DB_HOST = env.DB_HOST;
export const DB_PORT = env.DB_PORT;
export const DB_USER = env.DB_USER;
export const DB_PASSWORD = env.DB_PASSWORD;
export const DB_NAME = env.DB_NAME;

export const PREFETCH_BLOCKS = env.PREFETCH_BLOCKS;
export const RPC_PORT = env.RPC_PORT;

export const GENESIS_BLOCK = env.GENESIS_BLOCK ?? 4326248;

export const TAPROOT_ANNEX_PREFIX = 0x50;
export const UNLOCK_INTERVAL = 17500; // as per dunes spec
export const COMMIT_CONFIRMATIONS = 6;
export const INITIAL_AVAILABLE = 13; // as per dunes spec
export const TAPROOT_SCRIPT_PUBKEY_TYPE = "witness_v1_taproot";
export const MAX_SIGNED_128_BIT_INT = 0x7fffffffffffffffffffffffffffffffn + 1n;

export const GENESIS_DUNESTONE = {
  etching: {
    dune: "duni",
    symbol: "\uD83C\uDF35", // cactus 🌵
    premine: 0n,
    divisibility: 0,
    turbo: true,
    terms: {
      amount: 100n,
      cap: 1000000n,

      height: [4326248, null],
      offset: [null, null],
      price: {
        amount: 21000,
        pay_to:
          "tb1p8888zulc047mg3mf252tqeagc2feeh8a2pqn87arzd80t9qdkgcqkf8y5h",
      },
    },
  } as IDunestoneIndexed["etching"],
  cenotaph: false,
} as const;
