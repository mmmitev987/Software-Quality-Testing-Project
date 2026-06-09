"""
Tests for mealie/services/recipe/recipe_service.py

Functions covered:
- can_delete             : Logic Coverage (RACC) + Mock        (T3_can_delete.md)
- get_one                : ISP + Mock                          (T4_get_one.md)
- create_one             : ISP + Mock                          (T4_create_one.md)
- has_recursive_recipe_link: Graph Coverage (Prime Paths) + Mock (T4_has_recursive_recipe_link.md)
- _pre_update_check      : Logic Coverage (CACC) + Mock        (T4_pre_update_check.md)
"""

import pytest
from unittest.mock import MagicMock, Mock, patch
from uuid import UUID, uuid4

from mealie.core import exceptions
from mealie.services.recipe.recipe_service import RecipeService


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def make_service():
    """Instantiate RecipeService without hitting __init__ (avoids DB calls)."""
    service = RecipeService.__new__(RecipeService)
    service.user = MagicMock()
    service.user.admin = False
    service.user.group_id = uuid4()
    service.user.id = uuid4()
    service.repos = MagicMock()
    service.household = MagicMock()
    service.group_recipes = MagicMock()
    return service


def make_recipe(recipe_id=None, ingredient_sub_ids=None, locked=False):
    """Build a mock Recipe with optional ingredient links for recursion tests."""
    recipe = MagicMock()
    recipe.id = recipe_id or uuid4()
    recipe.settings = MagicMock()
    recipe.settings.locked = locked
    recipe.slug = f"recipe-{str(recipe.id)[:8]}"
    if ingredient_sub_ids:
        ings = []
        for sub_id in ingredient_sub_ids:
            ing = MagicMock()
            ing.referenced_recipe.id = sub_id
            ings.append(ing)
        recipe.recipe_ingredient = ings
    else:
        recipe.recipe_ingredient = []
    return recipe


# ===========================================================================
# can_delete — Logic Coverage (RACC)
# Analysis: T3_can_delete.md
# P = C1 ∨ C2  (C1=admin, C2=owned_count == len(slugs))
# ===========================================================================

