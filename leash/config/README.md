Only `mainnet-day1.hex` is an installable Config (the body the golden path, init_config + set_leg 0..7, leaves on chain).
`mainnet-init.hex` is the state after `leash-admin.ts init` (init_config + set_leg 0..7 with every leg OFF): every leg set and disabled. (Right after init_config alone the leg bytes are all zero, unset; no file holds that state.)
`TEST-VECTOR-all-legs-NEVER-INSTALL.hex` is an encoder test vector with leg 0 (SKR) ON; never install it while SKR has no price source (R324).
