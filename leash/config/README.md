Only `mainnet-day1.hex` is an installable Config (the body the golden path, init_config + set_leg 0..7, leaves on chain).
`mainnet-init.hex` is the state after `leash-admin.ts init` (init_config + set_leg 0..7 with every leg OFF): every leg set and disabled. (Right after init_config alone the leg bytes are all zero, unset; no file holds that state.)
`TEST-VECTOR-all-legs-NEVER-INSTALL.hex` is an encoder test vector with leg 0 (SKR) ON; never install it (R324: SKR has no price source). If SKR ever gets one, its Config is a new golden file, not this vector.
Every file pins the sponsored Pyth account on the priced legs (feed_account: leg 1 ORE, legs 4-6 SOL, leg 7 cbBTC; final review I1); legs 0, 2, 3 keep zero.
