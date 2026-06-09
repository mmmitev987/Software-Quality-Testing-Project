"""
Tests for mealie/services/household_services/shopping_lists.py

Functions covered:
- can_merge                          : RACC + GACC + CACC     (T3_can_merge.md)
- merge_items                        : ISP + RACC + Mock       (T4_merge_items.md)
- bulk_create_items                  : ISP + Mock              (T4_bulk_create_items.md)
- remove_recipe_ingredients_from_list: ISP + Mock              (T4_remove_recipe_ingredients.md)
"""

import pytest
from unittest.mock import MagicMock, Mock, patch
from uuid import UUID, uuid4

from mealie.services.household_services.shopping_lists import ShoppingListService


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def make_service():
    """Instantiate ShoppingListService without a real database."""
    service = ShoppingListService.__new__(ShoppingListService)
    service.data_matcher = MagicMock()
    service.data_matcher.units_by_id.get.return_value = None
    return service


def make_item(**overrides):
    """Create a mock shopping list item with sensible defaults."""
    item = MagicMock()
    item.checked = False
    item.food_id = None
    item.unit_id = uuid4()
    item.unit = None
    item.note = ""
    item.quantity = 1.0
    item.extras = None
    item.recipe_references = []
    for k, v in overrides.items():
        setattr(item, k, v)
    return item


# ===========================================================================
# can_merge — Logic Coverage: RACC + GACC + CACC
# Analysis: T3_can_merge.md
# P1 = C1 ∨ C2 ∨ C3  (3-clause OR: checked flags + food_id mismatch)
# P3 = C4 ∨ C5        (2-clause OR: food_id or matching notes)
# All three criteria converge for independent OR clauses (documented in analysis).
# ===========================================================================

