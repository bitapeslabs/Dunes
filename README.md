![githubbanner](https://github.com/user-attachments/assets/4fce5c83-47ef-451d-9de8-534e93809dfb)

# mezcal

**Want to interact with Mezcal? Use the CLI!**

To install:

```bash
npm i -g mezcal-cli
mezcal-cli --help
```

**More information on the commands you can use can be found here:** https://github.com/bitapeslabs/mezcal-cli

**Mezcal explorer:** https://mezcal.sh

## What is Mezcal?

Mezcal is runes, but without the runestone decoder - instead leveraging the new op_return size limit so runestones (named mezcalstones on mezcal), can be pushed to
bitcoin as a JSON file directly. This makes it MUCH easier for developers to work with, as the runestone decoder is notriously the most difficult part in reaching
the state of runes that the ORD client creates nad the highest barrier to entry for runes.

**Furthermore, mezcals implements the following changes**:

- Mezcalstones are pushed directly after the OP_RETURN. This means "OP_13" isnt pushed before the mezcalstone like on runes. A mezcalstone OP_RETURN looks like this:
  OP_RETURN utf8-encoded-mezcalstone-string-hex

- Mezcal does not require commitments to etch. This means mezcal, unlike runes, does not require any copy of the witness layer! Mezcals works with any pre-segwit
  wallet and chain.

- Any Mezcal name is valid, as long as the name contains only letters (A–Z, a–z), numbers (0–9), underscores \_, hyphens -, or periods . — and must be at least one character long, and less than 32 characters long. (names are case sensitive, so "Duni" and "duni" are NOT the same.)

- Because Mezcal names are described as strings, the "spacer" field from the original runes protocol is completely omitted.

- Mezcal names can only be used once! No two mezcals can have the same name - just like runes.

- Implements priced mints, originally proposed here: https://github.com/ordinals/ord/issues/3794 and further iterated here to take advantage of the new OP_RETURN size limit. See "priced mints" below for more information.

- Inclusion of the "p" field, which has to be the literal "mezcal" or the mezcal website "https://mezcal.sh". This is so external users can see a mezcalstone in an explorer
  and learn more about the protocol. Including the domain is not required (can just be "mezcals"), but it is recommended.

- The original mezcals protocol specifies the following:

```
If an edict output is greater than the number of outputs of the transaction, an edict rune ID is encountered with block zero and nonzero transaction index, or a field is truncated, meaning a tag is encountered without a value, the decoded runestone is a cenotaph.

Note that if a cenotaph is produced here, the cenotaph is not empty, meaning that it contains the fields and edicts, which may include an etching and mint.
```

**NOTE: For simplicity, this has been removed.** This is checked before processing, and if a cenotaph is produced, the entire mezcalstone will be treated as a cenotaph. This means that the edicts, etching, and mint fields will be null.

**TIP:** For a comprehensive overview of a mezcalstone's validation, please see https://github.com/bitapeslabs/mezcal/blob/main/src/lib/mezcalstone.ts .

Even though protocol messages are raw json strings, the validator the indexer uses is strict in the size and types of values provided in a mezcalstone. This is to protect the determenistic nature of the indexer aswell as so in future planned rewrites of mezcal, we can allow for sized protocol messages. As a developer it is recommended to familiarize yourself with these constraints before using Mezcal.

# A new genesis mezcalstone

"cactusseed" is the genesis etching of Mezcal. The following etching looks as follows (cap and amount are described as bigints >U128::MAX):

```json
{
  "etching": {
    "mezcal": "taco",
    "symbol": "🌮",
    "turbo": true,
    "terms": {
      "amount": "100",
      "cap": "25000",
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

Each taco mint costs **21000 satoshis**, or roughly 20.29 USD (0.20 USD per cactusseed) at the time of writing.

# Mezcalstone schema

The following type definitions describe what a MEZCALTONE should look like:

```ts
type MezcalAmount = string; //must be passed as a string and be less than u128::MAX

type Edict = {
  id: string; // must be a string like "0:0"
  amount: MezcalAmount; // must be a string
  output: number; // must be a number, max: u8
};

type Terms = {
  price?: PriceTerms; //optional
  amount: MezcalAmount; //required if terms are included or cenotaph
  cap: MezcalAmount; //required if terms are included or cenotaph
  height: [null | number, null | number]; //max: u32, required if terms are included or cenotaph
  offset: [null | number, null | number]; //max: u32, required if terms are included or cenotaph
};

type Mint = string; //must be a string in the format of u32(block):u32(tx)

type PriceTerms = {
  amount: MezcalAmount; //required if priceterms are included or cenotaph
  pay_to: string; //required if priceterms are included or cenotaph. Maxmium length: 130 characters
};

type Etching = {
  divisibility: number; //max: u8, required or cenotaph
  premine: MezcalAmount; //required or cenotaph
  mezcal: string; //required or cenotaph
  symbol: string; //required or cenotaph
  terms: null | Terms;
  turbo: boolean; // if not included, defaults to TRUE
};

type Mezcalstone = {
  edicts?: Edict[]; //optional
  etching?: Etching; //optional
  mint?: Mint; //optional
  pointer?: number; //max: u32, optional
};
```

## What are priced mints?

TLDR: Priced mints are an optional setting to make all mints of a mezcal enforce a payment of bitcoin to a specific address in order for the mint to be valid.

Price is a u128 integer expressed in Satoshi. During an etch, IF the price field is present the following would be added as a requirement:

```
all mints must include a cumulative amount of etching.terms.price satoshi sent in the tx's vouts to the etching.terms.pay_to address specified in a mezcal's etching terms.

IF price terms are not met, the mint is invalid.
```

If no price field is provided in a mezcal's etching, all functionality above is ignored.

**Rationale:** This allows decentralized IMOs (initital mezcal offerings) to take place, without the need of a custodian.

## What are flexible mints?

If price terms are defined, and the amount per mint is set to 0, the Dune automatically enables "flex mint" mode.
Essentially, when flex mint mode is enabled - the amount minted will be Math.floor(amount set to pay_to address / price). This was specifically added to enable decentralized wrapping of bitcoin into a dune (unwrapping would need to be custodian)

In the following etch:

```json
{
  "p": "https://dunes.sh",
  "etching": {
    "divisibility": 8,
    "premine": "0",
    "dune": "WBTC",
    "symbol": "₿",
    "terms": {
      "price": {
        "amount": "1",
        "pay_to": "bcrt1pxya87gu5jnde0x72hp2l84tur62jl7yhkwnf7yc2hwgk2rnx9t2q6natl2"
      },
      "amount": "0",
      "height": [0, null],
      "offset": [null, null]
    },
    "turbo": true
  }
}
```

The price per "wbtc" is set to 1, with the same divisibility as bitcoin (precision of 8). That means for every satoshi the user sends to the pay_to address, they will mint 0.00000001 WBTC

## Credits

Original runes protocol: https://docs.ordinals.com/runes.html
