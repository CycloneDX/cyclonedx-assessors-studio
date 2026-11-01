# Security policy

## Reporting a vulnerability

Please report security issues privately by email to
[security@cyclonedx.org](mailto:security@cyclonedx.org), with the word
"SECURITY" in the subject line. Do not open a public issue or pull
request for an unfixed vulnerability.

Include what you can of:

- the affected version or commit;
- steps to reproduce, or a proof of concept;
- the impact as you understand it.

The CycloneDX team will reply with next steps, keep you informed while
a fix is prepared, and coordinate the timing of any public announcement
with you.

## Verifying releases

Each release publishes a CycloneDX SBOM for the backend and frontend
and a `SHA256SUMS` file. Check a download with:

```bash
sha256sum --check --ignore-missing SHA256SUMS
```

Releases built in a public repository also carry signed
build-provenance attestations:

```bash
gh attestation verify assessors-studio-backend-<version>.tar.gz --repo <owner>/<repo>
```
