import os

# Set required env vars before any mealie module is imported.
# Do NOT call main() — we do not want DB initialisation in unit tests.
os.environ.setdefault("PRODUCTION", "True")
os.environ.setdefault("TESTING", "True")
os.environ.setdefault("ALLOW_SIGNUP", "True")
os.environ.setdefault("BASE_URL", "http://localhost")
os.environ.setdefault("SECRET", "test-secret-key-for-unit-tests-only")
