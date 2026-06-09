"""
Tests for mealie/services/scheduler/tasks/delete_old_checked_shopping_list_items.py

Functions covered:
- _trim_list_items              : ISP + Mock    (T4_delete_old_checked.md)
- delete_old_checked_list_items : ISP + Mock    (T4_delete_old_checked.md)
"""

import pytest
from unittest.mock import MagicMock, Mock, patch, call, ANY
from uuid import uuid4

from mealie.services.scheduler.tasks.delete_old_checked_shopping_list_items import (
    _trim_list_items,
    delete_old_checked_list_items,
    MAX_CHECKED_ITEMS,
)

MODULE = "mealie.services.scheduler.tasks.delete_old_checked_shopping_list_items"


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def make_items(n: int):
    """Create n mock shopping list items each with a unique id."""
    items = []
    for _ in range(n):
        item = MagicMock()
        item.id = uuid4()
        items.append(item)
    return items


def make_service(items):
    """Create a ShoppingListService mock with page_all returning `items`."""
    service = MagicMock()
    service.list_items.page_all.return_value = MagicMock(items=items)
    service.bulk_delete_items.return_value = MagicMock(
        deleted_items=[], created_items=[], updated_items=[]
    )
    return service


# ===========================================================================
# _trim_list_items — ISP
# Analysis: T4_delete_old_checked.md §3 "For _trim_list_items"
# C1: 0 / 100 / 101 / 200 items — boundary at MAX_CHECKED_ITEMS=100
# ===========================================================================

class TrimListItemsTests:

    def test_t1_zero_items_no_delete_called(self):
        """T1 — C1=A (0 items): within limit → early return, bulk_delete not called."""
        service = make_service(make_items(0))
        event_publisher = Mock()

        with patch(f"{MODULE}.publish_list_item_events") as mock_publish:
            _trim_list_items(service, uuid4(), event_publisher)

        service.bulk_delete_items.assert_not_called()
        mock_publish.assert_not_called()

    def test_t2_exactly_100_items_no_delete(self):
        """T2 — C1=B (100 items): == MAX → still within limit, no delete.
        Kills M1 mutation (< vs <=): if mutated to <, 100 items would trigger delete."""
        service = make_service(make_items(MAX_CHECKED_ITEMS))
        event_publisher = Mock()

        with patch(f"{MODULE}.publish_list_item_events") as mock_publish:
            _trim_list_items(service, uuid4(), event_publisher)

        service.bulk_delete_items.assert_not_called()
        mock_publish.assert_not_called()

    def test_t3_101_items_deletes_exactly_one(self):
        """T3 — C1=C (101 items): exceeds by 1 → deletes items[100:] (1 item)."""
        items = make_items(101)
        service = make_service(items)
        event_publisher = Mock()

        with patch(f"{MODULE}.publish_list_item_events") as mock_publish:
            _trim_list_items(service, uuid4(), event_publisher)

        service.bulk_delete_items.assert_called_once()
        deleted_ids = service.bulk_delete_items.call_args[0][0]
        assert len(deleted_ids) == 1
        assert deleted_ids[0] == items[100].id
        mock_publish.assert_called_once()

    def test_t4_200_items_deletes_100(self):
        """T4 — C1=D (200 items): well over limit → deletes 100 oldest items."""
        items = make_items(200)
        service = make_service(items)
        event_publisher = Mock()

        with patch(f"{MODULE}.publish_list_item_events") as mock_publish:
            _trim_list_items(service, uuid4(), event_publisher)

        service.bulk_delete_items.assert_called_once()
        deleted_ids = service.bulk_delete_items.call_args[0][0]
        assert len(deleted_ids) == 100
        # Items beyond index 100 are the oldest (sorted desc by updated_at)
        expected_ids = [item.id for item in items[100:]]
        assert deleted_ids == expected_ids
        mock_publish.assert_called_once()


# ===========================================================================
# delete_old_checked_list_items — ISP + Mock
# Analysis: T4_delete_old_checked.md §3 "For delete_old_checked_list_items"
# G1=groups, G2=households per group, G3=lists per household
# ===========================================================================

