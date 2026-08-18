"""Create a local CA and HTTPS certificate for BusTrack LAN development.

The generated CA certificate is installed on the iPhone once.  The server
certificate includes the current LAN IP as a subject-alternative name, which
lets Safari treat ``https://<LAN-IP>:8443`` as a secure context for GPS.
"""

from __future__ import annotations

import argparse
import ipaddress
from datetime import datetime, timedelta, timezone
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID


def write_private_key(path: Path, key: rsa.RSAPrivateKey) -> None:
    path.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.TraditionalOpenSSL,
            serialization.NoEncryption(),
        )
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ip", required=True, type=ipaddress.ip_address)
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args()

    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    root_key_file = output_dir / "bus-track-local-ca-key.pem"
    root_cert_file = output_dir / "bus-track-local-ca.cer"
    server_key_file = output_dir / "bus-track-lan-key.pem"
    server_cert_file = output_dir / "bus-track-lan-cert.pem"
    now = datetime.now(timezone.utc)

    if root_key_file.exists() and root_cert_file.exists():
        root_key = serialization.load_pem_private_key(root_key_file.read_bytes(), password=None)
        root_certificate = x509.load_der_x509_certificate(root_cert_file.read_bytes())
    else:
        root_key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
        root_subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "BusTrack Local Development CA")])
        root_certificate = (
            x509.CertificateBuilder()
            .subject_name(root_subject)
            .issuer_name(root_subject)
            .public_key(root_key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(now - timedelta(minutes=5))
            .not_valid_after(now + timedelta(days=3650))
            .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
            .add_extension(x509.KeyUsage(digital_signature=True, key_cert_sign=True, crl_sign=True,
                                         key_encipherment=False, content_commitment=False,
                                         data_encipherment=False, key_agreement=False,
                                         encipher_only=False, decipher_only=False), critical=True)
            .sign(root_key, hashes.SHA256())
        )
        write_private_key(root_key_file, root_key)
        root_cert_file.write_bytes(root_certificate.public_bytes(serialization.Encoding.DER))

    server_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    server_subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, str(args.ip))])
    server_certificate = (
        x509.CertificateBuilder()
        .subject_name(server_subject)
        .issuer_name(root_certificate.subject)
        .public_key(server_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(minutes=5))
        .not_valid_after(now + timedelta(days=825))
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(x509.SubjectAlternativeName([
            x509.IPAddress(args.ip),
            x509.IPAddress(ipaddress.ip_address("127.0.0.1")),
            x509.DNSName("localhost"),
        ]), critical=False)
        .add_extension(x509.KeyUsage(digital_signature=True, key_encipherment=True, key_cert_sign=False,
                                     crl_sign=False, content_commitment=False, data_encipherment=False,
                                     key_agreement=False, encipher_only=False, decipher_only=False), critical=True)
        .sign(root_key, hashes.SHA256())
    )
    write_private_key(server_key_file, server_key)
    server_cert_file.write_bytes(server_certificate.public_bytes(serialization.Encoding.PEM))
    print(root_cert_file)
    print(server_cert_file)


if __name__ == "__main__":
    main()
