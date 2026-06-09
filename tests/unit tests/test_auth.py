"""
Tests for authentication functions.

Functions covered:
- RegistrationService.register_user : ISP + Mock    (T4_register_user.md)
- create_access_token               : ISP + Mock    (T4_create_access_token.md)
"""

import pytest
from datetime import timedelta, UTC, datetime
from unittest.mock import MagicMock, Mock, patch
from uuid import uuid4

from fastapi import HTTPException

from mealie.services.user_services.registration_service import RegistrationService
from mealie.core.security.security import create_access_token


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def make_registration_service():
    """Build RegistrationService with all repos mocked."""
    logger = MagicMock()
    repos = MagicMock()
    translator = MagicMock()
    translator.t.side_effect = lambda key, **kw: key

    service = RegistrationService(logger=logger, db=repos, translator=translator)
    return service, repos


def make_registration(
    username="alice",
    email="alice@example.com",
    password="password123",
    group=None,
    group_token=None,
    seed_data=False,
):
    """Build a simple namespace object that mimics CreateUserRegistration."""
    reg = MagicMock()
    reg.username = username
    reg.email = email
    reg.password = password
    reg.password_confirm = password
    reg.full_name = "Alice"
    reg.advanced = False
    reg.group = group
    reg.group_token = group_token
    reg.seed_data = seed_data
    reg.locale = "en-US"
    return reg


# ===========================================================================
# register_user — ISP + Mock
# Analysis: T4_register_user.md
# C1=username, C2=email, C3=routing, C4=token validity, C5=seed, C6=token uses
# ===========================================================================

