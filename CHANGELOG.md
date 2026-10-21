# Changelog

All notable changes to this project will be documented in this file. See [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version) for commit guidelines.

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
