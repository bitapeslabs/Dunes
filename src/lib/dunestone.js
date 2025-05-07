const { z } = require("zod");

const MAX_U128 = (1n << 128n) - 1n;
const duneAmount = z.string().refine((s) => {
  try {
    const n = BigInt(s);
    return 0n <= n && n <= MAX_U128;
  } catch {
    return false;
  }
});

const EdictSchema = z.object({
  id: z.string().regex(/^\d+:\d+$/, "id must look like “0:0”"),
  amount: duneAmount,
  output: z.number().int().nonnegative(),
});

const TermsSchema = z.object({
  amount: duneAmount,
  cap: duneAmount,
  height: z.tuple([z.number().int().nullable(), z.number().int().nullable()]),
  offset: z.tuple([z.number().int().nullable(), z.number().int().nullable()]),
});

const MintSchema = z.object({
  block: z.number().int().nonnegative(),
  tx: z.number().int().nonnegative(),
});

const EtchingSchema = z.object({
  divisibility: z.number().int().nonnegative(),
  premine: duneAmount,
  rune: z
    .string()
    .regex(/^[A-Za-z0-9_.-]{1,31}$/, {
      message:
        "rune must be 1‑31 chars long and may contain only A‑Z, a‑z, 0‑9, _ , - , .",
    })
    .min(1)
    .max(32),
  symbol: z.string(),
  terms: z.union([TermsSchema, z.null()]),
  turbo: z.boolean().default(true),
});

const DunestoneSchema = z
  .object({
    edicts: z.array(EdictSchema).optional(),
    etching: EtchingSchema.optional(),
    mint: MintSchema.optional(),
    pointer: z.number().int().nonnegative().optional(),
  })
  .strict();

const AMOUNT_KEYS = new Set(["amount", "cap", "premine"]);

function decipher(tx) {
  const op = tx.vout.find(
    (v) =>
      v.scriptPubKey?.type === "nulldata" ||
      v.scriptPubKey?.asm?.startsWith("OP_RETURN")
  );

  if (!op) return { dunestone: {}, cenotaph: false };

  let hex = "";
  if (op.scriptPubKey.asm?.startsWith("OP_RETURN"))
    hex = op.scriptPubKey.asm.split(" ")[1] ?? "";
  else if (op.scriptPubKey.hex?.startsWith("6a"))
    hex = op.scriptPubKey.hex.replace(/^6a(?:4c[0-9a-f]{2})?/i, "");

  let candidate;
  try {
    candidate = JSON.parse(Buffer.from(hex, "hex").toString("utf8"));
  } catch {
    return { dunestone: {}, cenotaph: true };
  }

  const parsed = DunestoneSchema.safeParse(candidate);
  if (!parsed.success) return { dunestone: {}, cenotaph: true };
  const dune = parsed.data;

  if (dune.edicts) {
    const voutLen = tx.vout.length;
    const badOutput = dune.edicts.some((e) => e.output > voutLen - 1);
    const badZeroRune = dune.edicts.some((e) => {
      const [blk, idx] = e.id.split(":").map(Number);
      return blk === 0 && idx !== 0;
    });
    if (badOutput || badZeroRune) return { dunestone: {}, cenotaph: true };
  }

  const toBig = (obj) => {
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
  return { ...toBig(dune), cenotaph: false };
}

module.exports = { decipher };
