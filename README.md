![dunes](https://github.com/user-attachments/assets/151acbc4-8668-43b8-aae7-131f3a5bed09)

# Dunes

**Want to interact with Dunes? Use the CLI!**

To install:

```bash
npm i -g dunes-cli
dunes-cli --help
```

**More information on the commands you can use can be found here:** https://github.com/bitapeslabs/dunes-cli

**Dunes explorer:** https://dunes.sh

## What is Dunes?

Dunes is runes, but without the runestone decoder - instead leveraging the new op_return size limit so dunestones (named dunestones on dunes), can be pushed to
bitcoin as a JSON file directly. This makes it MUCH easier for developers to work with, as the runestone decoder is notriously the most difficult part in reaching
the state of runes that the ORD client creates nad the highest barrier to entry for runes.

**Furthermore, dunes implements the following changes**:

- Dunestones are pushed directly after the OP_RETURN. This means "OP_13" isnt pushed before the dunestone like on runes. A dunestone OP_RETURN looks like this:
  OP_RETURN utf8-encoded-dunestone-string-hex

- Dunes does not require commitments to etch. This means dunes, unlike runes, does not require any copy of the witness layer! Dunes works with any pre-segwit
  wallet and chain.

- Any DUNES name is valid, as long as the name contains only letters (A–Z, a–z), numbers (0–9), underscores \_, hyphens -, or periods . — and must be at least one character long, and less than 32 characters long. (names are case sensitive, so "Duni" and "duni" are NOT the same.)

- Because DUNE names are described as strings, the "spacer" field from the original runes protocol is completely omitted.

- DUNE names can only be used once! No two dunes can have the same name - just like runes.

- Implements priced mints, originally proposed here: https://github.com/ordinals/ord/issues/3794 and further iterated here to take advantage of the new OP_RETURN size limit. See "priced mints" below for more information.

- Inclusion of the "p" field, which has to be the literal "dunes" or the dunes website "https://dunes.sh". This is so external users can see a dunestone in an explorer
  and learn more about the protocol. Including the domain is not required (can just be "dunes"), but it is recommended.

- The original dunes protocol specifies the following:

```
If an edict output is greater than the number of outputs of the transaction, an edict rune ID is encountered with block zero and nonzero transaction index, or a field is truncated, meaning a tag is encountered without a value, the decoded runestone is a cenotaph.

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
      "cap": 1000000,
      "height": [0, null],
      "offset": [null, null],
      "price": {
        "amount": 21000,
        "pay_to": "bc1qvn6ecmzd42ksa252tntu9yw358yhujcznq9zxs"
      }
    }
  }
}
```

Each duni mint costs **21000 satoshis**, or roughly 20.29 USD (0.20 USD per duni) at the time of writing.

# Dunestone schema

The following type definitions describe what a DUNESTONE should look like:

```ts
type DuneAmount = string; //must be passed as a string and be less than u128::MAX

type Edict = {
  id: string; // must be a string like "0:0"
  amount: DuneAmount; // must be a string
  output: number; // must be a number, max: u8
};

type Terms = {
  price?: PriceTerms; //optional
  amount: DuneAmount; //required if terms are included or cenotaph
  cap: DuneAmount; //required if terms are included or cenotaph
  height: [null | number, null | number]; //max: u32, required if terms are included or cenotaph
  offset: [null | number, null | number]; //max: u32, required if terms are included or cenotaph
};

type Mint = string; //must be a string in the format of u32(block):u32(tx)

type PriceTerms = {
  amount: DuneAmount; //required if priceterms are included or cenotaph
  pay_to: string; //required if priceterms are included or cenotaph. Maxmium length: 130 characters
};

type Etching = {
  divisibility: number; //max: u8, required or cenotaph
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
  pointer?: number; //max: u32, optional
};
```

## What are priced mints?

Price is a u128 integer expressed in Satoshi. During an etch, IF the price field is present the following would be added as a requirement:

```
all mints must include a cumulative amount of etching.terms.price satoshi sent in the tx's vouts to the etching.terms.pay_to address specified in a dune's etching terms.

IF price terms are not met, the mint is invalid.
```

If no price field is provided in a dune's etching, all functionality above is ignored.

**Rationale:** This allows decentralized IDOs (initital dune offerings) to take place, without the need of a custodian.

## Credits

Original runes protocol: https://docs.ordinals.com/runes.html