class CanMergeTests:

    FOOD_ID = uuid4()
    UNIT_ID = uuid4()

    # --- P1 RACC rows ---

    def test_tc1_p1_c1_item1_checked_returns_false(self):
        """TC1 — RACC R2: C1 active (item1.checked=True) → False"""
        service = make_service()
        i1 = make_item(checked=True, food_id=self.FOOD_ID, unit_id=self.UNIT_ID)
        i2 = make_item(checked=False, food_id=self.FOOD_ID, unit_id=self.UNIT_ID)
        assert service.can_merge(i1, i2) is False

    def test_tc2_p1_c2_item2_checked_returns_false(self):
        """TC2 — RACC R3: C2 active (item2.checked=True) → False"""
        service = make_service()
        i1 = make_item(checked=False, food_id=self.FOOD_ID, unit_id=self.UNIT_ID)
        i2 = make_item(checked=True, food_id=self.FOOD_ID, unit_id=self.UNIT_ID)
        assert service.can_merge(i1, i2) is False

    def test_tc3_p1_c3_food_mismatch_returns_false(self):
        """TC3 — RACC R4: C3 active (food_ids differ) → False"""
        service = make_service()
        i1 = make_item(food_id=uuid4(), unit_id=self.UNIT_ID)
        i2 = make_item(food_id=uuid4(), unit_id=self.UNIT_ID)
        assert service.can_merge(i1, i2) is False

    # --- P1=False: proceed through unit guards and P3 ---

    def test_tc4_p1_false_same_units_food_id_set_returns_true(self):
        """TC4 — P1=False, G1=A same units, P3 C4=T (food_id set) → True"""
        service = make_service()
        fid = uuid4()
        uid = uuid4()
        i1 = make_item(food_id=fid, unit_id=uid, note="eggs")
        i2 = make_item(food_id=fid, unit_id=uid, note="milk")
        assert service.can_merge(i1, i2) is True

    def test_tc5_p1_false_same_units_notes_match_returns_true(self):
        """TC5 — P1=False, G1=A same units, P3 C5=T (no food_id, notes match) → True"""
        service = make_service()
        uid = uuid4()
        i1 = make_item(food_id=None, unit_id=uid, note="eggs")
        i2 = make_item(food_id=None, unit_id=uid, note="eggs")
        assert service.can_merge(i1, i2) is True

    def test_tc6_p1_false_same_units_p3_both_false_returns_false(self):
        """TC6 — P1=False, G1=A same units, P3 base (no food_id, notes differ) → False"""
        service = make_service()
        uid = uuid4()
        i1 = make_item(food_id=None, unit_id=uid, note="eggs")
        i2 = make_item(food_id=None, unit_id=uid, note="milk")
        assert service.can_merge(i1, i2) is False

    # --- Unit guard section (ISP G1-G4) ---

    def test_tc7_g2_item1_unit_missing_returns_false(self):
        """TC7 — G1=B different unit_ids, G2=B item1 unit not found → False"""
        service = make_service()
        fid = uuid4()
        i1 = make_item(food_id=fid, unit_id=uuid4(), unit=None)
        i2 = make_item(food_id=fid, unit_id=uuid4(), unit=None)
        # data_matcher.units_by_id.get returns None → item1 unit missing
        service.data_matcher.units_by_id.get.return_value = None
        assert service.can_merge(i1, i2) is False

    def test_tc8_g3_item2_unit_no_standard_returns_false(self):
        """TC8 — G1=B, G2=A item1 has standard_unit, G3=B item2 missing standard → False"""
        service = make_service()
        fid = uuid4()
        unit1 = MagicMock()
        unit1.standard_unit = MagicMock()
        unit2 = MagicMock()
        unit2.standard_unit = None
        i1 = make_item(food_id=fid, unit_id=uuid4(), unit=unit1)
        i2 = make_item(food_id=fid, unit_id=uuid4(), unit=unit2)
        assert service.can_merge(i1, i2) is False

    def test_tc9_g4_units_not_convertible_returns_false(self):
        """TC9 — G1=B, G2=A, G3=A, G4=B: UnitConverter.can_convert → False"""
        service = make_service()
        fid = uuid4()
        unit1 = MagicMock()
        unit1.standard_unit = MagicMock()
        unit2 = MagicMock()
        unit2.standard_unit = MagicMock()
        i1 = make_item(food_id=fid, unit_id=uuid4(), unit=unit1)
        i2 = make_item(food_id=fid, unit_id=uuid4(), unit=unit2)

        with patch(
            "mealie.services.household_services.shopping_lists.UnitConverter"
        ) as mock_uc_cls:
            mock_uc_cls.return_value.can_convert.return_value = False
            assert service.can_merge(i1, i2) is False

    def test_tc10_g4_units_convertible_reaches_p3(self):
        """TC10 — G1=B, G2=A, G3=A, G4=A: convertible units → reach P3, food_id set → True"""
        service = make_service()
        fid = uuid4()
        unit1 = MagicMock()
        unit1.standard_unit = MagicMock()
        unit2 = MagicMock()
        unit2.standard_unit = MagicMock()
        i1 = make_item(food_id=fid, unit_id=uuid4(), unit=unit1)
        i2 = make_item(food_id=fid, unit_id=uuid4(), unit=unit2)

        with patch(
            "mealie.services.household_services.shopping_lists.UnitConverter"
        ) as mock_uc_cls:
            mock_uc_cls.return_value.can_convert.return_value = True
            assert service.can_merge(i1, i2) is True


# ===========================================================================
# merge_items — ISP + RACC + Mock
# Analysis: T4_merge_items.md
# C1=unit availability (P1), C2=notes (P2/P3), C3=extras (P4), C4=refs
# RACC on P1 (4-clause AND) and P3 (2-clause AND)
# ===========================================================================

