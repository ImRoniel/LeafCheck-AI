# Strict export refused

Ran `node scripts/pincer-runtime.cjs evidence export --candidate b2868f81cd369565c4d0129eba455e9e6738589f --base c70f08d912446a0c75861f439d864b19a41ab351 --prd .prd/prd-v3.md --draft .pincer/drafts/b2868f81cd369565c4d0129eba455e9e6738589f.json`. Exit 1: REVIEW_MISSING for required C-06 (device/browser end-to-end review) and C-07 (screenshots/visual review), both explicitly unverified.

No manifest or evaluation locator was generated. The saved evaluation draft and command-log copies are partial review artifacts, not validated release evidence. C-10 also failed, so satisfying only the missing reviews will not establish readiness. Required checks and original scope remain intact.
