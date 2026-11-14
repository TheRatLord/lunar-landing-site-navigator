"""URL check for `fetch_data`: scheme, credentials, IP literals, ports, and the optional domain allowlist."""

from __future__ import annotations

import ipaddress
from dataclasses import dataclass
from urllib.parse import SplitResult, urlsplit


class UrlNotAllowed(ValueError):
    """The URL is not permitted by the allowlist; the message says why."""


@dataclass(frozen=True, slots=True)
class HostAllowlist:
    """Hosts a download may contact.

    ``domains`` is ``None`` for any host (the default). A listed domain admits itself and its subdomains.
    Matching is on whole DNS labels, so ``nasa.gov.evil.example`` and ``evilnasa.gov`` do not match
    ``nasa.gov``. Userinfo, IP literals and non-default ports are refused regardless of the host.
    """

    domains: tuple[str, ...] | None = None
    allow_http: bool = False

    def check(self, url: str) -> SplitResult:
        """Return the parsed URL or raise `UrlNotAllowed`."""
        try:
            parts = urlsplit(url.strip())
            port = parts.port
        except ValueError as exc:
            raise UrlNotAllowed(f"malformed URL: {exc}") from exc
        schemes = ("https", "http") if self.allow_http else ("https",)
        if parts.scheme not in schemes:
            raise UrlNotAllowed(f"scheme {parts.scheme!r} not allowed (allowed: {', '.join(schemes)})")
        if parts.username is not None or parts.password is not None or "@" in parts.netloc:
            raise UrlNotAllowed("credentials in the URL are not allowed")
        host = (parts.hostname or "").rstrip(".").lower()
        if not host:
            raise UrlNotAllowed("URL has no host")
        try:
            ipaddress.ip_address(host)
        except ValueError:
            pass
        else:
            raise UrlNotAllowed("IP-address hosts are not allowed")
        try:
            host = host.encode("idna").decode("ascii")
        except UnicodeError as exc:
            raise UrlNotAllowed(f"invalid host name: {exc}") from exc
        default_port = 443 if parts.scheme == "https" else 80
        if port is not None and port != default_port:
            raise UrlNotAllowed(f"port {port} not allowed")
        if not self.admits(host):
            raise UrlNotAllowed(f"host {host!r} is not on the allowlist")
        return parts

    def admits(self, host: str) -> bool:
        return self.domains is None or any(host == d or host.endswith("." + d) for d in self.domains)
