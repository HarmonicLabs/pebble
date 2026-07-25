# Contrubute to the ```plu-ts``` development

Hey there beautiful soul!

If you got here is probably because you want to help building the awesome tool which ```plu-ts``` is thanks to people like you!

Here you find some guidelines that will help you get the best the community has to offer when contributing.

> **_note:_** if you found something that doesn't convinces you or want to propose some new contribution guideline feel free to propose changes to this document in a pull request.

<a name="table_of_contents"></a>

## Table of contents

- [Code of Conduct](#code_of_conduct)
- [I just have a question 😅](#question)
- [Before you get started](#before_get_started)
    - [best practices](#best_practices)
    - [code style guide](#style_guide)
    - [dependency audits](#dep_audits)
- [What can I do to contribute?]
    - [Report Bugs](#)
    - [Suggest Enhancements](#)
    - [Your First Code Contribution](#)
    - [Pull Requests](#)


<a name="code_of_conduct"></a>

## Code of Conduct

This project and everyone participating in it is governed by the [plu-ts Code of Conduct](./CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code. Please report unacceptable behavior to [harmonic.pool@protonmail.com](mailto:harmonic.pool@protonmail.com).

<a name="question"></a>

## I just have a question 😅

Consider to open an issue or propose a pull request only if you: 

- found a bug
- want to propose a new feature
- think something can be improved

for everything else consider using the [Cardano stack exchange](https://cardano.stackexchange.com/) using the ```plu-ts``` tag 
alongside other tags relevant to your question (e.g. ```on-chain```, ```off-chain```, ```smart-contract```, etc. )

Also be sure you had a look at the [plu-ts documentation](./docs) before asking any question, since it is possible your answer is somewhere in ther

<a name="before_get_started"></a>

## Before you get started

Before you start contributing to ```plu-ts``` consider having a look at the [best practices](#best_practices) and the [code style guide](#style_guide) adopted in ```plu-ts```

<a name="best_practices"></a>

### best practices

<a name="dep_audits"></a>

### dependency audits

`npm install` currently prints a banner about ~19 *high severity* advisories.
**They do not affect anything we publish.** Every one of them comes from a
single root cause inside jest's own dependency chain
(`brace-expansion` → `minimatch` → `glob` → `test-exclude` / `@jest/reporters`
/ `babel-plugin-istanbul`), all of it `devDependencies`. We publish `dist`
only, so none of it reaches users.

Audit what actually ships:

```bash
npm run audit    # npm audit --omit=dev  ->  found 0 vulnerabilities
```

**Never run `npm audit fix --force` in this repo.** Two traps:

- npm's proposed "fix" is `jest@19.0.2` (a 2017 release). Forcing it swaps
  jest between majors — 30 → 25 → 30 — and the same advisory reappears from
  whichever tree it lands in, so it never converges. All it achieves is
  lockfile churn.
- Do not add an `overrides` entry for `brace-expansion@^5` either. Version 5
  changed its CommonJS export from a bare function to `{ expand }`, while
  `minimatch` still calls it as a function — forcing it breaks the whole test
  runner with `expand is not a function`. Only `minimatch@10.2.5+` is built
  for the new API, and `test-exclude@6` still requires `minimatch@3`, so the
  chain can only be resolved upstream by jest.

If the banner bothers you in CI, gate on `npm run audit` instead of
`npm audit`.
