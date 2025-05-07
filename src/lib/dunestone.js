const { z } = require("zod");

/* ── 1. shared helpers ───────────────────────────────────── */
const MAX_U128 = (1n << 128n) - 1n; // 2**128‑1
const MAX_U32 = 0xffff_ffff; // 4 294 967 295
const MAX_U8 = 0xff; // 255

const duneAmount = z.string().refine(
  (s) => {
    try {
      const n = BigInt(s);
      return 0n <= n && n <= MAX_U128;
    } catch {
      return false;
    }
  },
  { message: "amount must be a decimal string within u128 range" }
);

const u32 = () => z.number().int().nonnegative().max(MAX_U32);
const u8 = () => z.number().int().nonnegative().max(MAX_U8);

/* ── 2. schemas with new limits ─────────────────────────── */
const EdictSchema = z.object({
  id: z.string().regex(/^\d+:\d+$/, "id must look like “0:0”"),
  amount: duneAmount,
  output: u8(), // ← max u8
});

const TermsSchema = z.object({
  amount: duneAmount,
  cap: duneAmount,
  height: z.tuple([u32().nullable(), u32().nullable()]), // ← u32 each
  offset: z.tuple([u32().nullable(), u32().nullable()]), // ← u32 each
});

const MintSchema = z.object({
  block: u32(), // ← u32
  tx: u32(), // ← u32
});

const EtchingSchema = z.object({
  divisibility: u8(), // ← u8
  premine: duneAmount,
  dune: z
    .string()
    .regex(/^[A-Za-z0-9_.-]{1,31}$/)
    .min(1)
    .max(31),
  symbol: z.string(),
  terms: z.union([TermsSchema, z.null()]),
  turbo: z.boolean().default(true),
});

const DunestoneSchema = z
  .object({
    edicts: z.array(EdictSchema).optional(),
    etching: EtchingSchema.optional(),
    mint: MintSchema.optional(),
    pointer: u32().optional(), // ← u32
  })
  .strict();

/* ── 3. keys that hold DuneAmounts ───────────────────────── */
const AMOUNT_KEYS = new Set(["amount", "cap", "premine"]);

/* ── 4. main function ───────────────────────────────────── */
function decipher(tx) {
  /* find OP_RETURN */
  const op = tx.vout.find(
    (v) =>
      v.scriptPubKey?.type === "nulldata" ||
      v.scriptPubKey?.asm?.startsWith("OP_RETURN")
  );
  if (!op) return { dunestone: {}, cenotaph: false };

  /* payload hex extraction */
  let hex = "";
  if (op.scriptPubKey.asm?.startsWith("OP_RETURN"))
    hex = op.scriptPubKey.asm.split(" ")[1] ?? "";
  else if (op.scriptPubKey.hex?.startsWith("6a"))
    hex = op.scriptPubKey.hex.replace(/^6a(?:4c[0-9a-f]{2})?/i, "");

  /* decode + parse */
  let candidate;
  try {
    candidate = JSON.parse(Buffer.from(hex, "hex").toString("utf8"));
  } catch {
    return { dunestone: {}, cenotaph: true };
  }

  /* schema validation */
  const parsed = DunestoneSchema.safeParse(candidate);
  if (!parsed.success) return { dunestone: {}, cenotaph: true };
  const dune = parsed.data;

  /* extra cenotaph rules */
  if (dune.edicts) {
    const voutLen = tx.vout.length;
    const badOutput = dune.edicts.some((e) => e.output > voutLen - 1);
    const badZeroDune = dune.edicts.some((e) => {
      const [blk, idx] = e.id.split(":").map(Number);
      return blk === 0 && idx !== 0;
    });
    if (badOutput || badZeroDune) return { dunestone: {}, cenotaph: true };
  }

  /* DuneAmount → BigInt conversion */
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
