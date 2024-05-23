const { SpacedRune, Rune } = require( '@ordjs/runestone' );
const { replacer } = require( './src/lib/helpers' );
const tx = {
    output: [
    	{
	        "script_pubkey": "6a5d32160000c2a233b0028080c1dfc9b7b8040100008080c1dfc9b7b8040200008080c1dfc9b7b8040300008080c1dfc9b7b80404"
	    },
	    {
	        "script_pubkey": "00149c31f941dd74a2f38f1880f9f3d58d068018f999"
	    },
	    {
	        "script_pubkey": "00149c31f941dd74a2f38f1880f9f3d58d068018f999"
	    },
	    {
	        "script_pubkey": "00149c31f941dd74a2f38f1880f9f3d58d068018f999"
	    },
	    {
	        "script_pubkey": "00149c31f941dd74a2f38f1880f9f3d58d068018f999"
	    },
	    {
	        "script_pubkey": "00149c31f941dd74a2f38f1880f9f3d58d068018f999"
	    },
	    
	    {
	        "script_pubkey": "00149c31f941dd74a2f38f1880f9f3d58d068018f999"
	    }
	]
}
  

  const rune = Rune.fromString('DOGGOTOTHEMOON')
  const runestone = new SpacedRune(rune, 596);

  console.log(runestone)