class CanDeleteTests:

    SA = "mealie.services.recipe.recipe_service.sa"

    def _can_delete_non_admin(self, service, owned_count):
        """Helper: run can_delete with SA query construction mocked."""
        mock_query = MagicMock()
        mock_query.select_from.return_value = mock_query
        mock_query.where.return_value = mock_query
        with patch(self.SA) as mock_sa:
            mock_sa.select.return_value = mock_query
            mock_sa.func.count.return_value = MagicMock()
            service.group_recipes.session.scalar.return_value = owned_count
            return service.can_delete

    def test_t1_admin_returns_true_without_db_query(self):
        """T1 — RACC TR3 C1 active: admin user → True immediately, DB not queried."""
        service = make_service()
        service.user.admin = True

        result = service.can_delete(["soup"])

        assert result is True
        service.group_recipes.session.scalar.assert_not_called()

    def test_t2_non_admin_owns_all_single_slug(self):
        """T2 — RACC TR2 C2 active: non-admin owns the one slug → True."""
        service = make_service()
        mock_query = MagicMock()
        mock_query.select_from.return_value = mock_query
        mock_query.where.return_value = mock_query
        with patch(self.SA) as mock_sa:
            mock_sa.select.return_value = mock_query
            mock_sa.func.count.return_value = MagicMock()
            service.group_recipes.session.scalar.return_value = 1
            assert service.can_delete(["soup"]) is True

    def test_t3_non_admin_partial_ownership(self):
        """T3 — RACC TR1-base: non-admin owns 1 of 2 slugs → False."""
        service = make_service()
        mock_query = MagicMock()
        mock_query.select_from.return_value = mock_query
        mock_query.where.return_value = mock_query
        with patch(self.SA) as mock_sa:
            mock_sa.select.return_value = mock_query
            mock_sa.func.count.return_value = MagicMock()
            service.group_recipes.session.scalar.return_value = 1
            assert service.can_delete(["soup", "bread"]) is False

    def test_t4_non_admin_owns_none(self):
        """T4 — RACC TR1-base C2=F: owns 0 slugs → False. Kills M1 (>=) and M2 (!=)."""
        service = make_service()
        mock_query = MagicMock()
        mock_query.select_from.return_value = mock_query
        mock_query.where.return_value = mock_query
        with patch(self.SA) as mock_sa:
            mock_sa.select.return_value = mock_query
            mock_sa.func.count.return_value = MagicMock()
            service.group_recipes.session.scalar.return_value = 0
            assert service.can_delete(["soup"]) is False

    def test_t5_non_admin_owns_all_multiple_slugs(self):
        """T5 — RACC TR2 C2=T multi: non-admin owns both slugs → True."""
        service = make_service()
        mock_query = MagicMock()
        mock_query.select_from.return_value = mock_query
        mock_query.where.return_value = mock_query
        with patch(self.SA) as mock_sa:
            mock_sa.select.return_value = mock_query
            mock_sa.func.count.return_value = MagicMock()
            service.group_recipes.session.scalar.return_value = 2
            assert service.can_delete(["soup", "bread"]) is True

    def test_t6_empty_slug_list_vacuous_truth(self):
        """T6 — ISP boundary: empty slug list → owned_count=0, len=0, 0==0 → True."""
        service = make_service()
        mock_query = MagicMock()
        mock_query.select_from.return_value = mock_query
        mock_query.where.return_value = mock_query
        with patch(self.SA) as mock_sa:
            mock_sa.select.return_value = mock_query
            mock_sa.func.count.return_value = MagicMock()
            service.group_recipes.session.scalar.return_value = 0
            assert service.can_delete([]) is True


# ===========================================================================
# get_one — ISP + Mock
# Analysis: T4_get_one.md
# C1: A=UUID obj, B=str valid UUID, C=str slug
# ===========================================================================

class GetOneTests:

    TARGET_UUID = UUID("550e8400-e29b-41d4-a716-446655440000")

    def test_t1_uuid_object_calls_get_by_id(self):
        """T1 — C1=A: UUID object → _get_recipe called with ('id' field)."""
        service = make_service()
        fake_recipe = MagicMock()
        service._get_recipe = Mock(return_value=fake_recipe)

        result = service.get_one(self.TARGET_UUID)

        assert result is fake_recipe
        service._get_recipe.assert_called_once_with(self.TARGET_UUID, "id")

    def test_t2_str_uuid_promoted_to_uuid(self):
        """T2 — C1=B: valid UUID string → parsed to UUID, _get_recipe called with 'id'."""
        service = make_service()
        fake_recipe = MagicMock()
        service._get_recipe = Mock(return_value=fake_recipe)

        result = service.get_one("550e8400-e29b-41d4-a716-446655440000")

        assert result is fake_recipe
        call_args = service._get_recipe.call_args[0]
        assert isinstance(call_args[0], UUID)
        assert call_args[1] == "id"

    def test_t3_str_slug_calls_get_by_slug(self):
        """T3 — C1=C: non-UUID string → _get_recipe called with ('slug')."""
        service = make_service()
        fake_recipe = MagicMock()
        service._get_recipe = Mock(return_value=fake_recipe)

        result = service.get_one("tomato-soup")

        assert result is fake_recipe
        service._get_recipe.assert_called_once_with("tomato-soup", "slug")

    def test_t4_slug_not_found_raises(self):
        """T4 — C1=C not found: _get_recipe raises NoEntryFound → propagated."""
        service = make_service()
        service._get_recipe = Mock(side_effect=exceptions.NoEntryFound)

        with pytest.raises(exceptions.NoEntryFound):
            service.get_one("nonexistent-slug")


