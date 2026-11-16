"""Symmetric encryption for secrets at rest (repository tokens) and in transit through the broker (DAST auth headers)."""
import base64
import hashlib
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings


@lru_cache(maxsize=1)
def _fernet() -> Fernet:
    key = settings.FIELD_ENCRYPTION_KEY or base64.urlsafe_b64encode(hashlib.sha256(settings.SECRET_KEY.encode()).digest()).decode()
    return Fernet(key)


def encrypt_secret(plain_text: str | None) -> str:
    return _fernet().encrypt(plain_text.encode()).decode() if plain_text else ""


def decrypt_secret(cipher_text: str | None) -> str | None:
    if not cipher_text:
        return None
    try:
        return _fernet().decrypt(cipher_text.encode()).decode()
    except InvalidToken:
        return None