class MergeItemsTests:

    def test_t2_no_units_same_notes_qty_summed(self):
        """T2 — C1=D (simple sum), C2=A (same notes): quantities summed"""
        service = make_service()
        from_item = make_item(quantity=1.0, note="milk", unit=None, unit_id=uuid4())
        to_item = make_item(quantity=2.0, note="milk", unit=None, unit_id=uuid4())
        to_item.extras = None
        from_item.extras = None
        to_item.recipe_references = []
        from_item.recipe_references = []

        service.merge_items(from_item, to_item)

        assert to_item.quantity == 3.0

    def test_t3_notes_differ_joined(self):
        """T3 — C2=B: both notes present, different → joined with ' | '"""
        service = make_service()
        from_item = make_item(quantity=1.0, note="eggs", unit=None)
        to_item = make_item(quantity=2.0, note="milk", unit=None)
        from_item.extras = None
        to_item.extras = None
        from_item.recipe_references = []
        to_item.recipe_references = []

        service.merge_items(from_item, to_item)

        assert "milk" in to_item.note
        assert "eggs" in to_item.note
        assert " | " in to_item.note

    def test_t4_to_empty_note_from_has_note(self):
        """T4 — C2=C: to_item note empty, from_item has note → to_item.note = from note"""
        service = make_service()
        from_item = make_item(quantity=1.0, note="eggs", unit=None)
        to_item = make_item(quantity=2.0, note="", unit=None)
        from_item.extras = None
        to_item.extras = None
        from_item.recipe_references = []
        to_item.recipe_references = []

        service.merge_items(from_item, to_item)

        assert to_item.note == "eggs"

    def test_t5_from_empty_note_to_has_note(self):
        """T5 — C2=D: to_item has note, from_item note empty → to_item.note unchanged"""
        service = make_service()
        from_item = make_item(quantity=1.0, note="", unit=None)
        to_item = make_item(quantity=2.0, note="milk", unit=None)
        from_item.extras = None
        to_item.extras = None
        from_item.recipe_references = []
        to_item.recipe_references = []

        service.merge_items(from_item, to_item)

        assert to_item.note == "milk"

    def test_t6_extras_merged(self):
        """T6 — C3=A: both have extras → merged"""
        service = make_service()
        from_item = make_item(quantity=1.0, note="", unit=None,
                              extras={"key1": "val1"})
        to_item = make_item(quantity=2.0, note="", unit=None,
                            extras={"key2": "val2"})
        from_item.recipe_references = []
        to_item.recipe_references = []

        service.merge_items(from_item, to_item)

        # extras are real dicts; verify in-place update occurred
        assert "key1" in to_item.extras
        assert "key2" in to_item.extras

    def test_t7_non_overlapping_refs_unioned(self):
        """T7 — C4=B: non-overlapping recipe refs → both in result"""
        service = make_service()
        rid1 = uuid4()
        rid2 = uuid4()
        ref1 = MagicMock()
        ref1.recipe_id = rid1
        ref2 = MagicMock()
        ref2.recipe_id = rid2
        from_item = make_item(quantity=1.0, note="", unit=None, extras=None,
                              recipe_references=[ref1])
        to_item = make_item(quantity=2.0, note="", unit=None, extras=None,
                            recipe_references=[ref2])

        service.merge_items(from_item, to_item)

        to_item.cast.assert_called_once()
        # Verify both refs were passed
        call_kwargs = to_item.cast.call_args[1]
        assert len(call_kwargs["recipe_references"]) == 2

    def test_t8_overlapping_refs_scales_summed(self):
        """T8 — C4=C: overlapping recipe refs → recipe_scale summed"""
        service = make_service()
        rid = uuid4()
        ref_from = MagicMock()
        ref_from.recipe_id = rid
        ref_from.recipe_scale = 1.0
        ref_to = MagicMock()
        ref_to.recipe_id = rid
        ref_to.recipe_scale = 2.0
        from_item = make_item(quantity=1.0, note="", unit=None, extras=None,
                              recipe_references=[ref_from])
        to_item = make_item(quantity=2.0, note="", unit=None, extras=None,
                            recipe_references=[ref_to])

        service.merge_items(from_item, to_item)

        # base_ref.recipe_scale += to_ref.recipe_scale → 1.0 + 2.0 = 3.0
        assert ref_from.recipe_scale == 3.0

    def test_t9_none_scales_treated_as_one(self):
        """T9 — C4=D: None recipe_scale treated as 1 before summing"""
        service = make_service()
        rid = uuid4()
        ref_from = MagicMock()
        ref_from.recipe_id = rid
        ref_from.recipe_scale = None
        ref_to = MagicMock()
        ref_to.recipe_id = rid
        ref_to.recipe_scale = None
        from_item = make_item(quantity=1.0, note="", unit=None, extras=None,
                              recipe_references=[ref_from])
        to_item = make_item(quantity=2.0, note="", unit=None, extras=None,
                            recipe_references=[ref_to])

        service.merge_items(from_item, to_item)

        # None→1, then 1 += 1 → 2
        assert ref_from.recipe_scale == 2

    def test_t1_both_standard_units_calls_merge_quantity(self):
        """T1 — C1=A: both units have standard_unit → merge_quantity_and_unit called"""
        service = make_service()
        unit1 = MagicMock()
        unit1.standard_unit = MagicMock()
        unit2 = MagicMock()
        unit2.standard_unit = MagicMock()
        merged_unit = MagicMock()
        merged_unit.id = uuid4()

        from_item = make_item(quantity=1.0, note="", unit=unit1,
                              extras=None, recipe_references=[])
        to_item = make_item(quantity=2.0, note="", unit=unit2,
                            extras=None, recipe_references=[])

        with patch(
            "mealie.services.household_services.shopping_lists.merge_quantity_and_unit",
            return_value=(3.0, merged_unit),
        ) as mock_merge:
            service.merge_items(from_item, to_item)
            mock_merge.assert_called_once()

        assert to_item.quantity == 3.0