# ===========================================================================
# create_one — ISP + Mock
# Analysis: T4_create_one.md
# C1=name, C2=type, C3=preferences, C4=rating
# ===========================================================================

class CreateOneTests:

    def _setup_service(self):
        service = make_service()
        fake_data = MagicMock()
        fake_data.rating = None
        fake_data.last_made = None
        fake_data.settings = None
        service._recipe_creation_factory = Mock(return_value=fake_data)

        fake_new_recipe = MagicMock()
        fake_new_recipe.id = uuid4()
        fake_new_recipe.user_id = service.user.id
        fake_new_recipe.created_at = None
        service.repos.recipes.create.return_value = fake_new_recipe

        return service, fake_data, fake_new_recipe

    def test_t1_name_none_set_to_default(self):
        """T1 — C1=A: name=None → default 'New Recipe' applied before factory call."""
        from mealie.schema.recipe.recipe import CreateRecipe
        service, fake_data, fake_new_recipe = self._setup_service()
        service.household.preferences = MagicMock()

        create_data = MagicMock(spec=CreateRecipe)
        create_data.name = None
        create_data.settings = None
        create_data.model_dump.return_value = {}

        result = service.create_one(create_data)

        assert create_data.name == "New Recipe"
        service.repos.recipe_timeline_events.create.assert_called_once()

    def test_t2_recipe_with_settings_settings_not_overridden(self):
        """T2 — C1=B, C2=C: Recipe with settings → P2=False, settings unchanged."""
        from mealie.schema.recipe.recipe import Recipe
        service, fake_data, fake_new_recipe = self._setup_service()
        existing_settings = MagicMock()
        fake_data.settings = existing_settings

        create_data = MagicMock(spec=Recipe)
        create_data.name = "My Soup"
        create_data.settings = existing_settings
        create_data.model_dump.return_value = {}

        result = service.create_one(create_data)

        assert result is fake_new_recipe
        service.repos.recipe_timeline_events.create.assert_called_once()

    def test_t3_create_recipe_with_preferences_applies_prefs(self):
        """T3 — C1=B, C2=A, C3=A: CreateRecipe + preferences → settings from prefs."""
        from mealie.schema.recipe.recipe import CreateRecipe
        service, fake_data, fake_new_recipe = self._setup_service()
        service.household.preferences = MagicMock()
        service.household.preferences.recipe_public = True

        create_data = MagicMock(spec=CreateRecipe)
        create_data.name = "My Soup"
        create_data.settings = None
        create_data.model_dump.return_value = {}

        result = service.create_one(create_data)

        assert result is fake_new_recipe
        assert fake_data.settings is not None
        service.repos.recipe_timeline_events.create.assert_called_once()

    def test_t4_create_recipe_no_preferences_default_settings(self):
        """T4 — C1=B, C2=A, C3=B: CreateRecipe, no preferences → default RecipeSettings."""
        from mealie.schema.recipe.recipe import CreateRecipe
        service, fake_data, fake_new_recipe = self._setup_service()
        service.household.preferences = None

        create_data = MagicMock(spec=CreateRecipe)
        create_data.name = "My Soup"
        create_data.settings = None
        create_data.model_dump.return_value = {}

        result = service.create_one(create_data)

        assert result is fake_new_recipe
        service.repos.recipe_timeline_events.create.assert_called_once()

    def test_t5_rating_provided_creates_user_rating(self):
        """T5 — C4=A: rating truthy → user_ratings.create called once."""
        from mealie.schema.recipe.recipe import CreateRecipe
        service, fake_data, fake_new_recipe = self._setup_service()
        service.household.preferences = MagicMock()
        fake_data.rating = 5  # truthy

        create_data = MagicMock(spec=CreateRecipe)
        create_data.name = "My Soup"
        create_data.settings = None
        create_data.model_dump.return_value = {}

        service.create_one(create_data)

        service.repos.user_ratings.create.assert_called_once()

    def test_t6_no_rating_user_ratings_not_called(self):
        """T6 — C4=B: no rating → user_ratings.create NOT called."""
        from mealie.schema.recipe.recipe import CreateRecipe
        service, fake_data, fake_new_recipe = self._setup_service()
        service.household.preferences = MagicMock()
        fake_data.rating = None

        create_data = MagicMock(spec=CreateRecipe)
        create_data.name = "My Soup"
        create_data.settings = None
        create_data.model_dump.return_value = {}

        service.create_one(create_data)

        service.repos.user_ratings.create.assert_not_called()
        service.repos.recipe_timeline_events.create.assert_called_once()

    def test_t7_recipe_with_none_settings_treated_as_create_recipe(self):
        """T7 — C2=B: Recipe obj with settings=None → settings applied from prefs."""
        from mealie.schema.recipe.recipe import Recipe
        service, fake_data, fake_new_recipe = self._setup_service()
        service.household.preferences = MagicMock()
        fake_data.settings = None

        create_data = MagicMock(spec=Recipe)
        create_data.name = "My Soup"
        create_data.settings = None
        create_data.model_dump.return_value = {}

        result = service.create_one(create_data)

        assert result is fake_new_recipe
        assert fake_data.settings is not None
        service.repos.recipe_timeline_events.create.assert_called_once()


