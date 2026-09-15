Bondfire

Private infrastructure for people doing things together.

Bondfire is a modular coordination platform built for mutual aid networks, community organizations, collectives, gatherings, projects, and other groups that need useful infrastructure without turning themselves into a data product.

It combines everyday organizational tools in one place while keeping each organization in control of what it uses, what it publishes, and what stays private.

Bondfire can be hosted as a service or run independently.

What it does

Bondfire is built around an organization workspace. Groups enable the tools they actually need rather than being handed one enormous application full of features they will never touch.

Modules include:

Needs: coordinate requests and needs

Pledges: collect and manage commitments

Inventory: keep track of shared resources

Meetings: organize meetings and related information

Drive: shared file storage

Events: organize public and internal events

REC: capture and archive media

FireChat: group communication

Intake: receive structured submissions

Studio: collaborative working tools

Colophon: optional publishing tools

Bondfire also provides organization membership, roles and permissions, invitations, public organization pages, security controls, backups and recovery tools.

Not every organization needs every module. That is the point.

Privacy

Bondfire is designed around a simple principle: the server should know as little as possible about a group's private work.

Private organization content is encrypted on the client before it is persisted. The server stores encrypted data rather than needing access to the underlying private content. Decryption is limited to authenticated members with the appropriate organization, module, and role access.

Information that a group deliberately publishes, such as content on a public Organization Page, is necessarily public and is handled separately from private organization data.

Bondfire also includes tools for key management, recovery, security levels, and emergency organization lockdown and destruction.

Encryption does not magically make bad operational security disappear. Groups dealing with serious risk should still think carefully about devices, account security, membership, backups, metadata, and what information they collect in the first place.

Organization Pages and publishing

Bondfire can expose a public Organization Page for groups that want to publish mutual-aid or organizational information.

Publishing is optional.

Bondfire also includes an optional native integration with Colophon for groups that need a fuller editorial publication. The two are deliberately separate:

Bondfire owns the organization workspace and Organization Page.

Colophon provides the Publication Site and editorial workflow.

Bondfire remains fully usable without Colophon.

Running Bondfire

Bondfire is a React and Vite application with a Cloudflare-based hosted deployment using Pages, Workers, D1, and object storage.

The project also supports self-hosted use.

Development

Install dependencies:

npm install

Start the development server:

npm run dev

Run the regression suite:

npm test

Create a production build:

npm run build

A change intended for release should pass both the regression suite and production build.

Security

Bondfire handles information that groups may reasonably consider sensitive.

If you discover a security problem, please do not publish exploit details or sensitive user information in a public issue. Contact the project maintainers privately first so the problem can be investigated and fixed without unnecessarily exposing people using the software.

No software can promise safety simply by existing. Bondfire's security features are tools, not a substitute for understanding the risks facing a particular organization.

Contributing

Contributions are welcome.

Keep changes focused, preserve existing security boundaries, and include tests when changing behavior that affects authentication, authorization, encryption, publication, destructive actions, or private data.

Before submitting a change:

npm test
npm run build

Both should complete successfully.

License

Bondfire is free software licensed under the GNU Affero General Public License, version 3 or later (AGPL-3.0-or-later).

You are free to use, study, modify, and redistribute Bondfire under the terms of that license.

The Affero GPL also applies when modified versions are operated as a service over a network. If you modify Bondfire and make that modified version available for people to use over a network, the license generally requires that those users be offered the corresponding source code for the version they are using.

That is intentional. Improvements to infrastructure built from Bondfire should remain available to the people who depend on it.

See the LICENSE file for the complete license terms.

Why Bondfire?

A lot of software for organizations begins with the assumption that somebody should own the platform, observe the users, centralize the information, or eventually figure out how to monetize everyone involved.

Bondfire starts somewhere else.

Groups should be able to coordinate without surrendering control of their infrastructure or collecting more information about one another than they actually need.

Software will not create strong communities. It can at least try not to make their work harder.
