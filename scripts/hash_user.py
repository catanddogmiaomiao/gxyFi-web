import hashlib
import json
import secrets
import sys

if len(sys.argv) != 3:
    raise SystemExit("用法: python scripts/hash_user.py 用户名 密码")

username = sys.argv[1].strip()
password = sys.argv[2]
if not username or not password:
    raise SystemExit("用户名和密码都不能为空")

salt = secrets.token_hex(16)
digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 100_000).hex()
print(json.dumps({"username": username, "salt": salt, "hash": digest}, ensure_ascii=False))