# ===========================================================================
# has_recursive_recipe_link — Graph Coverage (Prime Paths)
# Analysis: T4_has_recursive_recipe_link.md
# DFS cycle detection; backtracking via finally block
# ===========================================================================

class HasRecursiveRecipeLinkTests:

    def test_t1_pp1_no_ingredients_returns_false(self):
        """T1 — PP1: recipe with no ingredients → False immediately."""
        service = make_service()
        recipe = make_recipe()
        recipe.recipe_ingredient = []

        assert service.has_recursive_recipe_link(recipe) is False

    def test_t2_pp2_ingredient_raises_attribute_error(self):
        """T2 — PP2: ingredient raises AttributeError (no referenced_recipe) → continue → False."""
        service = make_service()
        ing = MagicMock()
        del ing.referenced_recipe  # AttributeError when accessed
        recipe = make_recipe()
        recipe.recipe_ingredient = [ing]

        assert service.has_recursive_recipe_link(recipe) is False

    def test_t3_pp2_ingredient_not_found(self):
        """T3 — PP2: get_one raises NoEntryFound → continue → False."""
        service = make_service()
        service.get_one = Mock(side_effect=exceptions.NoEntryFound)

        rid = uuid4()
        ing = MagicMock()
        ing.referenced_recipe.id = rid
        recipe = make_recipe()
        recipe.recipe_ingredient = [ing]

        assert service.has_recursive_recipe_link(recipe) is False

    def test_t4_pp3_sub_recipe_no_cycle(self):
        """T4 — PP3: A→B (B has no ingredients) → False; backtracking verified."""
        service = make_service()
        recipe_b = make_recipe()

        service.get_one = Mock(return_value=recipe_b)

        ing = MagicMock()
        ing.referenced_recipe.id = recipe_b.id
        recipe_a = make_recipe()
        recipe_a.recipe_ingredient = [ing]

        path = set()
        result = service.has_recursive_recipe_link(recipe_a, path)

        assert result is False
        assert len(path) == 0  # fully backtracked (finally block)

    def test_t5_pp5_direct_self_cycle(self):
        """T5 — PP5: recipe ingredient references itself → True."""
        service = make_service()
        recipe_a = make_recipe()

        ing = MagicMock()
        ing.referenced_recipe.id = recipe_a.id
        recipe_a.recipe_ingredient = [ing]

        # get_one returns same recipe (self-link)
        service.get_one = Mock(return_value=recipe_a)

        assert service.has_recursive_recipe_link(recipe_a) is True

    def test_t6_pp6_indirect_cycle_a_b_a(self):
        """T6 — PP6: A→B, B→A (indirect 2-level cycle) → True."""
        service = make_service()
        recipe_a = make_recipe()
        recipe_b = make_recipe()

        ing_a = MagicMock()
        ing_a.referenced_recipe.id = recipe_b.id
        recipe_a.recipe_ingredient = [ing_a]

        ing_b = MagicMock()
        ing_b.referenced_recipe.id = recipe_a.id
        recipe_b.recipe_ingredient = [ing_b]

        def get_one_side_effect(rid, *args, **kwargs):
            if rid == recipe_b.id:
                return recipe_b
            return recipe_a

        service.get_one = Mock(side_effect=get_one_side_effect)

        assert service.has_recursive_recipe_link(recipe_a) is True

    def test_t7_pp4_mixed_ingredients(self):
        """T7 — PP4: first ingredient errors, second→B (clean) → False."""
        service = make_service()
        recipe_b = make_recipe()

        bad_ing = MagicMock()
        bad_ing.referenced_recipe.id = uuid4()

        good_ing = MagicMock()
        good_ing.referenced_recipe.id = recipe_b.id

        recipe_a = make_recipe()
        recipe_a.recipe_ingredient = [bad_ing, good_ing]

        def get_one_side_effect(rid, *args, **kwargs):
            if rid == bad_ing.referenced_recipe.id:
                raise exceptions.NoEntryFound
            return recipe_b

        service.get_one = Mock(side_effect=get_one_side_effect)

        assert service.has_recursive_recipe_link(recipe_a) is False

    def test_t8_pp7_three_level_clean_chain(self):
        """T8 — PP7: A→B→C (C has no ingredients) → False; backtracking verified."""
        service = make_service()
        recipe_c = make_recipe()
        recipe_b = make_recipe()
        recipe_a = make_recipe()

        ing_a = MagicMock()
        ing_a.referenced_recipe.id = recipe_b.id
        recipe_a.recipe_ingredient = [ing_a]

        ing_b = MagicMock()
        ing_b.referenced_recipe.id = recipe_c.id
        recipe_b.recipe_ingredient = [ing_b]

        def get_one_side_effect(rid, *args, **kwargs):
            if rid == recipe_b.id:
                return recipe_b
            return recipe_c

        service.get_one = Mock(side_effect=get_one_side_effect)

        path = set()
        result = service.has_recursive_recipe_link(recipe_a, path)

        assert result is False
        assert len(path) == 0  # all three IDs backtracked

    def test_t9_pp8_explicit_empty_path_same_as_none(self):
        """T9 — PP8: explicit path=set() behaves same as path=None (both start fresh)."""
        service = make_service()
        recipe = make_recipe()
        recipe.recipe_ingredient = []

        result_none = service.has_recursive_recipe_link(recipe, None)
        result_empty = service.has_recursive_recipe_link(recipe, set())

        assert result_none == result_empty == False

    def test_t10_id_none_edge_case(self):
        """T10 — edge: recipe.id=None → str(None)='None', no cycle → False."""
        service = make_service()
        recipe = MagicMock()
        recipe.id = None
        recipe.recipe_ingredient = []

        assert service.has_recursive_recipe_link(recipe) is False


