Only `mainnet-day1.hex` is an installable Config (the body the golden path, init_config + set_leg 0..7, leaves on chain).
`mainnet-init.hex` is the header-only state right after init_config: every leg unset and disabled.
`TEST-VECTOR-all-legs-NEVER-INSTALL.hex` is an encoder test vector with leg 0 (SKR) ON; never install it while SKR has no price source (R324).
