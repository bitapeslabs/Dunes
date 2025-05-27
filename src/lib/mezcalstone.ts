import { z, ZodIssue } from "zod";
import { Transaction } from "@/lib/apis/bitcoinrpc/types";
import { getOpReturnPayload } from "./crypto/utils";
import { isBoxedError } from "./boxed";
import { BITCOINJS_NETWORK } from "./consts";
import { address } from "bitcoinjs-lib";

const MAX_U128 = (1n << 128n) - 1n;
const MAX_U32 = 0xffff_ffff;
const MAX_U8 = 0xff;
const MAX_SATOSHI_EVER_IN_CIRCULATION = 2100000000000000;

const isValidU128 = (s: string) => {
  try {
    const n = BigInt(s);
    return 0n <= n && n <= MAX_U128;
  } catch {
    return false;
  }
};

function isValidBtcAddress(addr: string): boolean {
  try {
    address.toOutputScript(addr, BITCOINJS_NETWORK);
    return true;
  } catch (error) {
    console.error("Invalid Bitcoin address:", addr, error);
    return false;
  }
}

export const BtcAddressSchema = z
  .string()
  .trim()
  .refine(isValidBtcAddress, { message: "Invalid Bitcoin address" });

const satoshi = z.preprocess((v) => {
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (
      Number.isSafeInteger(n) &&
      n >= 0 &&
      n <= MAX_SATOSHI_EVER_IN_CIRCULATION
    ) {
      return n; // ✅ successful cast
    }
  }
  return v; // ❌ leave as-is (string)
}, z.number().int().nonnegative().max(MAX_SATOSHI_EVER_IN_CIRCULATION));

const mezcalAmount = z.string().refine(
  (s) => {
    return isValidU128(s) && s !== "";
  },
  { message: "amount must be a decimal string within u128 range" }
);

const u32 = () => z.number().int().nonnegative().max(MAX_U32);
const u8 = () => z.number().int().nonnegative().max(MAX_U8);

export const PriceTermsSchema = z.object({
  amount: satoshi,
  pay_to: BtcAddressSchema,
});

export const AcceptedPriceTermsSchema = z.union([
  PriceTermsSchema,
  z.array(PriceTermsSchema),
]);

const PriceArraySchema = z.preprocess(
  (v) => (Array.isArray(v) ? v : v === undefined || v === null ? v : [v]),
  z.array(PriceTermsSchema)
);

const EdictTupleSchema = z
  .tuple([
    z.string().regex(/^\d+:\d+$/, "id must look like “0:0”"), // id
    mezcalAmount, // amount
    u8(), // output
  ])
  .transform(([id, amount, output]) => ({ id, amount, output }));

const EdictObjectSchema = z.object({
  id: z.string().regex(/^\d+:\d+$/, "id must look like “0:0”"),
  amount: mezcalAmount,
  output: u8(),
});

export const EdictSchema = z.union([EdictObjectSchema, EdictTupleSchema]);

export const TermsSchema = z.object({
  price: PriceArraySchema.optional(), // <— always array when present
  amount: mezcalAmount,
  cap: mezcalAmount.optional().nullable(),
  height: z.tuple([u32().nullable(), u32().nullable()]),
  offset: z.tuple([u32().nullable(), u32().nullable()]),
});

/* ── Mint & Etching ──────────────────────────── */
export const MintSchema = z
  .string()
  .regex(/^\d+:\d+$/, "mint must look like 'block:tx'")
  .transform((val) => {
    const [blockStr, txStr] = val.split(":");
    const block = Number(blockStr);
    const tx = Number(txStr);

    if (
      !Number.isInteger(block) ||
      block < 0 ||
      block > MAX_U32 ||
      !Number.isInteger(tx) ||
      tx < 0 ||
      tx > MAX_U32
    ) {
      throw new Error("block and tx must be valid u32 integers");
    }

    return `${block}:${tx}`;
  });