# ===========================================================================
# _pre_update_check — Logic Coverage (CACC)
# Analysis: T4_pre_update_check.md
# P1 = C_null ∨ C_nosettings (CACC)
# P3 = C_lock ∧ C_noperm (CACC)
# ===========================================================================

class PreUpdateCheckTests:

    def _setup(self, recipe=None):
        """Service with all delegates mocked to 'pass everything'."""
        service = make_service()
        if recipe is None:
            recipe = make_recipe()
        service.get_one = Mock(return_value=recipe)
        service.can_update = Mock(return_value=True)
        service.can_lock_unlock = Mock(return_value=True)
        service.has_recursive_recipe_link = Mock(return_value=False)
        return service, recipe

    def _make_new_data(self, settings_locked=None):
        new_data = MagicMock()
        if settings_locked is None:
            new_data.settings = None
        else:
            new_data.settings = MagicMock()
            new_data.settings.locked = settings_locked
        return new_data

    def test_t1_happy_path_returns_recipe(self):
        """T1 — all checks pass: returns existing recipe."""
        service, recipe = self._setup()
        new_data = self._make_new_data(settings_locked=False)
        recipe.settings.locked = False  # same → no lock change

        result = service._pre_update_check("tomato-soup", new_data)

        assert result is recipe

    def test_t2_recipe_none_raises_no_entry_found(self):
        """T2 — CACC R2 P1 C_null active: get_one returns None → NoEntryFound."""
        service, _ = self._setup()
        service.get_one = Mock(return_value=None)
        new_data = self._make_new_data()

        with pytest.raises(exceptions.NoEntryFound):
            service._pre_update_check("slug", new_data)

    def test_t3_settings_none_raises_no_entry_found(self):
        """T3 — CACC R3 P1 C_nosettings active: recipe.settings=None → NoEntryFound."""
        recipe = make_recipe()
        recipe.settings = None
        service, _ = self._setup(recipe)
        new_data = self._make_new_data()

        with pytest.raises(exceptions.NoEntryFound):
            service._pre_update_check("slug", new_data)

    def test_t4_cannot_update_raises_permission_denied(self):
        """T4 — P2=True: can_update returns False → PermissionDenied."""
        service, recipe = self._setup()
        service.can_update = Mock(return_value=False)
        new_data = self._make_new_data()

        with pytest.raises(exceptions.PermissionDenied):
            service._pre_update_check("slug", new_data)

    def test_t5_no_new_settings_skips_lock_check(self):
        """T5 — SL2: new_data.settings=None → C_lock=False → P3=False, no error."""
        service, recipe = self._setup()
        new_data = self._make_new_data(settings_locked=None)

        result = service._pre_update_check("slug", new_data)

        assert result is recipe
        service.can_lock_unlock.assert_not_called()

    def test_t6_same_lock_state_skips_lock_check(self):
        """T6 — SL3: lock state unchanged → C_lock=False → P3=False, no error."""
        service, recipe = self._setup()
        recipe.settings.locked = True
        new_data = self._make_new_data(settings_locked=True)  # same as current

        result = service._pre_update_check("slug", new_data)

        assert result is recipe

    def test_t7_lock_change_no_permission_raises(self):
        """T7 — CACC TR1 P3: lock changed + no permission → PermissionDenied."""
        service, recipe = self._setup()
        service.can_lock_unlock = Mock(return_value=False)
        recipe.settings.locked = False
        new_data = self._make_new_data(settings_locked=True)  # lock changed

        with pytest.raises(exceptions.PermissionDenied):
            service._pre_update_check("slug", new_data)

    def test_t8_lock_change_has_permission_passes(self):
        """T8 — CACC TR3 P3 C_noperm active: lock change, user has permission → no error."""
        service, recipe = self._setup()
        service.can_lock_unlock = Mock(return_value=True)
        recipe.settings.locked = False
        new_data = self._make_new_data(settings_locked=True)

        result = service._pre_update_check("slug", new_data)

        assert result is recipe

    def test_t9_no_lock_change_passes(self):
        """T9 — CACC TR2 P3 C_lock active: no lock change → P3=False, no error."""
        service, recipe = self._setup()
        recipe.settings.locked = False
        new_data = self._make_new_data(settings_locked=False)  # no change

        result = service._pre_update_check("slug", new_data)

        assert result is recipe

    def test_t10_recursive_link_raises(self):
        """T10 — P4=True: has_recursive_recipe_link → RecursiveRecipe raised."""
        service, recipe = self._setup()
        service.has_recursive_recipe_link = Mock(return_value=True)
        recipe.settings.locked = False
        new_data = self._make_new_data(settings_locked=False)

        with pytest.raises(exceptions.RecursiveRecipe):
            service._pre_update_check("slug", new_data)
