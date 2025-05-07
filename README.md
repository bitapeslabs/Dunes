![dunes](https://github.com/user-attachments/assets/151acbc4-8668-43b8-aae7-131f3a5bed09)

# Dunes

Dunes is runes, but without the runestone decoder - instead leveraging the new op_return size limit so runestones (named dunestones on dunes), can be pushed to
bitcoin as a JSON file directly. This makes it MUCH easier for developers to work with, as the runestone decoder is notriously the most difficult part in reaching
the state of runes that ORD creates.

Furthermore, dunes adds the following changes:

- Any DUNES name is valid, as the name must contain only letters (A–Z, a–z), numbers (0–9), underscores \_, hyphens -, or periods . — and must be at least one character long, and less than 32 characters long. (names are case sensitive, so "Dunes" and "dunes" are NOT the same.)

- Because DUNE names are described as strings, the "spacer" field is completely omitted from the original runes protocol.

- DUNE names can only be used once! No two dunes can have the same name - just like Runes

- A symbol can still only be one character long.

- The original runes protocol specifies the following:

```
If an edict output is greater than the number of outputs of the transaction, an edict rune ID is encountered with block zero and nonzero transaction index, or a field is truncated, meaning a tag is encountered without a value, the decoded runestone is a cenotaph.

Note that if a cenotaph is produced here, the cenotaph is not empty, meaning that it contains the fields and edicts, which may include an etching and mint.
```

**NOTE: For simplicity, this has been removed.** This is checked before processing, and if a cenotaph is produced, the entire dunestone will be treated as a cenotaph. This means that the edicts, etching, and mint fields will be null.

# Schema

The following type definitions describe what a DUNESTONE should look like:

```ts
type DuneAmount = string; //must be passed as a string and be less than u128::MAX

type Edict = {
  id: string; // must be a string like "0:0"
  amount: DuneAmount; // must be a string
  output: number; // must be a number
};

type Terms = {
  amount: DuneAmount; // must be a string
  cap: DuneAmount; // must be a string
  height: [null | number, null | number]; // always [null, null]
  offset: [null | number, null | number]; // always [null, null]
};

type Mint = {
  block: number; // must be a number
  tx: number; // must be a number
};

type Etching = {
  divisibility: number; // must be a number
  premine: DuneAmount; // must be a string
  rune: string; // must be a string
  symbol: string; // must be a string (emoji etc.)
  terms: null | Terms; // nested strict object
};

type Dunestone = {
  edicts: null | Edict[]; // array of edict objects
  etching: null | Etching; // etching object
  mint: null | Mint; // mint object
  pointer: null | number; // must be a number
};
```

## Useful links

Original runes protocol: https://docs.ordinals.com/runes.html
