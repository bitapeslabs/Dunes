![dunes](https://github.com/user-attachments/assets/151acbc4-8668-43b8-aae7-131f3a5bed09)

# Dunes

## Useful links

**Explorer:** https://dunes.sh

Want to interact with Dunes? Try using the cli:
**CLI:** https://github.com/bitapeslabs/dunes-cli

## What is Dunes?

Dunes is runes, but without the runestone decoder - instead leveraging the new op_return size limit so dunestones (named dunestones on dunes), can be pushed to
bitcoin as a JSON file directly. This makes it MUCH easier for developers to work with, as the runestone decoder is notriously the most difficult part in reaching
the state of runes that the ORD client creates nad the highest barrier to entry for runes.

**Furthermore, dunes implements the following changes**:

- Dunestones are pushed directly after the OP_RETURN. This means "OP_13 isnt pushed before the dunestone like on runes. A dunestone OP_RETURN looks like this:
  OP_RETURN utf8-encoded-dunestone-string-hex

- Dunes does not require commitments to etch. This means dunes, unlike runes, does not require any copy of the witness layer! Dunes works with any pre-segwit
  wallet and chain.

- Any DUNES name is valid, as long as the name contains only letters (A–Z, a–z), numbers (0–9), underscores \_, hyphens -, or periods . — and must be at least one character long, and less than 32 characters long. (names are case sensitive, so "Duni" and "duni" are NOT the same.)

- Because DUNE names are described as strings, the "spacer" field from the original runes protocol is completely omitted.

- DUNE names can only be used once! No two dunes can have the same name - just like runes.

- The original dunes protocol specifies the following:

```
If an edict output is greater than the number of outputs of the transaction, an edict dune ID is encountered with block zero and nonzero transaction index, or a field is truncated, meaning a tag is encountered without a value, the decoded dunestone is a cenotaph.

Note that if a cenotaph is produced here, the cenotaph is not empty, meaning that it contains the fields and edicts, which may include an etching and mint.
```

**NOTE: For simplicity, this has been removed.** This is checked before processing, and if a cenotaph is produced, the entire dunestone will be treated as a cenotaph. This means that the edicts, etching, and mint fields will be null.

# A new genesis dunestone

"duni" is the genesis dune of Dunes. The following etching looks as follows:

```json
{
  "etching": {
    "dune": "duni",
    "symbol": "🌵",
    "turbo": true,
    "terms": {
      "amount": 100,
      "cap": 100000,
      "height": [0, null],
      "offset": [null, null]
    }
  }
}
```

# Dunestone schema

The following type definitions describe what a DUNESTONE should look like:

```ts
type DuneAmount = string; //must be passed as a string and be less than u128::MAX

type Edict = {
  id: string; // must be a string like "0:0"
  amount: DuneAmount; // must be a string
  output: number; // must be a number
};

type Terms = {
  amount: DuneAmount; //required if terms are included or cenotaph
  cap: DuneAmount; //required if terms are included or cenotaph
  height: [null | number, null | number]; //required if terms are included or cenotaph
  offset: [null | number, null | number]; //required if terms are included or cenotaph
};

type Mint = {
  block: number; //required if mint is included or cenotaph
  tx: number; //required if mint is included or cenotaph
};

type Etching = {
  divisibility: number; ///required or cenotaph
  premine: DuneAmount; //required or cenotaph
  dune: string; //required or cenotaph
  symbol: string; //required or cenotaph
  terms: null | Terms;
  turbo: boolean; // if not included, defaults to TRUE
};

type Dunestone = {
  edicts?: Edict[]; //optional
  etching?: Etching; //optional
  mint?: Mint; //optional
  pointer?: number; //optional
};
```

## Useful links

Original dunes protocol: https://docs.ordinals.com/dunes.html
