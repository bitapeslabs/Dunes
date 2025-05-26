import * as bitcoin from "bitcoinjs-lib";
import { BoxedResponse, BoxedSuccess, BoxedError } from "@/lib/boxed";
import { IEsploraTransaction } from "@/lib/apis/esplora/types";
import { Transaction as BitcoinJsTransaction } from "bitcoinjs-lib";

export enum ScriptParseError {
  NotOpReturn = "ScriptIsNotOpReturn",
  NoPayload = "NoPushdataAfterOpReturn",
  InvalidHex = "InvalidHex",
}

export function getOpReturnPayload(
  scriptHex: string
): BoxedResponse<Buffer, ScriptParseError> {
  let raw: Buffer;

  try {
    raw = Buffer.from(scriptHex, "hex");
  } catch {
    return new BoxedError(ScriptParseError.InvalidHex, "Bad hex string");
  }

  const ops = bitcoin.script.decompile(raw);
  if (!ops || ops.length === 0 || ops[0] !== bitcoin.opcodes.OP_RETURN) {
    return new BoxedError(
      ScriptParseError.NotOpReturn,
      "Script does not start with OP_RETURN"
    );
  }

  const payloadChunks = ops
    .slice(1)
    .filter((op): op is Buffer => Buffer.isBuffer(op));

  if (payloadChunks.length === 0) {
    return new BoxedError(
      ScriptParseError.NoPayload,
      "OP_RETURN has no push-data payload"
    );
  }

  const payload = Buffer.concat(payloadChunks);
  return new BoxedSuccess(payload);
}

export const esploraTransactionToHex = (tx: IEsploraTransaction): string => {
  const transaction = new BitcoinJsTransaction();

  transaction.version = tx.version;
  transaction.locktime = tx.locktime;

  tx.vin.forEach((input) => {
    if (input.is_coinbase) {
      transaction.addInput(
        Buffer.alloc(32),
        0xffffffff,
        input.sequence,
        Buffer.from(input.scriptsig, "hex")
      );
      return;
    }

    const txidBuffer = Buffer.from(input.txid, "hex").reverse();
    const scriptSigBuffer = Buffer.from(input.scriptsig, "hex");

    const vinIndex = transaction.addInput(
      txidBuffer,
      input.vout,
      input.sequence,
      Buffer.from(input.scriptsig, "hex")
    );

    transaction.ins[vinIndex].script = scriptSigBuffer;
  });

  tx.vout.forEach((output) => {
    const scriptPubKeyBuffer = Buffer.from(output.scriptpubkey, "hex");
    transaction.addOutput(scriptPubKeyBuffer, output.value);
  });

  return transaction.toHex();
};
