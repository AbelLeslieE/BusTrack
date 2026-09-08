"""Provision a server-only Ed25519 PEM without printing it or writing into Git."""
import argparse
import os
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


def create_key(destination: Path):
    destination = destination.expanduser().resolve()
    repository = Path(__file__).resolve().parents[1]
    if destination.is_relative_to(repository):
        raise ValueError("Store the signing key outside the repository and all publicly served folders.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    key = Ed25519PrivateKey.generate()
    pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "wb") as output:
        output.write(pem)
    return destination


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        destination = create_key(args.output)
    except (ValueError, OSError) as error:
        parser.exit(1, f"Key was not created: {error}\n")
    print(f"Created private key at {destination}. Restrict its file permissions to the server operator/service account.")
    print("Set BUS_PASS_SIGNING_KEY_PEM in the server secret store using this file's contents. Never upload it as a frontend asset.")
