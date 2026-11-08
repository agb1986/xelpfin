# Changelog

All notable changes to this project will be documented in this file. See [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version) for commit guidelines.

## [0.4.0](https://github.com/agb1986/xelpfin/compare/v0.3.0...v0.4.0) (2026-11-08)

### Features

* **backend:** add library sorts, filters and filter value lookups ([f3ee154](https://github.com/agb1986/xelpfin/commit/f3ee1546d676386d18abf6f8a59dc5d86164885a)), references [#24](https://github.com/agb1986/xelpfin/issues/24)
* **backend:** read trickplay sheet layout for seek previews ([6d56a4c](https://github.com/agb1986/xelpfin/commit/6d56a4cccde47b16fb7aa4c3211787251873ff7f))
* **player:** offer the next episode in a countdown card with Cancel ([833ec83](https://github.com/agb1986/xelpfin/commit/833ec8310123efe0b9d28f35f2fbacd6efa94625)), closes [#27](https://github.com/agb1986/xelpfin/issues/27)
* **player:** show trickplay or chapter thumbnail while seeking ([a3bd557](https://github.com/agb1986/xelpfin/commit/a3bd557e60981b01af63c515736b16cebc01436e))
* **ui:** add library filter panel and remember each library's view ([66ae4f7](https://github.com/agb1986/xelpfin/commit/66ae4f7e1d25fb296be5a3f3c3ba95b977c6dd9e)), references [#24](https://github.com/agb1986/xelpfin/issues/24)
* **vega:** add W3C media player engine ([ea7e9e7](https://github.com/agb1986/xelpfin/commit/ea7e9e794276a2126bb8909fb48333e7f8332702))
* **vega:** query the stick's decoders for the device profile ([b7bcecf](https://github.com/agb1986/xelpfin/commit/b7bcecf90b206afc73d8a0ae10a398e8cea8ede2))
* **vega:** show a splash screen until the app is ready ([cc46461](https://github.com/agb1986/xelpfin/commit/cc46461653ebfbd65d8145d5ab57d590f5fa7fe9))
* **vega:** use the real Jellyfin connector with manual server entry ([c484a36](https://github.com/agb1986/xelpfin/commit/c484a364891edb4f2ef085e05eaca67030a5cb99))

### Bug Fixes

* **player:** crop seek preview thumbnails correctly on Android ([7db6ab6](https://github.com/agb1986/xelpfin/commit/7db6ab6bed33d6ea7840d7c1e410235ddd01bb9f))
* **player:** go back when the next-episode card is cancelled after the end ([6cf4581](https://github.com/agb1986/xelpfin/commit/6cf4581c2b274a8e1ca1b7b70ec158a2440e35f5))
* **player:** keep handing focus to the surface until it lands ([33cbef2](https://github.com/agb1986/xelpfin/commit/33cbef2b8296035409d0718de924dba0293528b3)), closes [#71](https://github.com/agb1986/xelpfin/issues/71)
* **player:** retry with MPEG-TS segments when the fMP4 stream cannot be parsed ([7c8b0c9](https://github.com/agb1986/xelpfin/commit/7c8b0c9debf099a413014da329e738d4c1aaf57f))
* **player:** stop calling a stream parse crash a network failure ([8277863](https://github.com/agb1986/xelpfin/commit/8277863e2bd1f92f348c5a06838357dc0e2b118c))
* **ui:** key history rows by position and episode id ([bb433c8](https://github.com/agb1986/xelpfin/commit/bb433c84120ccae62a94ce8ff5def0df03912659))
* **ui:** stop the search field taking focus back on return to the screen ([185438f](https://github.com/agb1986/xelpfin/commit/185438f5584684583276e393490d83455ce5616d))
* **vega:** append HLS segments in sequence mode to stop boundary stutter ([b33427b](https://github.com/agb1986/xelpfin/commit/b33427bda1338a093a02d43dfc786c2d73466fc4))
* **vega:** open the keyboard only on SELECT, not on D-pad focus ([d3f0d07](https://github.com/agb1986/xelpfin/commit/d3f0d07fd50641aff2052ecb342f1e1697d4db21))
* **vega:** pin media packages to the versions the stick ships ([640e85a](https://github.com/agb1986/xelpfin/commit/640e85abf4a8298c39f647230e35669de2de3c6f))
* **vega:** stream over HLS when the server is plain http ([427336d](https://github.com/agb1986/xelpfin/commit/427336d0f698c1e1685ff3a22ef63b4147aa6e63))

## [0.3.0](https://github.com/agb1986/xelpfin/compare/v0.2.0...v0.3.0) (2026-10-25)

### Features

* **player:** match display refresh rate to content frame rate ([2eccb42](https://github.com/agb1986/xelpfin/commit/2eccb42d12539cf3e43e2ba7c7bb0174b7f0e361)), references [#13](https://github.com/agb1986/xelpfin/issues/13)
* **ui:** jump by letter in the language pickers ([939edf7](https://github.com/agb1986/xelpfin/commit/939edf772bf9f390c8cd01250cd1ce043e9ae70e)), closes [#64](https://github.com/agb1986/xelpfin/issues/64)

## [0.2.0](https://github.com/agb1986/xelpfin/compare/v0.1.3...v0.2.0) (2026-10-24)

### Features

* **backend:** trust self-signed server certificates on first use ([d8b0aec](https://github.com/agb1986/xelpfin/commit/d8b0aece4f4641da6be9cd500188672f623689d5)), closes [#21](https://github.com/agb1986/xelpfin/issues/21)
* **player:** modernise the device profile (fMP4 HLS, AV1, VP9, HDR, passthrough, remux) ([1ccba9d](https://github.com/agb1986/xelpfin/commit/1ccba9d10f7a6340b9a241fcd5a2df0f11de8e82))
* **settings:** offer every ISO 639-2 language and a subtitle language ([d213f0b](https://github.com/agb1986/xelpfin/commit/d213f0b446c4fb8d6cc2b2db121842dae404cd19))

### Bug Fixes

* **player:** map react-native-video error codes instead of parsing messages ([26462bd](https://github.com/agb1986/xelpfin/commit/26462bda47e945179a3ebebd0c93d0b675eb5495))
* **ui:** dedupe Focusable presses by event source, not by time window ([a541616](https://github.com/agb1986/xelpfin/commit/a541616a0c402f0817677bbd490edd69a3b0b327))

## [0.1.3](https://github.com/agb1986/xelpfin/compare/v0.1.2...v0.1.3) (2026-10-21)

### Features

* **backend:** retry idempotent requests and honour ETags ([c6de6e6](https://github.com/agb1986/xelpfin/commit/c6de6e6b1d8ae5bfe7de862b181a9c8d5c5e741e))

### Bug Fixes

* **player:** send the access token as a header instead of api_key in stream URLs ([7df9e87](https://github.com/agb1986/xelpfin/commit/7df9e87ec620a314c4927fd924f012c89ad20a5c))
* **ui:** cap navigation stack depth to bound memory ([662aa71](https://github.com/agb1986/xelpfin/commit/662aa7184d47df28d0a3e215992b69dd7b2fa06e))

## [0.1.2](https://github.com/agb1986/xelpfin/compare/v0.1.1...v0.1.2) (2026-10-18)

### Bug Fixes

* **backend:** harden request headers, timeouts and image addresses ([6f8a5b4](https://github.com/agb1986/xelpfin/commit/6f8a5b45ca5305e1dfa9916b052acbaef2c0cef1))
* cap the number of discovery replies the app collects ([bab3ab3](https://github.com/agb1986/xelpfin/commit/bab3ab35f9b55691a0bd2139087b80c301c9b228))
* keep saved server addresses when discovery replies disagree ([6b3d75b](https://github.com/agb1986/xelpfin/commit/6b3d75b641276e995d684b43bbf28a1937c059d0))
* limit parallel server requests and ignore repeated random-play presses ([6232bea](https://github.com/agb1986/xelpfin/commit/6232bea25afbdb0aae762800ec59c45a7c656173))
* **player:** only send the access token to the signed-in server ([cdf4291](https://github.com/agb1986/xelpfin/commit/cdf42910b31a2fc952e4ba63a76469acc062d7f4))
* report the real app version and keep it in step with releases ([3be4421](https://github.com/agb1986/xelpfin/commit/3be4421474376de7a54c103bb2a0e5af51e39c04))
* stop losing randomizer and hidden Next Up lists after a bad read ([029ecbb](https://github.com/agb1986/xelpfin/commit/029ecbb539561704fbc9e64b229e038b21f8cfb4))
* stop Quick Connect polls piling up and give up when the code expires ([f6b8786](https://github.com/agb1986/xelpfin/commit/f6b878659b948d45c8e43bd66df05479bc443d2a))
* stop treating HTTP 403 as an expired sign-in ([6094fab](https://github.com/agb1986/xelpfin/commit/6094fabb448e29cd3cadbec9253274a5eb207e02))
* **ui:** stop showing server response text in error messages ([4bbb9d3](https://github.com/agb1986/xelpfin/commit/4bbb9d3d04cf4f11839c268e5c95c36b51b0d8b6))

## [0.1.1](https://github.com/agb1986/xelpfin/compare/v0.1.0...v0.1.1) (2026-10-18)

### Features

* add a Randomizer history screen to Settings ([50fd4e1](https://github.com/agb1986/xelpfin/commit/50fd4e13d5d3b7f8875c34ac7384731c6674a3b3))
* **player:** skip intros, recaps, credits and previews in Randomizer ([0652537](https://github.com/agb1986/xelpfin/commit/06525377cf49891dd3cacab2539d40102d0c4d83))

### Bug Fixes

* **ui:** list the films inside a collection ([deff23e](https://github.com/agb1986/xelpfin/commit/deff23e1ac7bb8b63d8727ab4e054f6b83030537))