export const EtchingSchema = z.object({
  divisibility: z.number().int().nonnegative().max(18),
  premine: mezcalAmount,
  mezcal: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .min(1)
    .max(15),
  symbol: z
    .string()
    .min(1)
    .refine((s) => [...s].length === 1, {
      message: "symbol must be exactly one visible character or emoji",
    }),
  terms: z.union([TermsSchema, z.null()]),
  turbo: z.boolean().default(true),
});

export const MezcalstoneSchema = z
  .object({
    p: z.union([
      z.literal("mezcal"),
      z.literal("https://mezcal.sh"),
      z.literal("https://t.me/mezcalbtc"),
    ]),
    edicts: z.array(EdictSchema).optional(),
    etching: EtchingSchema.optional(),
    mint: MintSchema.optional(),
    pointer: u32().optional(),
  })
  .strict();

export type IPriceTerms = z.infer<typeof AcceptedPriceTermsSchema>;
export type IEdict = z.infer<typeof EdictSchema>;
export type ITerms = z.infer<typeof TermsSchema>;
export type IMint = z.infer<typeof MintSchema>;
export type IEtching = z.infer<typeof EtchingSchema>;
export type IMezcalstoneFull = z.infer<typeof MezcalstoneSchema>;
export type IMezcalstone = Omit<IMezcalstoneFull, "p"> & { p?: string };

export const AMOUNT_KEYS = new Set(["amount", "cap", "premine"]);
type AmountKeys = "amount" | "cap" | "premine";

type ToBigint<U> = [Extract<U, string>] extends [never]
  ? U
  : bigint | Exclude<U, string>;
type ToIndexed<T> = T extends (infer U)[]
  ? ToIndexed<U>[]
  : T extends object
  ? {
      [K in keyof T]: K extends AmountKeys ? ToBigint<T[K]> : ToIndexed<T[K]>;
    }
  : T;

export type IMezcalstoneIndexed = ToIndexed<IMezcalstone> & {
  cenotaph: boolean;
  issues?: ZodIssue[];
};

/* ── Runtime helpers ─────────────────────────── */
function getOpReturnData(tx: Transaction): { cenotaph: boolean; hex: string } {
  const opOut = tx.vout.find(
    (out): out is Transaction["vout"][number] =>
      out.scriptPubKey.type === "nulldata" ||
      out.scriptPubKey.asm?.startsWith("OP_RETURN")
  );
  if (!opOut?.scriptPubKey?.hex) return { cenotaph: false, hex: "" };

  const payload = getOpReturnPayload(opOut.scriptPubKey.hex);
  if (isBoxedError(payload)) return { cenotaph: true, hex: "" };

  return { cenotaph: false, hex: payload.data.toString("hex") };
}

export const decipher = (tx: Transaction): IMezcalstoneIndexed => {
  const opReturn = getOpReturnData(tx);
  if (opReturn.cenotaph) return { cenotaph: true };
  const { hex } = opReturn;

  if (hex.length < 2) return { cenotaph: false };

  let candidate: unknown;
  try {
    candidate = JSON.parse(Buffer.from(hex, "hex").toString("utf8"));
  } catch {
    return { cenotaph: true };
  }

  const parsed = MezcalstoneSchema.safeParse(candidate);
  if (!parsed.success) {
    return { cenotaph: true, issues: parsed.error.issues };
  }
  const mezcal = parsed.data;

  /* Validate edicts against tx shape */
  if (mezcal.edicts) {
    const voutLen = tx.vout.length;
    const badOutput = mezcal.edicts.some((e) => e.output > voutLen - 1);
    const badZeroMezcal = mezcal.edicts.some((e) => {
      const [blk, idx] = e.id.split(":").map(Number);
      return blk === 0 && idx !== 0;
    });
    if (badOutput || badZeroMezcal) return { cenotaph: true };
  }

  /* down-cast string amounts → bigint */
  const toBig = (obj: any): any =>
    Array.isArray(obj)
      ? obj.map(toBig)
      : obj && typeof obj === "object"
      ? Object.fromEntries(
          Object.entries(obj).map(([k, v]) => [
            k,
            AMOUNT_KEYS.has(k) && typeof v === "string" ? BigInt(v) : toBig(v),
          ])
        )
      : obj;

  return { ...toBig(mezcal), cenotaph: false };
};