class DeleteOldCheckedListItemsTests:

    def _patch_all(self, groups, households_per_group, lists_per_household):
        """Build the patch context and configure nested mock repos."""
        mock_group_list = [MagicMock() for _ in range(groups)]
        mock_household_list = [MagicMock() for _ in range(households_per_group)]
        mock_list_list = [MagicMock() for _ in range(lists_per_household)]

        repos = MagicMock()
        repos.groups.page_all.return_value = MagicMock(items=mock_group_list)
        repos.households.page_all.return_value = MagicMock(items=mock_household_list)
        repos.group_shopping_lists.page_all.return_value = MagicMock(items=mock_list_list)

        return repos, mock_group_list, mock_household_list, mock_list_list

    def _run(self, repos):
        """Run delete_old_checked_list_items with all infrastructure patched."""
        session = MagicMock()
        ctx = MagicMock()
        ctx.__enter__.return_value = session
        ctx.__exit__.return_value = False

        with patch(f"{MODULE}.session_context", return_value=ctx), \
             patch(f"{MODULE}.get_repositories", return_value=repos), \
             patch(f"{MODULE}.EventBusService"), \
             patch(f"{MODULE}.ShoppingListService"), \
             patch(f"{MODULE}._trim_list_items") as mock_trim:
            delete_old_checked_list_items()

        return mock_trim

    def test_t5_no_groups_trim_never_called(self):
        """T5 — G1=A: no groups → _trim_list_items called 0 times."""
        repos, *_ = self._patch_all(0, 0, 0)
        mock_trim = self._run(repos)
        mock_trim.assert_not_called()

    def test_t6_one_group_no_households_trim_never_called(self):
        """T6 — G1=B, G2=A: 1 group but no households → 0 trim calls."""
        repos, *_ = self._patch_all(1, 0, 0)
        mock_trim = self._run(repos)
        mock_trim.assert_not_called()

    def test_t7_one_group_one_household_no_lists_trim_never_called(self):
        """T7 — G1=B, G2=B, G3=A: 1 group, 1 household, no lists → 0 trim calls."""
        repos, *_ = self._patch_all(1, 1, 0)
        mock_trim = self._run(repos)
        mock_trim.assert_not_called()

    def test_t8_one_group_one_household_one_list_trim_called_once(self):
        """T8 — G1=B, G2=B, G3=B: 1 group, 1 household, 1 list → 1 trim call."""
        repos, *_ = self._patch_all(1, 1, 1)
        mock_trim = self._run(repos)
        mock_trim.assert_called_once()

    def test_t9_two_groups_one_household_each_two_trim_calls(self):
        """T9 — G1=C: 2 groups × 1 household × 1 list = 2 trim calls."""
        # Need two separate repos — patch get_repositories to cycle
        mock_group1 = MagicMock()
        mock_group2 = MagicMock()
        mock_household = MagicMock()
        mock_list = MagicMock()

        repos = MagicMock()
        repos.groups.page_all.return_value = MagicMock(items=[mock_group1, mock_group2])
        repos.households.page_all.return_value = MagicMock(items=[mock_household])
        repos.group_shopping_lists.page_all.return_value = MagicMock(items=[mock_list])

        session = MagicMock()
        ctx = MagicMock()
        ctx.__enter__.return_value = session
        ctx.__exit__.return_value = False

        with patch(f"{MODULE}.session_context", return_value=ctx), \
             patch(f"{MODULE}.get_repositories", return_value=repos), \
             patch(f"{MODULE}.EventBusService"), \
             patch(f"{MODULE}.ShoppingListService"), \
             patch(f"{MODULE}._trim_list_items") as mock_trim:
            delete_old_checked_list_items()

        assert mock_trim.call_count == 2

    def test_t10_one_group_one_household_two_lists_two_trim_calls(self):
        """T10 — G3=C: 1 group, 1 household, 2 lists → 2 trim calls."""
        repos, *_ = self._patch_all(1, 1, 2)
        mock_trim = self._run(repos)
        assert mock_trim.call_count == 2
