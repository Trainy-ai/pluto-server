from sqids import Sqids

# ref: server/lib/sqid.ts
sqids = Sqids(
    min_length=5,
    alphabet="abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
)


def sqid_encode(id: int) -> str:
    return sqids.encode([id])


def sqid_decode(id: str) -> int:
    decoded = sqids.decode(id)
    return decoded[0] if decoded else None
