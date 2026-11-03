"""Security policy coverage for the standalone authors page."""

import base64
import hashlib
from pathlib import Path
import re
import unittest

from backend.security import RequestSecurityMiddleware


class AuthorsSecurityHeadersTest(unittest.TestCase):
    def test_authors_csp_allows_only_the_exact_embedded_script(self):
        page = Path("frontend/authors.html").read_text(encoding="utf-8")
        match = re.search(r"<script>([\s\S]*?)</script>", page)
        self.assertIsNotNone(match)
        digest = base64.b64encode(
            hashlib.sha256(match.group(1).encode("utf-8")).digest()
        ).decode("ascii")

        authors_headers = dict(RequestSecurityMiddleware._security_headers("/authors"))
        authors_policy = authors_headers[b"content-security-policy"].decode("ascii")
        self.assertIn(f"'sha256-{digest}'", authors_policy)
        authors_script_policy = authors_policy.split("style-src", 1)[0]
        self.assertNotIn("'unsafe-inline'", authors_script_policy)

        default_headers = dict(RequestSecurityMiddleware._security_headers("/"))
        default_policy = default_headers[b"content-security-policy"].decode("ascii")
        self.assertNotIn(f"'sha256-{digest}'", default_policy)


if __name__ == "__main__":
    unittest.main()
