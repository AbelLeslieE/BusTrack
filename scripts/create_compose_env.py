"""Create local-only secrets for the container stack without overwriting them."""

from pathlib import Path
import secrets

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


ROOT = Path(__file__).resolve().parent.parent
DESTINATION = ROOT / "compose.env"


def main() -> None:
    signing_key = Ed25519PrivateKey.generate().private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("ascii")
    values = {
        "DB_USER": "bustrack",
        "DB_NAME": "bustrack",
        # URL-safe characters keep the Compose DATABASE_URL valid without
        # putting a plaintext password into the repository or shell history.
        "DB_PASSWORD": secrets.token_urlsafe(32),
        "JWT_SECRET_KEY": secrets.token_urlsafe(48),
        "BOOTSTRAP_ADMIN_PASSWORD": secrets.token_urlsafe(24),
        "BUS_PASS_SIGNING_KEY_PEM": signing_key.replace("\n", "\\n"),
    }
    try:
        with DESTINATION.open("x", encoding="utf-8", newline="\n") as output:
            output.write("# Local container secrets. Keep this file private.\n")
            for key, value in values.items():
                output.write(f"{key}={value}\n")
    except FileExistsError:
        raise SystemExit(f"{DESTINATION} already exists; existing secrets were preserved.") from None
    print(f"Created {DESTINATION}. Read BOOTSTRAP_ADMIN_PASSWORD there to sign in.")


if __name__ == "__main__":
    main()