class RegisterUserTests:

    def _clean_repos(self, repos):
        """Set up repos so C1=B (no username) and C2=B (no email conflict)."""
        repos.users.get_by_username.return_value = None
        repos.users.get_one.return_value = None

    def test_t1_username_conflict_raises_409(self):
        """T1 — C1=A: username already taken → HTTP 409."""
        service, repos = make_registration_service()
        repos.users.get_by_username.return_value = MagicMock()  # conflict

        reg = make_registration(group="TestGroup")
        with pytest.raises(HTTPException) as exc_info:
            service.register_user(reg)

        assert exc_info.value.status_code == 409

    def test_t2_email_conflict_raises_409(self):
        """T2 — C1=B, C2=A: email already taken → HTTP 409."""
        service, repos = make_registration_service()
        repos.users.get_by_username.return_value = None
        repos.users.get_one.return_value = MagicMock()  # email conflict

        reg = make_registration(group="TestGroup")
        with pytest.raises(HTTPException) as exc_info:
            service.register_user(reg)

        assert exc_info.value.status_code == 409

    def test_t3_no_group_no_token_raises_400(self):
        """T3 — C3=C: neither group nor group_token provided → HTTP 400."""
        service, repos = make_registration_service()
        self._clean_repos(repos)

        reg = make_registration(group=None, group_token=None)
        with pytest.raises(HTTPException) as exc_info:
            service.register_user(reg)

        assert exc_info.value.status_code == 400

    def test_t4_invalid_token_not_found_raises_400(self):
        """T4 — C3=A, C4=A: token not found in DB → HTTP 400."""
        service, repos = make_registration_service()
        self._clean_repos(repos)
        repos.group_invite_tokens.get_one.return_value = None  # not found

        reg = make_registration(group_token="bad-token")
        with pytest.raises(HTTPException) as exc_info:
            service.register_user(reg)

        assert exc_info.value.status_code == 400

    def test_t5_token_found_group_missing_raises_400(self):
        """T5 — C3=A, C4=B: token found, group not in DB → HTTP 400."""
        service, repos = make_registration_service()
        self._clean_repos(repos)

        token_entry = MagicMock()
        token_entry.group_id = uuid4()
        token_entry.household_id = uuid4()
        repos.group_invite_tokens.get_one.return_value = token_entry
        repos.groups.get_one.return_value = None  # group missing

        reg = make_registration(group_token="valid-token")
        with pytest.raises(HTTPException) as exc_info:
            service.register_user(reg)

        assert exc_info.value.status_code == 400

    def test_t6_token_found_household_missing_raises_400(self):
        """T6 — C3=A, C4=C: token found, group valid, household not found → HTTP 400."""
        service, repos = make_registration_service()
        self._clean_repos(repos)

        token_entry = MagicMock()
        token_entry.group_id = uuid4()
        token_entry.household_id = uuid4()
        repos.group_invite_tokens.get_one.return_value = token_entry
        repos.groups.get_one.return_value = MagicMock()  # group OK
        repos.households.get_one.return_value = None      # household missing

        reg = make_registration(group_token="valid-token")
        with pytest.raises(HTTPException) as exc_info:
            service.register_user(reg)

        assert exc_info.value.status_code == 400

    def test_t7_valid_token_uses_left_gt_1_token_updated(self):
        """T7 — C3=A, C4=D, C6=A: all valid, uses_left > 1 → user created, token updated."""
        service, repos = make_registration_service()
        self._clean_repos(repos)

        token_entry = MagicMock()
        token_entry.group_id = uuid4()
        token_entry.household_id = uuid4()
        token_entry.uses_left = 3
        repos.group_invite_tokens.get_one.return_value = token_entry
        repos.groups.get_one.return_value = MagicMock()
        repos.households.get_one.return_value = MagicMock()

        fake_user = MagicMock()
        service._create_new_user = Mock(return_value=fake_user)

        reg = make_registration(group_token="valid-token")
        result = service.register_user(reg)

        assert result is fake_user
        repos.group_invite_tokens.update.assert_called_once()
        repos.group_invite_tokens.delete.assert_not_called()

    def test_t8_valid_token_uses_left_1_token_deleted(self):
        """T8 — C3=A, C4=D, C6=B: uses_left == 1 → token deleted after use."""
        service, repos = make_registration_service()
        self._clean_repos(repos)

        token_entry = MagicMock()
        token_entry.group_id = uuid4()
        token_entry.household_id = uuid4()
        token_entry.uses_left = 1
        repos.group_invite_tokens.get_one.return_value = token_entry
        repos.groups.get_one.return_value = MagicMock()
        repos.households.get_one.return_value = MagicMock()

        fake_user = MagicMock()
        service._create_new_user = Mock(return_value=fake_user)

        reg = make_registration(group_token="valid-token")
        result = service.register_user(reg)

        assert result is fake_user
        repos.group_invite_tokens.delete.assert_called_once()
        repos.group_invite_tokens.update.assert_not_called()

    def test_t9_new_group_seed_data_true_seeds_called(self):
        """T9 — C3=B, C5=A: new group + seed_data=True → seeder methods called."""
        service, repos = make_registration_service()
        self._clean_repos(repos)

        fake_group = MagicMock()
        fake_group.id = uuid4()
        fake_household = MagicMock()
        fake_user = MagicMock()

        service._register_new_group = Mock(return_value=fake_group)
        service._fetch_or_register_new_household = Mock(return_value=fake_household)
        service._create_new_user = Mock(return_value=fake_user)

        reg = make_registration(group="NewGroup", seed_data=True)

        with patch(
            "mealie.services.user_services.registration_service.SeederService"
        ) as mock_seeder_cls:
            mock_seeder = MagicMock()
            mock_seeder_cls.return_value = mock_seeder

            result = service.register_user(reg)

        assert result is fake_user
        mock_seeder.seed_foods.assert_called_once()
        mock_seeder.seed_labels.assert_called_once()
        mock_seeder.seed_units.assert_called_once()

    def test_t10_new_group_seed_data_false_seeds_not_called(self):
        """T10 — C3=B, C5=B: new group + seed_data=False → seeder NOT called."""
        service, repos = make_registration_service()
        self._clean_repos(repos)

        fake_group = MagicMock()
        fake_group.id = uuid4()
        fake_household = MagicMock()
        fake_user = MagicMock()

        service._register_new_group = Mock(return_value=fake_group)
        service._fetch_or_register_new_household = Mock(return_value=fake_household)
        service._create_new_user = Mock(return_value=fake_user)

        reg = make_registration(group="NewGroup", seed_data=False)

        with patch(
            "mealie.services.user_services.registration_service.SeederService"
        ) as mock_seeder_cls:
            result = service.register_user(reg)

        mock_seeder_cls.assert_not_called()
        assert result is fake_user


# ===========================================================================
# create_access_token — ISP + Mock
# Analysis: T4_create_access_token.md
# C1: expires_delta None vs provided; C2: data dict variants
# ===========================================================================

