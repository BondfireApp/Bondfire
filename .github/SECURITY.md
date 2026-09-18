# Security Policy

## Supported version

Security fixes are currently maintained for the latest Bondfire V3 release and the current `main` branch.

Older releases may not receive security fixes.

## Reporting a vulnerability

Please do not report security vulnerabilities in public GitHub issues, discussions, social media, or other public channels.

Use GitHub's private vulnerability reporting for this repository:

https://github.com/BondfireApp/Bondfire/security/advisories/new

Include, where possible:

- a description of the vulnerability
- affected Bondfire version or commit
- reproduction steps
- expected and observed behavior
- potential security impact
- any suggested mitigation or fix

Do not include real user data, private organization data, credentials, recovery material, encryption keys, or other sensitive information unless specifically requested through the private advisory.

We will review reports as promptly as practical and coordinate disclosure after a fix is available when appropriate.

## Scope

Bondfire's security model includes:

- client-side encryption of private organization data
- ciphertext-authoritative private storage
- authentication and authorization boundaries
- organization, module, and role access controls
- key management and recovery
- public/private publishing boundaries
- hosted Bondfire infrastructure

Self-hosted deployments are also affected by the security of their operators, servers, dependencies, configuration, and deployment environment.

## Security model

See:

- https://bondfireapp.org/security/
- https://bondfireapp.org/zero-knowledge/
- https://bondfireapp.org/threat-model/
- https://bondfireapp.org/what-bondfire-knows/
