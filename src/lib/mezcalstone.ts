import { z } from "zod";
import { Transaction } from "@/lib/apis/bitcoinrpc/types";
/* ── 1. shared helpers ───────────────────────── */
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
  return v; // ❌ leave as‑is (string)
}, z.number().int().nonnegative().max(MAX_SATOSHI_EVER_IN_CIRCULATION));

const mezcalAmount = z.string().refine(
  (s) => {
    return isValidU128(s) && s !== "";
  },
  { message: "amount must be a decimal string within u128 range" }
);

const u32 = () => z.number().int().nonnegative().max(MAX_U32);
const u8 = () => z.number().int().nonnegative().max(MAX_U8);

/* ── 2. new PriceTerms schema ───────────────────────── */
export const PriceTermsSchema = z.object({
  amount: satoshi, // Max amount of satoshi there will ever be (accepts string for legacy bigint)
  pay_to: z.string().max(130, "pay_to address may be up to 130 chars"),
});

/* ── 3. existing schemas with additions/limits ───────── */
export const EdictSchema = z.object({
  id: z.string().regex(/^\d+:\d+$/, "id must look like “0:0”"),
  amount: mezcalAmount,
  output: u8(),
});

export const TermsSchema = z.object({
  price: PriceTermsSchema.optional(),
  amount: mezcalAmount,
  cap: mezcalAmount.optional().nullable(),
  height: z.tuple([u32().nullable(), u32().nullable()]),
  offset: z.tuple([u32().nullable(), u32().nullable()]),
});

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
  divisibility: z.number().int().nonnegative().max(18), //Avoid jeet precision
  premine: mezcalAmount,
  mezcal: z
    .string()
    .regex(/^[A-Za-z0-9_.-]{1,31}$/)
    .min(1)
    .max(31),
  symbol: z
    .string()
    .min(1)
    .refine((s) => [...s].length === 1, {
      message: "symbol must be exactly one visible character or emoji",
    }),
  terms: z.union([TermsSchema, z.null()]),
  turbo: z.boolean().default(true),
});

export const AMOUNT_KEYS = new Set(["amount", "cap", "premine"]);

export const MezcalstoneSchema = z
  .object({
    p: z.union([z.literal("mezcal"), z.literal("https://mezcal.sh")]),
    edicts: z.array(EdictSchema).optional(),
    etching: EtchingSchema.optional(),
    mint: MintSchema.optional(),
    pointer: u32().optional(),
  })
  .strict();

export type IPriceTerms = z.infer<typeof PriceTermsSchema>;
export type IEdict = z.infer<typeof EdictSchema>;
export type ITerms = z.infer<typeof TermsSchema>;
export type IMint = z.infer<typeof MintSchema>;
export type IEtching = z.infer<typeof EtchingSchema>;
export type IMezcalstoneFull = z.infer<typeof MezcalstoneSchema>;

export type IMezcalstone = Omit<IMezcalstoneFull, "p"> & { p?: string };

//Same as mezcalstone but all "mezcalAmount" are coerced to BigInt
type AmountKeys = "amount" | "cap" | "premine";

/** replace the *string* part of a union with bigint, keep the rest */
type ToBigint<U> = [Extract<U, string>] extends [never] // no string in the union
  ? U // leave as‑is
  : bigint | Exclude<U, string>; // swap the string part

type ToIndexed<T> = T extends (infer U)[] // recurse into arrays
  ? ToIndexed<U>[]
  : T extends object // recurse into objects
  ? {
      [K in keyof T]: K extends AmountKeys
        ? ToBigint<T[K]> // apply conversion to amount fields
        : ToIndexed<T[K]>; // recurse normally
    }
  : T;
export type IMezcalstoneIndexed = ToIndexed<IMezcalstone> & {
  cenotaph: boolean;
};

function getOpReturnData(tx: { vout: Array<Record<string, any>> }): {
  cenotaph: boolean;
  hex?: string;
} {
  const isOpReturn = (out: Record<string, any>): boolean => {
    return (
      out.scriptPubKey?.type === "nulldata" ||
      out.scriptPubKey?.asm?.startsWith("OP_RETURN") ||
      out.scriptpubkey_type === "op_return" ||
      out.scriptpubkey_asm?.startsWith("OP_RETURN")
    );
  };

  const opOut = tx.vout.find(isOpReturn);
  if (!opOut) return { cenotaph: false };

  const asmString: string | undefined =
    opOut.scriptPubKey?.asm ?? opOut.scriptpubkey_asm;

  let hex = "";
  if (asmString?.startsWith("OP_RETURN")) {
    const parts = asmString.split(" ");
    hex = parts[parts.length - 1] ?? "";
  }

  if (!hex) {
    const scriptHex: string | undefined =
      opOut.scriptPubKey?.hex ?? opOut.scriptpubkey;
    if (scriptHex?.startsWith("6a")) {
      hex = scriptHex.replace(
        /^6a(?:4c[0-9a-f]{2}|4d[0-9a-f]{4}|4e[0-9a-f]{8})?/i,
        ""
      );
    }
  }

  return hex ? { cenotaph: false, hex } : { cenotaph: false };
}

export const decipher = (tx: Transaction): IMezcalstoneIndexed => {
  let opReturn = getOpReturnData(tx);
  if (opReturn.cenotaph || !opReturn.hex) return { cenotaph: true };
  const hex = opReturn.hex;

  let candidate: unknown;
  try {
    candidate = JSON.parse(Buffer.from(hex, "hex").toString("utf8"));
  } catch {
    return { cenotaph: true };
  }

  const parsed = MezcalstoneSchema.safeParse(candidate);
  if (!parsed.success) return { cenotaph: true };
  const mezcal = parsed.data;

  if (mezcal.edicts) {
    const voutLen = tx.vout.length;
    const badOutput = mezcal.edicts.some((e) => e.output > voutLen - 1);
    const badZeroMezcal = mezcal.edicts.some((e) => {
      const [blk, idx] = e.id.split(":").map(Number);
      return blk === 0 && idx !== 0;
    });
    if (badOutput || badZeroMezcal) return { cenotaph: true };
  }

  const toBig = (obj: any): any => {
    if (Array.isArray(obj)) return obj.map(toBig);
    if (obj && typeof obj === "object") {
      return Object.fromEntries(
        Object.entries(obj).map(([k, v]) => [
          k,
          AMOUNT_KEYS.has(k) && typeof v === "string" ? BigInt(v) : toBig(v),
        ])
      );
    }
    return obj;
  };

  return { ...toBig(mezcal), cenotaph: false };
};