PATCH_SETTINGS = "mealie.core.security.security.get_app_settings"
PATCH_JWT = "mealie.core.security.security.jwt.encode"


def _mock_settings(token_time=48, secret="test-secret"):
    s = MagicMock()
    s.TOKEN_TIME = token_time
    s.SECRET = secret
    return s


class CreateAccessTokenTests:

    def test_t1_no_expires_delta_uses_token_time(self):
        """T1 — C1=A: expires_delta=None → TOKEN_TIME default used; jwt.encode called."""
        with patch(PATCH_SETTINGS, return_value=_mock_settings(token_time=48)) as _ms, \
             patch(PATCH_JWT, return_value="mock.jwt.token") as mock_jwt:
            token = create_access_token({"sub": "alice"})

        assert token == "mock.jwt.token"
        mock_jwt.assert_called_once()
        payload = mock_jwt.call_args[0][0]
        assert "exp" in payload
        # exp should be ~48h from now
        exp = payload["exp"]
        now = datetime.now(UTC)
        diff = (exp - now).total_seconds()
        assert 47 * 3600 < diff < 49 * 3600

    def test_t2_explicit_expires_delta_used(self):
        """T2 — C1=B: explicit timedelta(hours=1) → exp ≈ now + 1h."""
        with patch(PATCH_SETTINGS, return_value=_mock_settings()) as _ms, \
             patch(PATCH_JWT, return_value="mock.jwt.token") as mock_jwt:
            token = create_access_token({"sub": "alice"}, expires_delta=timedelta(hours=1))

        mock_jwt.assert_called_once()
        payload = mock_jwt.call_args[0][0]
        exp = payload["exp"]
        now = datetime.now(UTC)
        diff = (exp - now).total_seconds()
        assert 0 < diff < 3700  # within ~1h

    def test_t3_short_delta_token_uses_provided_delta(self):
        """T3 — C1=B short: timedelta(seconds=30) explicitly provided → used over default."""
        with patch(PATCH_SETTINGS, return_value=_mock_settings()) as _ms, \
             patch(PATCH_JWT, return_value="mock.jwt.token") as mock_jwt:
            create_access_token({"sub": "alice"}, expires_delta=timedelta(seconds=30))

        payload = mock_jwt.call_args[0][0]
        exp = payload["exp"]
        now = datetime.now(UTC)
        diff = (exp - now).total_seconds()
        assert 0 < diff < 60  # within 30-60 seconds (not 48h default)

    def test_t4_empty_data_exp_added_caller_not_mutated(self):
        """T4 — C2=B: empty dict {} → 'exp' added to copy, caller dict unchanged."""
        original = {}
        with patch(PATCH_SETTINGS, return_value=_mock_settings()) as _ms, \
             patch(PATCH_JWT, return_value="tok") as mock_jwt:
            create_access_token(original)

        assert "exp" not in original  # caller's dict untouched (copy was made)
        payload = mock_jwt.call_args[0][0]
        assert "exp" in payload

    def test_t5_pre_existing_exp_overwritten_caller_unchanged(self):
        """T5 — C2=C: pre-existing 'exp' key in data → overwritten in copy, original unchanged."""
        sentinel_exp = object()
        original = {"sub": "alice", "exp": sentinel_exp}

        with patch(PATCH_SETTINGS, return_value=_mock_settings()) as _ms, \
             patch(PATCH_JWT, return_value="tok") as mock_jwt:
            create_access_token(original)

        assert original["exp"] is sentinel_exp  # caller's dict untouched
        payload = mock_jwt.call_args[0][0]
        assert payload["exp"] is not sentinel_exp  # overwritten in copy

    def test_jwt_encode_called_with_correct_secret_and_algorithm(self):
        """TR6 — always: jwt.encode called with correct SECRET and HS256 algorithm."""
        with patch(PATCH_SETTINGS, return_value=_mock_settings(secret="my-secret")) as _ms, \
             patch(PATCH_JWT, return_value="tok") as mock_jwt:
            create_access_token({"sub": "alice"})

        call_args = mock_jwt.call_args
        assert call_args[0][1] == "my-secret"
        assert call_args.kwargs.get("algorithm", call_args[0][2] if len(call_args[0]) > 2 else None) == "HS256"
