# Security policy

NIVIO Test Suite stores Business Central credentials, starts replay processes and
imports untrusted files. We take reports about these areas seriously.

## Reporting a vulnerability

Do not open a public issue for a security problem. Report it privately through
GitHub: open the repository's **Security** tab and choose **Report a vulnerability**.

Please include:

- the affected version or commit;
- the steps or file needed to reproduce the problem;
- the impact you expect, such as credential exposure, path traversal, sandbox escape
  or unintended process execution.

Never include real credentials, tenant data or customer data in a report.

We aim to acknowledge a report within five working days and will keep you informed
until it is resolved. Please give us a reasonable time to release a fix before you
disclose the problem publicly.

## Supported versions

Only the latest release and the `main` branch receive security fixes.

## Scope

In scope: the Electron main, preload and renderer processes, IPC validation, credential
storage, Page Script, `.nivio-test` and `.nivio-workspace` import, the replay runner,
the MCP server and the investigation agent runner.

Out of scope: vulnerabilities in Business Central itself or in `@microsoft/bc-replay`;
report those to Microsoft.