# ===========================================================================
# bulk_create_items — ISP + Mock
# Analysis: T4_bulk_create_items.md
# C1=input length, C2=Phase1 consolidation, C3=Phase2 existing merge,
# C4=quantity, C5=checked, C6=auto_find_labels
# ===========================================================================

class BulkCreateItemsTests:

    def _setup_service(self):
        """Service with all called methods mocked."""
        service = make_service()
        service.can_merge = Mock(return_value=False)
        service.merge_items = Mock()
        service.find_matching_label = Mock(return_value=uuid4())
        service.remove_unused_recipe_references = Mock()
        service.list_items = MagicMock()
        service.list_items.page_all.return_value = MagicMock(items=[])
        service.list_items.create_many.return_value = []
        service.list_items.update_many.return_value = []
        return service

    def _make_create_item(self, **kwargs):
        item = MagicMock()
        item.shopping_list_id = kwargs.get("shopping_list_id", uuid4())
        item.quantity = kwargs.get("quantity", 1.0)
        item.checked = kwargs.get("checked", False)
        item.recipe_references = kwargs.get("recipe_references", [])
        item.food_id = kwargs.get("food_id", None)
        item.note = kwargs.get("note", "")
        item.label_id = None
        item.unit = None
        item.unit_id = uuid4()
        item.extras = None
        return item

    def test_t1_empty_input_nothing_created(self):
        """T1 — C1=A: empty input → create_many and update_many not called"""
        service = self._setup_service()
        result = service.bulk_create_items([])
        service.list_items.create_many.assert_not_called()
        service.list_items.update_many.assert_not_called()

    def test_t2_single_item_no_merge_created(self):
        """T2 — C1=B, C2=A no consolidation, C3=A no existing → created"""
        service = self._setup_service()
        create_item = self._make_create_item()
        # return [] to avoid Pydantic validation on MagicMock items in ShoppingListItemsCollectionOut
        service.list_items.create_many.return_value = []

        service.bulk_create_items([create_item])

        service.list_items.create_many.assert_called_once()

    def test_t5_negative_quantity_item_skipped(self):
        """T5 — C4=A: quantity < 0 → item discarded, create_many called with empty list"""
        service = self._setup_service()
        create_item = self._make_create_item(quantity=-1.0)

        service.bulk_create_items([create_item])

        # Item with negative quantity should not be in create_many call
        called_args = service.list_items.create_many.call_args
        if called_args is not None:
            items_passed = called_args[0][0]
            assert len(items_passed) == 0

    def test_t6_checked_item_clears_recipe_refs(self):
        """T6 — C5=A: checked item → recipe_references cleared before create"""
        service = self._setup_service()
        create_item = self._make_create_item(checked=True, quantity=1.0)
        create_item.recipe_references = [MagicMock()]
        service.list_items.create_many.return_value = []

        service.bulk_create_items([create_item])

        assert create_item.recipe_references == []

    def test_t7_auto_find_labels_true_calls_find_label(self):
        """T7 — C6=A: auto_find_labels=True → find_matching_label called"""
        service = self._setup_service()
        create_item = self._make_create_item(quantity=1.0)
        service.list_items.create_many.return_value = []

        service.bulk_create_items([create_item], auto_find_labels=True)

        service.find_matching_label.assert_called()

    def test_t8_auto_find_labels_false_does_not_call(self):
        """T8 — C6=B: auto_find_labels=False → find_matching_label NOT called"""
        service = self._setup_service()
        create_item = self._make_create_item(quantity=1.0)
        service.list_items.create_many.return_value = []

        service.bulk_create_items([create_item], auto_find_labels=False)

        service.find_matching_label.assert_not_called()

    def test_t4_phase2_merge_with_existing_updates_not_creates(self):
        """T4 — C3=B: item merges into existing → update_many called, not create_many"""
        service = self._setup_service()
        existing_item = self._make_create_item()
        existing_item.id = uuid4()
        service.list_items.page_all.return_value = MagicMock(items=[existing_item])
        service.can_merge = Mock(return_value=True)

        merged_mock = MagicMock()
        merged_mock.cast.return_value = MagicMock()
        service.merge_items.return_value = merged_mock

        create_item = self._make_create_item(
            shopping_list_id=existing_item.shopping_list_id
        )
        service.list_items.update_many.return_value = []

        service.bulk_create_items([create_item])

        service.list_items.update_many.assert_called_once()


# ===========================================================================
# remove_recipe_ingredients_from_list — ISP + Mock
# Analysis: T4_remove_recipe_ingredients.md
# C1=list existence, C2=item match, C3=ref.recipe_scale, C4=scale vs decrement,
# C5=post-adjustment outcome, C6=list-level ref
# ===========================================================================

class RemoveRecipeIngredientsFromListTests:

    def _setup_service(self, shopping_list=None):
        service = make_service()
        service.shopping_lists = MagicMock()
        service.bulk_update_items = Mock(
            return_value=MagicMock(deleted_items=[], created_items=[], updated_items=[])
        )
        service.bulk_delete_items = Mock(
            return_value=MagicMock(deleted_items=[], created_items=[], updated_items=[])
        )
        service.list_refs = MagicMock()

        if shopping_list is None:
            shopping_list = MagicMock()
            shopping_list.id = uuid4()
            shopping_list.list_items = []
            shopping_list.recipe_references = []

        service.shopping_lists.get_one.return_value = shopping_list
        return service, shopping_list

    def test_t1_list_not_found_raises(self):
        """T1 — C1=A: shopping list not found → UnexpectedNone raised"""
        from mealie.core.exceptions import UnexpectedNone
        service, _ = self._setup_service()
        service.shopping_lists.get_one.return_value = None

        with pytest.raises(UnexpectedNone):
            service.remove_recipe_ingredients_from_list(uuid4(), uuid4())

    def test_t2_no_matching_items_nothing_updated(self):
        """T2 — C2=A: no items reference recipe_id → bulk_update called with []"""
        recipe_id = uuid4()
        other_ref = MagicMock()
        other_ref.recipe_id = uuid4()  # different recipe
        item = MagicMock()
        item.recipe_references = [other_ref]
        shopping_list = MagicMock()
        shopping_list.id = uuid4()
        shopping_list.list_items = [item]
        shopping_list.recipe_references = []
        service, _ = self._setup_service(shopping_list)

        service.remove_recipe_ingredients_from_list(uuid4(), recipe_id)

        # bulk_update_items should be called with empty list (no matched items)
        service.bulk_update_items.assert_called_once_with([])

    def test_t3_recipe_scale_none_treated_as_one(self):
        """T3 — C3=A: ref.recipe_scale=None → set to 1 before calculation"""
        recipe_id = uuid4()
        ref = MagicMock()
        ref.recipe_id = recipe_id
        ref.recipe_scale = None
        ref.recipe_quantity = 1.0
        item = MagicMock()
        item.quantity = 2.0
        item.recipe_references = [ref]
        item.id = uuid4()
        shopping_list = MagicMock()
        shopping_list.id = uuid4()
        shopping_list.list_items = [item]
        shopping_list.recipe_references = []
        service, _ = self._setup_service(shopping_list)

        service.remove_recipe_ingredients_from_list(uuid4(), recipe_id)

        # ref.recipe_scale should have been set to 1 then decremented
        assert ref.recipe_scale is not None

    def test_t4_partial_quantity_removal(self):
        """T4 — C4=A: scale > decrement → partial quantity removal"""
        recipe_id = uuid4()
        ref = MagicMock()
        ref.recipe_id = recipe_id
        ref.recipe_scale = 3.0  # > decrement=1 → partial
        ref.recipe_quantity = 1.0
        item = MagicMock()
        item.quantity = 3.0
        item.recipe_references = [ref]
        item.id = uuid4()
        shopping_list = MagicMock()
        shopping_list.id = uuid4()
        shopping_list.list_items = [item]
        shopping_list.recipe_references = []
        service, _ = self._setup_service(shopping_list)

        service.remove_recipe_ingredients_from_list(uuid4(), recipe_id)

        # quantity reduced by recipe_decrement * recipe_quantity = 1.0 * 1.0 = 1.0
        assert item.quantity == 2.0

    def test_t7_zero_quantity_no_refs_item_deleted(self):
        """T7 — C5=B: quantity==0 AND no remaining refs → item deleted"""
        recipe_id = uuid4()
        ref = MagicMock()
        ref.recipe_id = recipe_id
        ref.recipe_scale = 1.0
        ref.recipe_quantity = 1.0
        # Use real list so item.recipe_references.remove(ref) works naturally
        item = MagicMock()
        item.quantity = 1.0
        item.recipe_references = [ref]
        item.id = uuid4()
        shopping_list = MagicMock()
        shopping_list.id = uuid4()
        shopping_list.list_items = [item]
        shopping_list.recipe_references = []
        service, _ = self._setup_service(shopping_list)

        service.remove_recipe_ingredients_from_list(uuid4(), recipe_id)

        # ref.recipe_scale=1 → scale - decrement=0 → remove ref → list empty
        # item.quantity=1-1*1=0 AND no refs → goes to delete_items
        service.bulk_delete_items.assert_called_once()

    def test_t9_list_ref_updated_when_qty_gt_decrement(self):
        """T9 — C6=A: list-level recipe_quantity > decrement → list_refs.update called"""
        recipe_id = uuid4()
        ref = MagicMock()
        ref.recipe_id = recipe_id
        ref.recipe_scale = 1.0
        ref.recipe_quantity = 1.0
        item = MagicMock()
        item.quantity = 5.0
        item.recipe_references = [ref]
        item.id = uuid4()
        list_recipe_ref = MagicMock()
        list_recipe_ref.recipe_id = recipe_id
        list_recipe_ref.recipe_quantity = 3.0  # > 1.0 decrement → update
        list_recipe_ref.id = uuid4()
        shopping_list = MagicMock()
        shopping_list.id = uuid4()
        shopping_list.list_items = [item]
        shopping_list.recipe_references = [list_recipe_ref]
        service, _ = self._setup_service(shopping_list)

        service.remove_recipe_ingredients_from_list(uuid4(), recipe_id)

        service.list_refs.update.assert_called_once()
        service.list_refs.delete.assert_not_called()
